import cloudbase from '@cloudbase/js-sdk'
import type { Category, Dish, Order, Overview, Role, Staff, Table } from './types'
import { dishImages } from './dish-images'

const env = import.meta.env.VITE_CLOUDBASE_ENV_ID as string | undefined
const httpApiUrl = (import.meta.env.VITE_CLOUDBASE_HTTP_API_URL as string | undefined) || '/restaurant-api'
const accessKey = import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY as string | undefined
export const mockMode = import.meta.env.VITE_USE_MOCK === 'true' || !env
const app = !mockMode ? cloudbase.init({ env, ...(accessKey ? { accessKey } : {}) }) : null
let cloudAuth: Promise<void> | null = null
let token = sessionStorage.getItem('restaurant.session') || ''
let staff: Staff | null = (() => { try { return JSON.parse(sessionStorage.getItem('restaurant.staff') || 'null') } catch { return null } })()

const initialCategories: Category[] = [{ id: 'cat-hot', name: '招牌热菜', sort: 1, active: true }, { id: 'cat-cold', name: '凉菜小食', sort: 2, active: true }, { id: 'cat-drink', name: '饮品', sort: 3, active: true }]
let initialDishes: Dish[] = [
  { id: 'dish-1', categoryId: 'cat-hot', name: '红烧肉', description: '慢火炖煮，肥而不腻', basePrice: 48, options: [{ group: '份量', required: true, choices: [{ name: '标准份', priceDelta: 0 }, { name: '加大份', priceDelta: 18 }] }], active: true, soldOut: false, sort: 1 },
  { id: 'dish-2', categoryId: 'cat-hot', name: '清蒸鲈鱼', description: '鲜活现蒸，葱香入味', basePrice: 88, options: [], active: true, soldOut: false, sort: 2 },
  { id: 'dish-3', categoryId: 'cat-cold', name: '拍黄瓜', description: '蒜香爽口', basePrice: 18, options: [], active: true, soldOut: false, sort: 1 },
  { id: 'dish-4', categoryId: 'cat-drink', name: '酸梅汤', description: '冰镇自制', basePrice: 12, options: [], active: true, soldOut: false, sort: 1 }
]
let mockCategories = JSON.parse(localStorage.getItem('mock.categories') || 'null') || initialCategories
let mockDishes: Dish[] = JSON.parse(localStorage.getItem('mock.dishes') || 'null') || initialDishes
let mockOrders: Order[] = JSON.parse(localStorage.getItem('mock.orders') || 'null') || [{ id: 'demo-order-1', sessionId: 'demo-session-1', tableId: 'table-1', batchNo: 1, status: 'pending', paymentStatus: 'paid', paymentMethod: 'wechat', paymentMode: 'simulated', items: [{ dishId: 'dish-1', name: '红烧肉', optionNames: ['份量: 标准份'], unitPrice: 48, quantity: 1, note: '', productionStatus: 'pending', serviceStatus: 'pending', refunds: [] }, { dishId: 'dish-3', name: '拍黄瓜', optionNames: [], unitPrice: 18, quantity: 1, note: '', productionStatus: 'pending', serviceStatus: 'pending', refunds: [] }], subtotal: 66, createdAt: new Date().toISOString() }]
let mockSessions = JSON.parse(localStorage.getItem('mock.sessions') || 'null') || [{ id: 'demo-session-1', tableId: 'table-1', status: 'open', openedAt: new Date().toISOString() }]
let mockTables: Table[] = JSON.parse(localStorage.getItem('mock.tables') || 'null') || []
for (let index = 1; index <= 8; index++) {
  const name = `${index}号桌`
  if (!mockTables.some(table => table.name === name)) mockTables.push({ id: `default-table-${String(index).padStart(2, '0')}`, name, active: true })
}
type MockSession = { id: string; tableId: string; status: 'open' | 'closed'; openedAt: string }
mockSessions = mockSessions as MockSession[]
const persist = () => { localStorage.setItem('mock.categories', JSON.stringify(mockCategories)); localStorage.setItem('mock.dishes', JSON.stringify(mockDishes)); localStorage.setItem('mock.orders', JSON.stringify(mockOrders)); localStorage.setItem('mock.sessions', JSON.stringify(mockSessions)); localStorage.setItem('mock.tables', JSON.stringify(mockTables)) }

