const config = require('../config')

const demo = {
  tables: Array.from({ length: 8 }, (_, index) => ({ id: `demo-table-${index + 1}`, name: `${index + 1}号桌` })),
  categories: [{ id: 'cat-hot', name: '招牌热菜' }, { id: 'cat-cold', name: '凉菜小食' }, { id: 'cat-drink', name: '饮品' }],
  dishes: [
    { id: 'dish-1', categoryId: 'cat-hot', name: '红烧肉', description: '慢火炖煮，肥而不腻', basePrice: 48, imageFileId: '', options: [{ group: '份量', required: true, choices: [{ name: '标准份', priceDelta: 0 }, { name: '加大份', priceDelta: 18 }] }], active: true, soldOut: false },
    { id: 'dish-2', categoryId: 'cat-hot', name: '清蒸鲈鱼', description: '鲜活现蒸，葱香入味', basePrice: 88, imageFileId: '', options: [], active: true, soldOut: false },
    { id: 'dish-3', categoryId: 'cat-cold', name: '拍黄瓜', description: '蒜香爽口', basePrice: 18, imageFileId: '', options: [], active: true, soldOut: false },
    { id: 'dish-4', categoryId: 'cat-drink', name: '酸梅汤', description: '冰镇自制', basePrice: 12, imageFileId: '', options: [], active: true, soldOut: false }
  ]
}

function invoke(action, payload) {
  if (config.mock) return Promise.resolve(mockInvoke(action, payload))
  return wx.cloud.callFunction({ name: 'api', data: { action, payload } }).then(response => {
    const result = response.result
    if (!result || !result.ok) throw new Error(result?.error || '服务暂时不可用')
    return result.data
  })
}

