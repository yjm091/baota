import cloud = require('wx-server-sdk')
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

cloud.init({ env: process.env.CLOUDBASE_ENV_ID || cloud.DYNAMIC_CURRENT_ENV })
const dbApp = require('@cloudbase/node-sdk').init({ env: process.env.CLOUDBASE_ENV_ID || cloud.DYNAMIC_CURRENT_ENV })
const db = dbApp.database()
const _ = db.command
const SESSION_SECONDS = 60 * 60 * 12
const money = (value: number) => Math.round(value * 100) / 100
type Role = 'admin' | 'frontdesk' | 'kitchen' | 'customer'
type Staff = { _id: string; username: string; passwordHash: string; role: Role; active: boolean; mustChangePassword?: boolean }
type Auth = { id: string; role: Role; username?: string; openid?: string; exp: number }

function fail(message: string): never { throw new Error(message) }
function collection(name: string) { return db.collection(name) }
async function getDocument<T = any>(name: string, id: string): Promise<T | null> {
  const result = await collection(name).doc(id).get()
  const data = result?.data
  // @cloudbase/node-sdk returns doc().get().data as an array (unlike
  // wx-server-sdk, which unwraps the first document for doc reads).
  return (Array.isArray(data) ? data[0] : data) || null
}
const requiredCollections = ['users', 'staff', 'categories', 'dishes', 'tables', 'diningSessions', 'orders', 'auditLogs']
async function ensureCollections() {
  const created: string[] = []
  for (const name of requiredCollections) {
    try {
      await collection(name).limit(1).get()
    } catch (error) {
      const detail = error as { message?: string; code?: string; errCode?: string; errMsg?: string }
      const message = [detail?.message, detail?.code, detail?.errCode, detail?.errMsg].filter(Boolean).join(' ')
      if (!/db or table not exist|collection.*not exist|database_collection_not_exist|collection_not_exist/i.test(message)) throw error
      await db.createCollection(name)
      created.push(name)
    }
  }
  return created
}
function digest(password: string, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}
function matchesSecret(supplied: string, expected: string) {
  const suppliedBytes = Buffer.from(supplied, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
}
function verify(password: string, encoded: string) {
  const [salt, hash] = encoded.split(':')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
function sign(auth: Omit<Auth, 'exp'>) {
  const payload = Buffer.from(JSON.stringify({ ...auth, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString('base64url')
  const secret = process.env.SESSION_SECRET
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) fail('云函数 SESSION_SECRET 至少需要 32 字节，请在 CloudBase 云函数环境变量中配置并发布')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}
function readToken(token?: string): Auth | null {
  if (!token) return null
  const [payload, signature] = token.split('.')
  const secret = process.env.SESSION_SECRET
  if (!payload || !signature || !secret) return null
  const expected = createHmac('sha256', secret).update(payload).digest()
  let supplied: Buffer
  try { supplied = Buffer.from(signature, 'base64url') } catch { return null }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null
  try {
    const auth = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Auth
    return auth.exp > Date.now() / 1000 ? auth : null
  } catch { return null }
}
function requireRole(auth: Auth | null, ...roles: Role[]): Auth {
  if (!auth || !roles.includes(auth.role)) fail('需要登录或权限不足')
  return auth
}
async function rows<T>(name: string, query: Record<string, unknown> = {}): Promise<T[]> {
  const result = await collection(name).where(query).limit(100).get()
  return result.data as T[]
}
async function writeAudit(auth: Auth, action: string, targetId: string, details: Record<string, unknown> = {}) {
  await collection('auditLogs').add({ actorId: auth.id, role: auth.role, action, targetId, details, createdAt: new Date().toISOString() })
}
function publicStaff(staff: Staff) { const { passwordHash: _password, ...safe } = staff; return safe }
async function activeSession(tableId: string) {
  const found = await rows<any>('diningSessions', { tableId, status: 'open' })
  return found.sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0] || null
}
function makeCartLine(dish: any, requestedDishId: string, options: unknown, note: unknown, quantity: number) {
  // Shared carts persist grouped selections; older clients send choice names.
  const groupedOptions = Array.isArray(options) && options.length > 0 && options.every(
    entry => entry && typeof entry === 'object' && typeof entry.group === 'string' && typeof entry.name === 'string'
  ) ? options as Array<{ group: string; name: string }> : null
  if (groupedOptions && new Set(groupedOptions.map(entry => entry.group)).size !== groupedOptions.length) fail('菜品规格重复，请重新选择')
  const optionSelections = groupedOptions
    ? Object.fromEntries(groupedOptions.map(entry => [entry.group, entry.name]))
    : options && typeof options === 'object' && !Array.isArray(options)
    ? options as Record<string, unknown>
    : null
  const selected = Array.isArray(options) ? options.map(String) : []
  const selectedNames: string[] = []
  const selectedValues: string[] = []
  const selectedGroups: Array<{ group: string; name: string }> = []
  let unitPrice = Number(dish.basePrice)
  for (const group of dish.options || []) {
    const groupValue = optionSelections ? String(optionSelections[group.group] || '') : ''
    const matches = optionSelections
      ? (groupValue && group.choices.some((choice: any) => choice.name === groupValue) ? [groupValue] : [])
      : selected.filter(name => group.choices.some((choice: any) => choice.name === name))
    if (group.required && matches.length !== 1) fail(`请选择${group.group}`)
    if (matches.length > 1) fail(`${group.group}只能选择一项`)
    for (const choiceName of matches) {
      const choice = group.choices.find((entry: any) => entry.name === choiceName)
      unitPrice += Number(choice.priceDelta || 0)
      selectedNames.push(`${group.group}: ${choice.name}`)
      selectedValues.push(choice.name)
      selectedGroups.push({ group: group.group, name: choice.name })
    }
  }
  if (optionSelections && Object.keys(optionSelections).some(groupName => !selectedGroups.some(selection => selection.group === groupName))) fail('菜品规格无效，请重新选择')
  if (!optionSelections && selected.length !== selectedValues.length) fail('菜品规格无效，请重新选择')
  const safeNote = String(note || '').slice(0, 100)
  const dishId = String(dish._id || requestedDishId)
  const cartKey = createHash('sha256').update(JSON.stringify([dishId, selectedGroups.slice().sort((a, b) => a.group.localeCompare(b.group)), safeNote])).digest('hex')
  return {
    cartKey, dishId, name: dish.name, quantity, options: selectedValues, optionSelections: selectedGroups,
    optionNames: selectedNames, optionLabel: selectedValues.join('、'), note: safeNote,
    basePrice: money(Number(dish.basePrice)), unitPrice: money(unitPrice)
  }
}
async function mutateSharedCart(sessionId: string, tableId: string, update: (items: any[]) => any[]) {
  let updatedItems: any[] = []
  let version = 0
  await db.runTransaction(async (transaction: any) => {
    const sessionRef = transaction.collection('diningSessions').doc(sessionId)
    const snapshot = await sessionRef.get()
    const sessionData = snapshot.data
    const session = Array.isArray(sessionData) ? sessionData[0] : sessionData
    if (!session || session.status !== 'open' || session.tableId !== tableId) fail('当前桌次已结束，请重新选择桌号')
    const currentItems = Array.isArray(session.sharedCart) ? session.sharedCart : []
    updatedItems = update(currentItems)
    version = Number(session.cartVersion || 0) + 1
    await sessionRef.update({
      sharedCart: updatedItems,
      cartVersion: version,
      cartUpdatedAt: new Date().toISOString()
    })
  })
  return { items: updatedItems, version }
}
function normalizeOrder(order: any) {
  const isLegacyServed = ['served', 'paid'].includes(order.status)
  const paymentStatus = order.paymentStatus || (order.status === 'paid' ? 'paid' : 'unpaid')
  const items = (order.items || []).map((item: any) => {
    const legacyProduction = ['pending', 'preparing', 'ready'].includes(item.productionStatus)
      ? item.productionStatus
      : ['preparing', 'ready'].includes(item.status)
        ? item.status
        : ['preparing', 'ready', 'served'].includes(order.status) ? 'ready' : 'pending'
    const serviceStatus = item.serviceStatus || (item.status === 'served' || isLegacyServed ? 'served' : 'pending')
    return { ...item, productionStatus: legacyProduction, serviceStatus }
  })
  return { ...order, paymentStatus, items }
}
function itemRefundedQuantity(item: any) {
  return (item.refunds || []).reduce((sum: number, refund: any) => sum + Number(refund.quantity || 0), 0)
}
function itemFulfilled(item: any) {
  return item.serviceStatus === 'served' || itemRefundedQuantity(item) >= Number(item.quantity || 0)
}
function refreshOrderStatus(order: any) {
  if (order.status === 'pending' || order.status === 'canceled') return order.status
  const items = (order.items || []).map((item: any) => normalizeOrder({ ...order, items: [item] }).items[0])
  if (items.length && items.every((item: any) => itemFulfilled(item))) return 'served'
  if (items.length && items.every((item: any) => item.productionStatus === 'ready' || itemRefundedQuantity(item) >= Number(item.quantity || 0))) return 'ready'
  if (items.some((item: any) => ['preparing', 'ready'].includes(item.productionStatus))) return 'preparing'
  return 'confirmed'
}
async function ensureDefaultTables() {
  const existing = await rows<any>('tables')
  const existingNames = new Set(existing.map(table => String(table.name || '').trim()))
  const missing = Array.from({ length: 8 }, (_, index) => ({
    id: `default-table-${String(index + 1).padStart(2, '0')}`,
    name: `${index + 1}号桌`
  })).filter(table => !existingNames.has(table.name))

  if (missing.length) {
    const createdAt = new Date().toISOString()
    await Promise.all(missing.map(table => collection('tables').doc(table.id).set({
      name: table.name,
      active: true,
      createdAt
    })))
  }

  return rows<any>('tables')
}
function customerId() {
  try {
    const openid = cloud.getWXContext().OPENID
    return openid ? `wx:${openid}` : ''
  } catch {
    // HTTP-triggered requests do not carry a Mini Program wxContext.
    return ''
  }
}

async function dispatch(action: string, payload: any, event: any): Promise<any> {
  let auth = readToken(event.token)
  const wxCustomer = customerId()
  if (!auth && wxCustomer) auth = { id: wxCustomer, role: 'customer', openid: wxCustomer.slice(3), exp: Date.now() / 1000 + SESSION_SECONDS }

  switch (action) {
    case 'health': {
      await Promise.all(requiredCollections.map(name => collection(name).limit(1).get()))
      return { ok: true, databaseReady: true, envId: process.env.CLOUDBASE_ENV_ID || 'dynamic' }
    }
    case 'menu': {
      const [categories, dishes] = await Promise.all([rows<any>('categories', { active: true }), rows<any>('dishes', { active: true })])
      return {
        categories: categories.sort((a, b) => a.sort - b.sort).map(({ _id, ...category }) => ({ id: _id, ...category })),
        dishes: dishes.sort((a, b) => a.sort - b.sort).map(({ _id, ...dish }) => ({ id: _id, ...dish }))
      }
    }
    case 'customer.login': {
      if (!wxCustomer) return { demo: true, customerId: String(payload.demoId || 'demo-customer') }
      return { customerId: wxCustomer }
    }
    case 'auth.login': {
      const username = String(payload.username || '').trim()
      const password = String(payload.password || '')
      if (!username || password.length < 8) fail('请输入有效账号和至少 8 位密码')
      // Staff is a small collection. Read it directly so login remains reliable
      // while CloudBase indexes are being provisioned or repaired.
      const staffRows = await collection('staff').limit(100).get()
      const matching = (staffRows.data as Staff[]).find(item => item.username === username && item.active)
      if (matching && verify(password, matching.passwordHash)) {
        return { token: sign({ id: matching._id, role: matching.role, username }), staff: publicStaff(matching) }
      }

      // The configured bootstrap secret is the owner's recovery credential.
      // Use it to repair a stale or malformed admin record so a bad staff
      // document cannot permanently lock the owner out of the console.
      const bootstrapUsername = String(process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin')
      const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || ''
      if (username !== bootstrapUsername || !bootstrapPassword || !matchesSecret(password, bootstrapPassword)) {
        fail('账号或密码错误')
      }
      const repaired = (staffRows.data as Staff[]).filter(item => item.username === bootstrapUsername)
      const passwordHash = digest(bootstrapPassword)
      const updatedAt = new Date().toISOString()
      if (repaired.length) {
        await Promise.all(repaired.map(item => collection('staff').doc(item._id).update({
          passwordHash, role: 'admin', active: true, mustChangePassword: true, updatedAt
        })))
      } else {
        const created = await collection('staff').add({
          username: bootstrapUsername, passwordHash, role: 'admin', active: true,
          mustChangePassword: true, createdAt: updatedAt
        })
        repaired.push({ _id: created.id || '', username: bootstrapUsername, passwordHash, role: 'admin', active: true, mustChangePassword: true })
      }
      const admin = repaired[0]
      return { token: sign({ id: admin._id, role: 'admin', username: bootstrapUsername }), staff: publicStaff({ ...admin, role: 'admin', active: true, mustChangePassword: true }) }
    }
    case 'auth.me': {
      const staffAuth = requireRole(auth, 'admin', 'frontdesk', 'kitchen')
      const staff = await getDocument<Staff>('staff', staffAuth.id)
      if (!staff) fail('员工账号不存在或已被删除')
      return { staff: publicStaff(staff) }
    }
    case 'auth.changePassword': {
      const staffAuth = requireRole(auth, 'admin', 'frontdesk', 'kitchen')
      const current = String(payload.currentPassword || '')
      const next = String(payload.newPassword || '')
      if (next.length < 12 || !/[A-Z]/.test(next) || !/[a-z]/.test(next) || !/\d/.test(next)) fail('新密码需至少 12 位并包含大小写字母和数字')
      const doc = collection('staff').doc(staffAuth.id)
      const staff = await getDocument<Staff>('staff', staffAuth.id)
      if (!staff) fail('员工账号不存在或已被删除')
      if (!verify(current, staff.passwordHash)) fail('当前密码不正确')
      await doc.update({ passwordHash: digest(next), mustChangePassword: false, updatedAt: new Date().toISOString() })
      await writeAudit(staffAuth, 'auth.changePassword', staffAuth.id)
      return { ok: true }
    }
    case 'admin.bootstrap': {
      const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD
      const username = String(process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin')
      const supplied = Buffer.from(String(payload.password || ''))
      const expected = Buffer.from(bootstrapPassword || '')
      if (!bootstrapPassword || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail('初始化口令无效')
      if (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET, 'utf8') < 32) fail('云函数 SESSION_SECRET 至少需要 32 字节，请先在 CloudBase 云函数环境变量中配置并发布')
      const createdCollections = await ensureCollections()
      const existing = await collection('staff').limit(100).get()
      const existingAdmins = (existing.data as Staff[]).filter(item => item.username === username)
      const timestamp = new Date().toISOString()
      if (existingAdmins.length) {
        // The bootstrap secret is the recovery credential. Re-sync existing admin
        // records so a stale password cannot strand the owner outside the console.
        await Promise.all(existingAdmins.map(item => collection('staff').doc(item._id).update({
          passwordHash: digest(bootstrapPassword), role: 'admin', active: true,
          mustChangePassword: true, updatedAt: timestamp
        })))
      } else {
        await collection('staff').add({ username, passwordHash: digest(bootstrapPassword), role: 'admin', active: true, mustChangePassword: true, createdAt: timestamp })
      }
      const persistedStaff = await collection('staff').limit(100).get()
      const restoredAdmin = (persistedStaff.data as Staff[]).find(item => item.username === username && item.active)
      if (!restoredAdmin || !verify(bootstrapPassword, restoredAdmin.passwordHash)) fail('管理员初始化后校验失败，请检查 staff 集合中的管理员记录')
      const seeded: string[] = []
      for (const role of ['frontdesk', 'kitchen'] as const) {
        const prefix = role === 'frontdesk' ? 'FRONTDESK' : 'KITCHEN'
        const seededUsername = String(process.env[`${prefix}_BOOTSTRAP_USERNAME`] || role)
        const seededPassword = String(process.env[`${prefix}_BOOTSTRAP_PASSWORD`] || '')
        if (seededPassword) {
          if (seededPassword.length < 12) fail(`${prefix}_BOOTSTRAP_PASSWORD 至少需要 12 位`)
          await collection('staff').add({ username: seededUsername, passwordHash: digest(seededPassword), role, active: true, mustChangePassword: true, createdAt: new Date().toISOString() })
          seeded.push(role)
        }
      }
      const setupMessage = createdCollections.length ? `，并创建了 ${createdCollections.length} 个缺失的数据集合` : ''
      return { username, adminReady: true, seededRoles: seeded, createdCollections, message: `管理员已初始化或恢复${setupMessage}，请使用初始口令登录并立即修改密码` }
    }
    case 'category.save': {
      const actor = requireRole(auth, 'admin')
      const name = String(payload.name || '').trim()
      if (!name) fail('分类名称不能为空')
      const data = { name, sort: Number(payload.sort || 0), active: payload.active !== false, updatedAt: new Date().toISOString() }
      const id = String(payload.id || '')
      const result = id ? await collection('categories').doc(id).update(data) : await collection('categories').add({ ...data, createdAt: new Date().toISOString() })
      const savedId = id || ('id' in result ? String(result.id || '') : '')
      if (!savedId) fail('分类已提交但未返回记录 ID，请刷新后确认')
      await writeAudit(actor, 'category.save', savedId)
      return { id: savedId }
    }
    case 'dish.save': {
      const actor = requireRole(auth, 'admin')
      const name = String(payload.name || '').trim()
      const price = Number(payload.basePrice)
      if (!name || !Number.isFinite(price) || price < 0 || !payload.categoryId) fail('请填写菜名、分类和有效价格')
      const options = Array.isArray(payload.options) ? payload.options : []
      for (const group of options) {
        if (!group.group || !Array.isArray(group.choices) || !group.choices.length) fail('规格组必须有名称和选项')
        for (const choice of group.choices) if (!choice.name || !Number.isFinite(Number(choice.priceDelta))) fail('规格选项价格无效')
      }
      const data = { categoryId: String(payload.categoryId), name, description: String(payload.description || ''), imageFileId: String(payload.imageFileId || ''), basePrice: money(price), options, active: payload.active !== false, soldOut: Boolean(payload.soldOut), sort: Number(payload.sort || 0), updatedAt: new Date().toISOString() }
      const id = String(payload.id || '')
      const result = id ? await collection('dishes').doc(id).update(data) : await collection('dishes').add({ ...data, createdAt: new Date().toISOString() })
      const savedId = id || ('id' in result ? String(result.id || '') : '')
      if (!savedId) fail('菜品已提交但未返回记录 ID，请刷新后确认')
      await writeAudit(actor, 'dish.save', savedId)
      return { id: savedId }
    }
    case 'dish.setAvailability': {
      const actor = requireRole(auth, 'admin')
      await collection('dishes').doc(String(payload.id)).update({ active: Boolean(payload.active), soldOut: Boolean(payload.soldOut), updatedAt: new Date().toISOString() })
      await writeAudit(actor, 'dish.setAvailability', String(payload.id), { active: Boolean(payload.active), soldOut: Boolean(payload.soldOut) })
      return { ok: true }
    }
    case 'table.create': {
      const actor = requireRole(auth, 'admin')
      const name = String(payload.name || '').trim()
      if (!name) fail('桌台名称不能为空')
      const result = await collection('tables').add({ name, active: true, createdAt: new Date().toISOString() })
      const id = result.id || ''
      if (!id) fail('桌台已提交但未返回记录 ID，请刷新后确认')
      await writeAudit(actor, 'table.create', id)
      return { id, name }
    }
    case 'table.available': {
      const [allTables, sessions] = await Promise.all([
        ensureDefaultTables(),
        rows<any>('diningSessions', { status: 'open' })
      ])
      return allTables
        .filter(table => table.active !== false)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN', { numeric: true }))
        .map(table => ({ id: table._id, name: table.name, occupied: sessions.some(session => session.tableId === table._id) }))
    }
    case 'table.list': {
      requireRole(auth, 'admin', 'frontdesk')
      const tables = await rows<any>('tables')
      const sessions = await rows<any>('diningSessions', { status: 'open' })
      return tables.map(({ _id, tokenHash: _hash, qrFileId: _qrFileId, qrUpdatedAt: _qrUpdatedAt, ...table }) => ({
        id: _id,
        ...table,
        currentSession: sessions.find(session => session.tableId === _id) || null
      }))
    }
    case 'image.upload': {
      const actor = requireRole(auth, 'admin')
      const extension = String(payload.extension || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase()
      const mimeType = String(payload.mimeType || '')
      const base64 = String(payload.base64 || '')
      if (!['jpg', 'jpeg', 'png', 'webp'].includes(extension) || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) fail('仅支持 JPG、PNG 或 WebP 图片')
      if (!base64 || base64.length > 3_000_000) fail('图片为空或超过 2MB 限制')
      const fileContent = Buffer.from(base64, 'base64')
      if (!fileContent.length || fileContent.length > 2 * 1024 * 1024) fail('图片为空或超过 2MB 限制')
      const upload = await cloud.uploadFile({ cloudPath: `dish-images/${Date.now()}-${randomBytes(8).toString('hex')}.${extension}`, fileContent })
      await writeAudit(actor, 'image.upload', upload.fileID, { mimeType, size: fileContent.length })
      return { fileID: upload.fileID }
    }
    case 'session.current': {
      requireRole(auth, 'customer')
      const tableId = String(payload.tableId || '')
      const tableRef = collection('tables').doc(tableId)
      const legacyActiveSession = await activeSession(tableId)
      const sessionId = `session-${Date.now()}-${randomBytes(8).toString('hex')}`
      const session = await db.runTransaction(async (transaction: any) => {
        const txTableRef = transaction.collection('tables').doc(tableId)
        const tableSnapshot = await txTableRef.get()
        const tableData = tableSnapshot.data
        const table = Array.isArray(tableData) ? tableData[0] : tableData
        if (!table || table.active === false) fail('桌台当前不可用')

        const activeSessionId = String(table.activeSessionId || legacyActiveSession?._id || '')
        if (activeSessionId) {
          const activeSnapshot = await transaction.collection('diningSessions').doc(activeSessionId).get()
          const activeData = activeSnapshot.data
          const current = Array.isArray(activeData) ? activeData[0] : activeData
          if (current && current.tableId === tableId && current.status === 'open') {
            if (table.activeSessionId !== activeSessionId) await txTableRef.update({ activeSessionId })
            return { id: activeSessionId, tableId, status: 'open', openedAt: current.openedAt }
          }
        }

        const now = new Date().toISOString()
        await transaction.collection('diningSessions').doc(sessionId).set({
          tableId, status: 'open', openedAt: now, sharedCart: [], cartVersion: 0
        })
        await txTableRef.update({ activeSessionId: sessionId })
        return { id: sessionId, tableId, status: 'open', openedAt: now }
      })
      return session
    }
    case 'cart.get': {
      requireRole(auth, 'customer')
      const sessionId = String(payload.sessionId || '')
      const tableId = String(payload.tableId || '')
      const session = await getDocument<any>('diningSessions', sessionId)
      if (!session || session.status !== 'open' || session.tableId !== tableId) fail('当前桌次已结束，请重新选择桌号')
      return { sessionId, version: Number(session.cartVersion || 0), items: Array.isArray(session.sharedCart) ? session.sharedCart : [] }
    }
    case 'cart.add': {
      requireRole(auth, 'customer')
      const sessionId = String(payload.sessionId || '')
      const tableId = String(payload.tableId || '')
      const dishId = String(payload.dishId || '')
      const dish = await getDocument<any>('dishes', dishId)
      if (!dish || !dish.active || dish.soldOut) fail('这道菜已售罄或下架，请刷新菜单')
      const line = makeCartLine(dish, dishId, payload.options, payload.note, 1)
      return await mutateSharedCart(sessionId, tableId, current => {
        const existing = current.find(item => item.cartKey === line.cartKey)
        if (existing && Number(existing.quantity) >= 20) fail('同一道菜最多点 20 份')
        return existing
          ? current.map(item => item.cartKey === line.cartKey ? { ...line, quantity: Number(item.quantity) + 1 } : item)
          : [...current, line]
      })
    }
    case 'cart.change': {
      requireRole(auth, 'customer')
      const sessionId = String(payload.sessionId || '')
      const tableId = String(payload.tableId || '')
      const cartKey = String(payload.cartKey || '')
      const delta = Number(payload.delta)
      if (!cartKey || ![-1, 1].includes(delta)) fail('购物车操作无效')
      return await mutateSharedCart(sessionId, tableId, current => {
        const existing = current.find(item => item.cartKey === cartKey)
        if (!existing) fail('这道菜已被同桌移出，请刷新点餐单')
        const quantity = Number(existing.quantity) + delta
        if (quantity > 20) fail('同一道菜最多点 20 份')
        return quantity > 0
          ? current.map(item => item.cartKey === cartKey ? { ...item, quantity } : item)
          : current.filter(item => item.cartKey !== cartKey)
      })
    }
    case 'cart.clear': {
      requireRole(auth, 'customer')
      const sessionId = String(payload.sessionId || '')
      const tableId = String(payload.tableId || '')
      return await mutateSharedCart(sessionId, tableId, () => [])
    }
    case 'order.create': {
      const actor = requireRole(auth, 'customer')
      const sessionId = String(payload.sessionId || '')
      let createdOrder: { id: string; batchNo: number; subtotal: number; cartVersion: number } | null = null
      await db.runTransaction(async (transaction: any) => {
        const sessionRef = transaction.collection('diningSessions').doc(sessionId)
        const sessionSnapshot = await sessionRef.get()
        const sessionData = sessionSnapshot.data
        const session = Array.isArray(sessionData) ? sessionData[0] : sessionData
        if (!session || session.status !== 'open') fail('该桌次已结束，请重新选择桌号')
        const cart = Array.isArray(session.sharedCart) ? session.sharedCart : []
        if (!cart.length) fail('本桌共享点餐单为空，请刷新后重试')
        if (cart.length > 30) fail('订单菜品种类不能超过 30 种')
        const snapshots = []
        for (const cartItem of cart) {
          const dishId = String(cartItem.dishId || '')
          const dishSnapshot = await transaction.collection('dishes').doc(dishId).get()
          const dishData = dishSnapshot.data
          const dish = Array.isArray(dishData) ? dishData[0] : dishData
          if (!dish || !dish.active || dish.soldOut) fail(`“${cartItem.name || '菜品'}”已售罄或下架，请联系同桌调整点餐单`)
          const quantity = Math.floor(Number(cartItem.quantity))
          if (quantity < 1 || quantity > 20) fail('菜品数量需在 1 至 20 之间')
          const line = makeCartLine(dish, dishId, cartItem.optionSelections || cartItem.options, cartItem.note, quantity)
          snapshots.push({ dishId: line.dishId, name: line.name, optionNames: line.optionNames, unitPrice: line.unitPrice, quantity, note: line.note, productionStatus: 'pending', serviceStatus: 'pending', refunds: [] })
        }
        const total = money(snapshots.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0))
        const previous = await transaction.collection('orders').where({ sessionId }).limit(100).get()
        const batchNo = (previous.data || []).reduce((max: number, order: any) => Math.max(max, Number(order.batchNo) || 0), 0) + 1
        const now = new Date().toISOString()
        const result = await transaction.collection('orders').add({ sessionId, tableId: session.tableId, batchNo, userId: actor.id, status: 'pending', paymentStatus: 'unpaid', items: snapshots, subtotal: total, createdAt: now })
        const id = result.id || ''
        if (!id) fail('订单已提交但未返回记录 ID，请联系员工确认后再重试')
        const cartVersion = Number(session.cartVersion || 0) + 1
        await sessionRef.update({ sharedCart: [], cartVersion, cartUpdatedAt: now })
        createdOrder = { id, batchNo, subtotal: total, cartVersion }
      })
      const committedOrder = createdOrder as { id: string; batchNo: number; subtotal: number; cartVersion: number } | null
      if (!committedOrder) fail('订单未能提交，请重试')
      await writeAudit(actor, 'order.create', committedOrder.id, { sessionId, total: committedOrder.subtotal })
      return committedOrder
    }
    case 'payment.simulate': {
      const actor = requireRole(auth, 'customer')
      const orderId = String(payload.orderId || '')
      const method = String(payload.method || '')
      if (!['wechat', 'alipay', 'card'].includes(method)) fail('请选择微信、支付宝或银行卡')
      const order = await getDocument<any>('orders', orderId)
      if (!order || order.status === 'canceled') fail('订单不存在或已取消')
      if (order.paymentStatus === 'paid') fail('该订单已经付款')
      const session = await getDocument<any>('diningSessions', order.sessionId)
      if (!session || session.status !== 'open' || session.tableId !== order.tableId) fail('当前桌次已结束，请重新选择桌号')
      const paidAt = new Date().toISOString()
      await collection('orders').doc(orderId).update({ paymentStatus: 'paid', paymentMethod: method, paymentMode: 'simulated', paidAt, updatedAt: paidAt })
      await writeAudit(actor, 'payment.simulate', orderId, { method, amount: order.subtotal })
      return { orderId, paymentStatus: 'paid', paymentMethod: method, paymentMode: 'simulated', paidAt }
    }
    case 'session.orders': {
      requireRole(auth, 'customer')
      const sessionId = String(payload.sessionId || '')
      const session = await getDocument<any>('diningSessions', sessionId)
      if (!session || session.tableId !== String(payload.tableId || '')) fail('桌次与桌台不匹配')
      const orders = await rows<any>('orders', { sessionId })
      return { session: { id: session._id, status: session.status, openedAt: session.openedAt }, orders: orders.sort((a, b) => a.batchNo - b.batchNo).map(({ userId: _user, ...order }) => normalizeOrder({ id: order._id, ...order })) }
    }
    case 'session.finish': {
      const actor = requireRole(auth, 'customer')
      const sessionId = String(payload.sessionId || '')
      const tableId = String(payload.tableId || '')
      const session = await getDocument<any>('diningSessions', sessionId)
      if (!session || session.tableId !== tableId) fail('桌次与桌台不匹配')
      if (session.status !== 'open') fail('该桌次已经结束')
      const rawOrders = await rows<any>('orders', { sessionId })
      if (!rawOrders.length) fail('本桌还没有订单，暂时不能结束桌次')
      const orders = rawOrders.map(normalizeOrder).filter((order: any) => order.status !== 'canceled')
      const unpaid = orders.filter((order: any) => order.paymentStatus !== 'paid')
      const unserved = orders.flatMap((order: any) => order.items.filter((item: any) => !itemFulfilled(item)))
      if (unpaid.length || unserved.length) {
        const reasons = [unpaid.length ? `${unpaid.length} 批订单尚未付款` : '', unserved.length ? `${unserved.length} 道菜尚未上桌` : ''].filter(Boolean)
        fail(`暂时不能结束本桌：${reasons.join('，')}`)
      }
      const now = new Date().toISOString()
      await collection('diningSessions').doc(sessionId).update({ status: 'closed', closedAt: now, closedBy: actor.id })
      await writeAudit(actor, 'session.finish', sessionId, { tableId, orders: orders.length })
      return { ok: true, closedAt: now }
    }
    case 'admin.overview': {
      requireRole(auth, 'admin', 'frontdesk')
      const dayStart = new Date(String(payload.dayStart || ''))
      const dayEnd = new Date(String(payload.dayEnd || ''))
      const dayDuration = dayEnd.getTime() - dayStart.getTime()
      if (!Number.isFinite(dayStart.getTime()) || !Number.isFinite(dayEnd.getTime()) || dayDuration < 20 * 60 * 60 * 1000 || dayDuration > 28 * 60 * 60 * 1000) fail('营业额日期范围无效，请刷新页面重试')
      const [sessions, orders, tables, categories, dishes] = await Promise.all(['diningSessions', 'orders', 'tables', 'categories', 'dishes'].map(name => rows<any>(name)))
      const [paidByPaymentTime, legacyPaidByOrderTime] = await Promise.all([
        collection('orders').where({ paymentStatus: 'paid', paidAt: _.gte(dayStart.toISOString()).and(_.lt(dayEnd.toISOString())) }).limit(1000).get(),
        collection('orders').where({ status: 'paid', createdAt: _.gte(dayStart.toISOString()).and(_.lt(dayEnd.toISOString())) }).limit(1000).get()
      ])
      const todayPaidOrders = new Map<string, any>()
      for (const order of [...(paidByPaymentTime.data || []), ...(legacyPaidByOrderTime.data || [])] as any[]) {
        if (order.status !== 'canceled') todayPaidOrders.set(order._id, order)
      }
      const todayRevenue = money(Array.from(todayPaidOrders.values()).reduce((sum, order) => sum + Number(order.subtotal || 0) - Number(order.refundedTotal || 0), 0))
      const openSessions = sessions.filter(session => session.status === 'open')
      const openIds = new Set(openSessions.map(session => session._id))
      const images = dishes.filter(dish => dish.imageFileId).map(dish => dish.imageFileId)
      const temporary = images.length ? await cloud.getTempFileURL({ fileList: images }) : { fileList: [] }
      const imageMap = new Map((temporary.fileList || []).map((file: any) => [file.fileID, file.tempFileURL]))
      return { openSessions: openSessions.length, openOrders: orders.filter(order => openIds.has(order.sessionId) && !['served', 'canceled'].includes(order.status)).length, tables: tables.length, todayRevenue, categories: categories.map(({ _id, ...category }) => ({ ...category, id: _id })), dishes: dishes.map(({ _id, ...dish }) => ({ id: _id, ...dish, imageUrl: dish.imageFileId ? imageMap.get(dish.imageFileId) || '' : '' })), sessions: openSessions, orders: orders.filter(order => openIds.has(order.sessionId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(order => normalizeOrder({ id: order._id, ...order })) }
    }
    case 'order.confirm': {
      const actor = requireRole(auth, 'frontdesk')
      const orderId = String(payload.orderId)
      const order = await getDocument<any>('orders', orderId)
      if (!order) fail('订单不存在')
      if (order.status !== 'pending') fail('只有待确认订单可以确认')
      if ((order.paymentStatus || (order.status === 'paid' ? 'paid' : 'unpaid')) !== 'paid') fail('顾客尚未完成模拟支付，不能确认制作')
      await collection('orders').doc(orderId).update({ status: 'confirmed', confirmedAt: new Date().toISOString() })
      await writeAudit(actor, 'order.confirm', orderId)
      return { ok: true }
    }
    case 'kitchen.list': {
      requireRole(auth, 'kitchen')
      const orders = await rows<any>('orders', { status: _.in(['confirmed', 'preparing']) })
      return orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(({ userId: _user, ...order }) => normalizeOrder({ id: order._id, ...order }))
    }
    case 'item.start': case 'item.ready': {
      const actor = requireRole(auth, 'kitchen')
      const orderId = String(payload.orderId)
      const itemIndex = Number(payload.itemIndex)
      const rawOrder = await getDocument<any>('orders', orderId)
      const order = rawOrder && normalizeOrder(rawOrder)
      if (!order || !['confirmed', 'preparing'].includes(order.status)) fail('订单当前不在制作中')
      const item = order.items[itemIndex]
      if (!item) fail('找不到对应菜品')
      if (action === 'item.start' && item.productionStatus !== 'pending') fail('只有待制作菜品可以开始制作')
      if (action === 'item.ready' && item.productionStatus !== 'preparing') fail('只有制作中的菜品可以标记备好')
      item.productionStatus = action === 'item.start' ? 'preparing' : 'ready'
      const now = new Date().toISOString()
      const nextStatus = refreshOrderStatus(order)
      await collection('orders').doc(orderId).update({ items: order.items, status: nextStatus, ...(nextStatus === 'ready' ? { readyAt: now } : {}) })
      await writeAudit(actor, action, orderId, { itemIndex, status: item.productionStatus })
      return { ok: true, status: nextStatus }
    }
    case 'item.serve': {
      const actor = requireRole(auth, 'frontdesk')
      const orderId = String(payload.orderId)
      const itemIndex = Number(payload.itemIndex)
      const rawOrder = await getDocument<any>('orders', orderId)
      const order = rawOrder && normalizeOrder(rawOrder)
      if (!order || !['ready', 'preparing'].includes(order.status)) fail('订单还没有可上桌的菜品')
      const item = order.items[itemIndex]
      if (!item || item.productionStatus !== 'ready') fail('该菜品还没有制作完成')
      if (item.serviceStatus === 'served') fail('该菜品已经标记上桌')
      item.serviceStatus = 'served'
      item.servedAt = new Date().toISOString()
      const nextStatus = refreshOrderStatus(order)
      await collection('orders').doc(orderId).update({ items: order.items, status: nextStatus, ...(nextStatus === 'served' ? { servedAt: item.servedAt } : {}) })
      await writeAudit(actor, 'item.serve', orderId, { itemIndex })
      return { ok: true }
    }
    case 'item.refund': {
      const actor = requireRole(auth, 'frontdesk')
      const orderId = String(payload.orderId)
      const itemIndex = Number(payload.itemIndex)
      const quantity = Math.floor(Number(payload.quantity))
      const reason = String(payload.reason || '').trim()
      if (!reason || reason.length > 120) fail('退菜原因必填且不超过 120 字')
      const order = await getDocument<any>('orders', orderId)
      if (!order || order.status === 'paid' || order.status === 'canceled') fail('该订单不能退菜')
      const items = [...order.items]
      const item = items[itemIndex]
      if (!item || !['pending', 'confirmed', 'preparing', 'ready', 'served'].includes(item.status || order.status)) fail('菜品状态不允许退菜')
      const refunded = (item.refunds || []).reduce((sum: number, entry: any) => sum + entry.quantity, 0)
      if (quantity < 1 || quantity > item.quantity - refunded) fail('退菜数量超出可退数量')
      item.refunds = [...(item.refunds || []), { quantity, reason, by: actor.id, at: new Date().toISOString() }]
      const refundAmount = money(item.unitPrice * quantity)
      await collection('orders').doc(orderId).update({ items, refundedTotal: money((order.refundedTotal || 0) + refundAmount), updatedAt: new Date().toISOString() })
      await writeAudit(actor, 'item.refund', orderId, { itemIndex, quantity, reason, refundAmount })
      return { ok: true, refundAmount }
    }
    case 'session.checkout': {
      requireRole(auth, 'frontdesk')
      fail('整桌结束由顾客在小程序确认；请先完成各批订单付款并逐道确认上桌')
    }
    case 'session.cancel': {
      const actor = requireRole(auth, 'frontdesk')
      const sessionId = String(payload.sessionId || '')
      const reason = String(payload.reason || '').trim()
      if (!reason) fail('取消桌次需要填写原因')
      const session = await getDocument<any>('diningSessions', sessionId)
      if (!session || session.status !== 'open') fail('桌次已关闭')
      const orders = await rows<any>('orders', { sessionId })
      const now = new Date().toISOString()
      for (const order of orders) await collection('orders').doc(order._id).update({ status: 'canceled', cancelReason: reason, canceledAt: now })
      await collection('diningSessions').doc(sessionId).update({ status: 'closed', closedAt: now, closedBy: actor.id, cancelReason: reason })
      await writeAudit(actor, 'session.cancel', sessionId, { reason })
      return { ok: true }
    }
    default: fail(`未知操作：${action}`)
  }
}

function isHttpRequest(event: any) {
  return typeof event?.httpMethod === 'string' || typeof event?.body === 'string'
}

// HTTP gateway CORS validation must be disabled when this function owns CORS.
// Keep the allowlist narrow; ordinary wx.cloud.callFunction calls are unaffected.
function httpResponse(event: any, result: any, statusCode = 200) {
  const origin = String(Object.entries(event?.headers || {}).find(([name]) => name.toLowerCase() === 'origin')?.[1] || '')
  const allowedOrigins = (process.env.ADMIN_WEB_ORIGINS || 'https://restaurant-admin-cloud1-d0gzbyfl738d13c13.webapps.tcloudbase.com')
    .split(',').map(value => value.trim()).filter(Boolean)
  const allowed = allowedOrigins.includes(origin)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin'
  }
  if (allowed) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    headers['Access-Control-Max-Age'] = '600'
  }
  const denied = Boolean(origin) && !allowed
  return {
    statusCode: denied ? 403 : statusCode,
    headers,
    isBase64Encoded: false,
    body: denied ? JSON.stringify({ ok: false, error: '不允许的管理端来源' }) : statusCode === 204 ? '' : JSON.stringify(result)
  }
}

export async function main(event: any) {
  const http = isHttpRequest(event)
  if (http) {
    const preflight = String(event.httpMethod || '').toUpperCase() === 'OPTIONS'
    const response = httpResponse(event, null, preflight ? 204 : 200)
    if (preflight || response.statusCode === 403) return response
  }
  try {
    const request = http && typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event || {}
    const headers = event?.headers || {}
    const authorization = Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization')?.[1]
    const bearer = String(authorization || '').replace(/^Bearer\s+/i, '')
    const action = String(request?.action || '')
    const data = await dispatch(action, request?.payload || {}, { ...request, token: request?.token || bearer })
    const result = { ok: true, data }
    return http ? httpResponse(event, result) : result
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务暂时不可用'
    console.error('[api]', event?.action, message)
    const result = { ok: false, error: message }
    return http ? httpResponse(event, result) : result
  }
}