export function saveSession(nextToken: string, nextStaff: Staff | null) { token = nextToken; staff = nextStaff; sessionStorage.setItem('restaurant.session', token); sessionStorage.setItem('restaurant.staff', JSON.stringify(staff)) }
export function clearSession() { saveSession('', null) }
export function currentStaff() { return staff }
async function ensureCloudAuth() {
  if (mockMode) return
  if (!cloudAuth) cloudAuth = (async () => {
    const auth = app!.auth({ persistence: 'local' })
    if (!auth.hasLoginState()) {
      const result: any = await auth.signInAnonymously()
      if (result?.error) throw new Error(result.error.message || 'CloudBase 匿名登录失败')
    }
  })()
  return cloudAuth
}
export async function call<T = any>(action: string, payload: any = {}): Promise<T> {
  if (!mockMode) {
    const response = await fetch(httpApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, payload })
    })
    if (!response.ok) throw new Error(`CloudBase HTTP 请求失败（${response.status}）`)
    const result: any = await response.json()
    if (!result?.ok) throw new Error(result?.error || '请求失败')
    if (action === 'menu' || action === 'admin.overview') {
      result.data.categories = normalizeCategories(result.data.categories)
      result.data.dishes = (result.data.dishes || []).map((dish: Dish) => ({ ...dish, imageUrl: dish.imageUrl || dishImages[dish.name] || '' }))
    }
    return result.data as T
  }
  const result = mockCall(action, payload)
  if (action === 'menu' || action === 'admin.overview') {
    result.categories = normalizeCategories(result.categories)
    result.dishes = (result.dishes || []).map((dish: Dish) => ({ ...dish, imageUrl: dish.imageUrl || dishImages[dish.name] || '' }))
  }
  return result as T
}

// Older deployed overview responses expose CloudBase's _id instead of id.
function normalizeCategories(categories: (Category & { _id?: string })[] = []): Category[] {
  return categories.map(category => ({ ...category, id: category._id || category.id }))
    .filter(category => Boolean(category.id) && Boolean(category.name?.trim()))
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
}