function mockInvoke(action, payload = {}) {
  const tableId = payload.tableId || wx.getStorageSync('tableId') || 'demo-table-1'
  const sessions = wx.getStorageSync('demoSessions') || {}
  let session = sessions[tableId] || { id: `demo-session-${tableId}`, tableId, status: 'closed', openedAt: new Date().toISOString() }
  let orders = wx.getStorageSync('demoOrders') || []
  if (action === 'menu') return demo
  if (action === 'table.available') return demo.tables.map(table => ({ ...table, occupied: sessions[table.id]?.status === 'open' }))
  if (action === 'customer.login') return { demo: true, customerId: 'demo-customer' }
  if (action === 'session.current') {
    if (session.status !== 'open') session = { id: `demo-session-${tableId}-${Date.now()}`, tableId, status: 'open', openedAt: new Date().toISOString(), sharedCart: [], cartVersion: 0 }
    sessions[tableId] = session
    wx.setStorageSync('demoSessions', sessions)
    return session
  }
  if (action === 'cart.get') return { sessionId: session.id, version: session.cartVersion || 0, items: session.sharedCart || [] }
  if (action === 'cart.add') {
    const dish = demo.dishes.find(entry => entry.id === payload.dishId)
    if (!dish || !dish.active || dish.soldOut) throw new Error('这道菜已售罄或下架，请刷新菜单')
    const selections = payload.options && typeof payload.options === 'object' && !Array.isArray(payload.options)
      ? payload.options
      : Object.fromEntries((Array.isArray(payload.options) ? payload.options : []).map(value => {
        const group = (dish.options || []).find(entry => entry.choices.some(choice => choice.name === value))
        return group ? [group.group, value] : ['', '']
      }).filter(([group]) => group))
    const selectedGroups = []
    for (const group of dish.options || []) {
      const choiceName = selections[group.group]
      if (group.required && !choiceName) throw new Error(`请选择${group.group}`)
      if (choiceName) {
        const choice = group.choices.find(entry => entry.name === choiceName)
        if (!choice) throw new Error(`${group.group}规格无效`)
        selectedGroups.push({ group: group.group, name: choice.name, priceDelta: Number(choice.priceDelta || 0) })
      }
    }
    if (Object.keys(selections).some(groupName => !selectedGroups.some(selection => selection.group === groupName))) throw new Error('菜品规格无效，请重新选择')
    const note = String(payload.note || '').slice(0, 100)
    const optionSelections = selectedGroups.map(({ group, name }) => ({ group, name }))
    const options = selectedGroups.map(selection => selection.name)
    const cartKey = `${dish.id}:${JSON.stringify(optionSelections)}:${note}`
    const sharedCart = session.sharedCart || []
    const existing = sharedCart.find(item => item.cartKey === cartKey)
    if (existing && existing.quantity >= 20) throw new Error('同一道菜最多点 20 份')
    const line = { cartKey, dishId: dish.id, name: dish.name, quantity: (existing?.quantity || 0) + 1, options, optionSelections, optionNames: selectedGroups.map(selection => `${selection.group}: ${selection.name}`), optionLabel: options.join('、'), note, basePrice: dish.basePrice, unitPrice: dish.basePrice + selectedGroups.reduce((sum, selection) => sum + selection.priceDelta, 0) }
    session.sharedCart = existing ? sharedCart.map(item => item.cartKey === cartKey ? line : item) : [...sharedCart, line]
    session.cartVersion = (session.cartVersion || 0) + 1
    sessions[tableId] = session; wx.setStorageSync('demoSessions', sessions)
    return { items: session.sharedCart, version: session.cartVersion }
  }
  if (action === 'cart.change') {
    const sharedCart = session.sharedCart || []
    const existing = sharedCart.find(item => item.cartKey === payload.cartKey)
    if (!existing) throw new Error('这道菜已被同桌移出，请刷新点餐单')
    const quantity = existing.quantity + Number(payload.delta)
    if (quantity > 20) throw new Error('同一道菜最多点 20 份')
    session.sharedCart = quantity > 0 ? sharedCart.map(item => item.cartKey === payload.cartKey ? { ...item, quantity } : item) : sharedCart.filter(item => item.cartKey !== payload.cartKey)
    session.cartVersion = (session.cartVersion || 0) + 1
    sessions[tableId] = session; wx.setStorageSync('demoSessions', sessions)
    return { items: session.sharedCart, version: session.cartVersion }
  }
  if (action === 'cart.clear') {
    session.sharedCart = []; session.cartVersion = (session.cartVersion || 0) + 1
    sessions[tableId] = session; wx.setStorageSync('demoSessions', sessions)
    return { items: session.sharedCart, version: session.cartVersion }
  }
  if (action === 'order.create') {
    const cart = session.sharedCart || []
    if (!cart.length) throw new Error('本桌共享点餐单为空，请刷新后重试')
    const items = cart.map(item => {
      const dish = demo.dishes.find(entry => entry.id === item.dishId)
      const selected = item.optionSelections || []
      const unitPrice = dish.basePrice + selected.reduce((sum, selection) => {
        const group = (dish.options || []).find(entry => entry.group === selection.group)
        const choice = group?.choices.find(entry => entry.name === selection.name)
        return sum + Number(choice?.priceDelta || 0)
      }, 0)
      return { dishId: dish.id, name: dish.name, optionNames: item.optionNames || [], unitPrice, quantity: item.quantity, note: item.note || '', productionStatus: 'pending', serviceStatus: 'pending', refunds: [] }
    })
    const subtotal = items.reduce((total, item) => total + item.unitPrice * item.quantity, 0)
    const order = { id: `demo-order-${Date.now()}`, sessionId: session.id, tableId, batchNo: orders.filter(item => item.sessionId === session.id).length + 1, status: 'pending', paymentStatus: 'unpaid', items, subtotal, createdAt: new Date().toISOString() }
    orders.push(order); wx.setStorageSync('demoOrders', orders)
    session.sharedCart = []; session.cartVersion = (session.cartVersion || 0) + 1
    sessions[tableId] = session; wx.setStorageSync('demoSessions', sessions)
    return { id: order.id, batchNo: order.batchNo, subtotal }
  }
  if (action === 'payment.simulate') {
    const order = orders.find(item => item.id === payload.orderId)
    if (!order || order.paymentStatus === 'paid') throw new Error('找不到待付款订单或订单已经付款')
    if (!['wechat', 'alipay', 'card'].includes(payload.method)) throw new Error('请选择支付方式')
    order.paymentStatus = 'paid'; order.paymentMethod = payload.method; order.paymentMode = 'simulated'; order.paidAt = new Date().toISOString()
    wx.setStorageSync('demoOrders', orders)
    return { orderId: order.id, paymentStatus: 'paid', paymentMethod: payload.method, paymentMode: 'simulated' }
  }
  if (action === 'session.orders') return { session, orders: orders.filter(order => order.sessionId === payload.sessionId) }
  if (action === 'session.finish') {
    const current = sessions[payload.tableId]
    const currentOrders = orders.filter(order => order.sessionId === payload.sessionId)
    if (!current || current.id !== payload.sessionId || current.status !== 'open') throw new Error('桌次与桌台不匹配')
    if (!currentOrders.length || currentOrders.some(order => order.paymentStatus !== 'paid' || order.items.some(item => item.serviceStatus !== 'served' && (item.refunds || []).reduce((n, refund) => n + refund.quantity, 0) < item.quantity))) throw new Error('请先完成全部订单付款并确认所有菜品上桌')
    current.status = 'closed'; wx.setStorageSync('demoSessions', sessions)
    return { ok: true }
  }
  return { ok: true }
}

module.exports = { invoke }