function mockCall(action: string, payload: any): any {
  if (action === 'auth.login') {
    if (!['admin', 'frontdesk', 'kitchen'].includes(payload.username) || payload.password !== 'ChangeMe123!') throw new Error('演示账号：admin、frontdesk 或 kitchen；密码均为 ChangeMe123!')
    const user = { _id: `demo-${payload.username}`, username: payload.username, role: payload.username as Role }
    saveSession('demo-token', user); return { token: 'demo-token', staff: user }
  }
  if (action === 'auth.me') return { staff }
  if (action === 'auth.changePassword') return { ok: true }
  if (action === 'admin.bootstrap') { if (payload.password !== 'ChangeMe123!') throw new Error('演示模式初始化口令为 ChangeMe123!'); return { message: '演示管理员已就绪' } }
  if (action === 'menu') return { categories: mockCategories, dishes: mockDishes }
  if (action === 'category.save') {
    const entry = { id: payload.id || crypto.randomUUID(), name: payload.name, sort: Number(payload.sort || 0), active: true }
    mockCategories = payload.id ? mockCategories.map((item: Category) => item.id === payload.id ? entry : item) : [...mockCategories, entry]; persist(); return { id: entry.id }
  }
  if (action === 'dish.save') {
    const entry = { ...payload, id: payload.id || crypto.randomUUID(), active: payload.active !== false, soldOut: Boolean(payload.soldOut), sort: Number(payload.sort || 0) }
    mockDishes = payload.id ? mockDishes.map(item => item.id === payload.id ? entry : item) : [...mockDishes, entry]; persist(); return { id: entry.id }
  }
  if (action === 'dish.setAvailability') { mockDishes = mockDishes.map(item => item.id === payload.id ? { ...item, active: payload.active, soldOut: payload.soldOut } : item); persist(); return { ok: true } }
  if (action === 'table.create') { const table = { id: crypto.randomUUID(), name: payload.name, active: true }; mockTables.push(table); persist(); return table }
  if (action === 'table.list') return mockTables.map((table: any) => ({ ...table, currentSession: mockSessions.find((session: MockSession) => session.tableId === table.id && session.status === 'open') || null }))
  if (action === 'admin.overview') {
    const start = Date.parse(payload.dayStart)
    const end = Date.parse(payload.dayEnd)
    const todayRevenue = mockOrders.filter((order: Order) => {
      const paidAt = Date.parse(order.paidAt || order.createdAt)
      return (order.paymentStatus === 'paid' || order.status === 'paid') && paidAt >= start && paidAt < end && order.status !== 'canceled'
    }).reduce((sum: number, order: Order) => sum + Number(order.subtotal || 0) - Number(order.refundedTotal || 0), 0)
    return { openSessions: mockSessions.filter((session: MockSession) => session.status === 'open').length, openOrders: mockOrders.filter((order: Order) => ['pending', 'confirmed', 'preparing'].includes(order.status)).length, tables: mockTables.length, todayRevenue, categories: mockCategories, dishes: mockDishes, sessions: mockSessions.filter((session: MockSession) => session.status === 'open'), orders: mockOrders.filter((order: Order) => mockSessions.some((session: MockSession) => session.id === order.sessionId && session.status === 'open')) }
  }
  if (action === 'kitchen.list') return mockOrders.filter(order => ['confirmed', 'preparing'].includes(order.status))
  const order = mockOrders.find((item: Order) => item.id === payload.orderId)
  if (action === 'order.confirm' && order) { if (order.paymentStatus !== 'paid') throw new Error('顾客尚未完成模拟支付'); order.status = 'confirmed' }
  if ((action === 'item.start' || action === 'item.ready' || action === 'item.serve') && order) {
    const item = order.items[payload.itemIndex]
    if (!item) throw new Error('找不到对应菜品')
    if (action === 'item.start') { item.productionStatus = 'preparing'; order.status = 'preparing' }
    if (action === 'item.ready') { item.productionStatus = 'ready'; if (order.items.every(entry => entry.productionStatus === 'ready')) order.status = 'ready' }
    if (action === 'item.serve') { item.serviceStatus = 'served'; if (order.items.every(entry => entry.serviceStatus === 'served')) order.status = 'served' }
  }
  if (action === 'item.refund' && order) { const item = order.items[payload.itemIndex]; item.refunds = [...(item.refunds || []), { quantity: payload.quantity, reason: payload.reason }]; order.refundedTotal = (order.refundedTotal || 0) + item.unitPrice * payload.quantity }
  if (action === 'session.checkout') throw new Error('请在小程序中完成每批模拟支付，并在菜品上齐后由顾客结束本桌')
  if (action === 'session.cancel') { const session = mockSessions.find((session: MockSession) => session.id === payload.sessionId); if (session) session.status = 'closed'; mockOrders.filter((order: Order) => order.sessionId === payload.sessionId).forEach((order: Order) => order.status = 'canceled'); persist(); return { ok: true } }
  persist(); return { ok: true }
}

export async function uploadImage(file: File): Promise<{ fileID: string; url: string }> {
  if (mockMode) {
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file) })
    return { fileID: dataUrl, url: dataUrl }
  }
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file) })
  const result: any = await call('image.upload', { extension, mimeType: file.type, base64 })
  // The authenticated cloud function uploads the image; no separate anonymous
  // CloudBase identity is needed merely to preview a file selected locally.
  return { fileID: result.fileID, url: URL.createObjectURL(file) }
}
