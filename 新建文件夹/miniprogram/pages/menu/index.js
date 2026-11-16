const { invoke } = require('../../utils/api')
const { dishImages } = require('../../utils/dish-images')

Page({
  data: { categories: [], dishes: [], visibleDishes: [], activeCategory: '', cart: [], cartCount: 0, cartTotal: '0.00', cartOpen: false, tableName: '请选择桌号', tableId: '', sessionId: '', cartVersion: 0, tableReady: false, selectedDish: null, selectedOptions: {}, dishNote: '' },
  onLoad() { this.loadPage() },
  onShow() {
    const tableId = wx.getStorageSync('tableId')
    if (!tableId) return wx.reLaunch({ url: '/pages/tables/index' })
    if (this.data.tableId && this.data.tableId !== tableId) {
      this.setData({ tableId, sessionId: '', cartVersion: 0, cart: [], cartOpen: false })
      this.loadPage()
    } else {
      this.loadSharedCart()
    }
    this.setData({ tableId, tableName: wx.getStorageSync('tableName') || '已选桌台', tableReady: true })
    this.startCartSync()
  },
  onHide() { this.stopCartSync() },
  onUnload() { this.stopCartSync() },
  chooseTable() { wx.navigateTo({ url: '/pages/tables/index' }) },
  async loadPage() {
    const tableId = wx.getStorageSync('tableId')
    if (!tableId) return wx.reLaunch({ url: '/pages/tables/index' })
    this.setData({ tableId, tableName: wx.getStorageSync('tableName') || '已选桌台', tableReady: true })
    try {
      const [menu, session] = await Promise.all([invoke('menu'), invoke('session.current', { tableId })])
      const categories = (Array.isArray(menu.categories) ? menu.categories : []).map(category => ({ ...category, id: category.id || category._id }))
      const dishes = (Array.isArray(menu.dishes) ? menu.dishes : []).map(dish => ({ ...dish, id: dish.id || dish._id, imageUrl: dish.imageUrl || dishImages[dish.name] || '' }))
      if (!getApp().globalData.config.mock) {
        const imageIds = dishes.filter(item => item.imageFileId).map(item => item.imageFileId)
        if (imageIds.length) {
          try {
            const result = await wx.cloud.getTempFileURL({ fileList: imageIds })
            const imageMap = new Map(result.fileList.map(file => [file.fileID, file.tempFileURL]))
            dishes.forEach(item => { item.imageUrl = imageMap.get(item.imageFileId) || item.imageUrl })
          } catch (error) { console.warn('菜品云图片暂不可用，使用本地菜品图', error.message) }
        }
      }
      const activeCategory = categories[0]?.id || ''
      this.setData({ categories, dishes, activeCategory, visibleDishes: dishes.filter(item => item.categoryId === activeCategory), sessionId: session.id })
      await this.loadSharedCart()
    } catch (error) { wx.showToast({ title: error.message || '菜单加载失败', icon: 'none' }) }
  },
  selectCategory(event) { this.setData({ activeCategory: event.currentTarget.dataset.id }); this.filterDishes() },
  filterDishes() { this.setData({ visibleDishes: this.data.dishes.filter(item => item.categoryId === this.data.activeCategory) }) },
  addDish(event) {
    const dish = this.data.dishes.find(item => item.id === event.currentTarget.dataset.id)
    const selectedOptions = {}
    for (const group of dish.options || []) if (group.required && group.choices.length) selectedOptions[group.group] = group.choices[0].name
    this.setData({ selectedDish: dish, selectedOptions, dishNote: '' })
  },
  chooseOption(event) { this.setData({ [`selectedOptions.${event.currentTarget.dataset.group}`]: event.currentTarget.dataset.name }) },
  changeNote(event) { this.setData({ dishNote: event.detail.value }) },
  closeDish() { this.setData({ selectedDish: null }) },
  stop() {},
  async confirmDish() {
    const dish = this.data.selectedDish
    for (const group of dish.options || []) if (group.required && !this.data.selectedOptions[group.group]) return wx.showToast({ title: `请选择${group.group}`, icon: 'none' })
    const options = Object.values(this.data.selectedOptions)
    try {
      const result = await invoke('cart.add', { sessionId: this.data.sessionId, tableId: this.data.tableId, dishId: dish.id, options: this.data.selectedOptions, note: this.data.dishNote.trim() })
      this.applySharedCart(result)
      this.setData({ selectedDish: null })
    } catch (error) { wx.showToast({ title: error.message || '加入点餐单失败', icon: 'none' }) }
  },
  openCart() { this.setData({ cartOpen: true }) },
  closeCart() { this.setData({ cartOpen: false }) },
  async clearCart() {
    try {
      const result = await invoke('cart.clear', { sessionId: this.data.sessionId, tableId: this.data.tableId })
      this.applySharedCart(result)
      this.setData({ cartOpen: false })
    } catch (error) { wx.showToast({ title: error.message || '清空失败', icon: 'none' }) }
  },
  increaseItem(event) { this.changeSharedQuantity(event.currentTarget.dataset.key, 1) },
  decreaseItem(event) { this.changeSharedQuantity(event.currentTarget.dataset.key, -1) },
  async changeSharedQuantity(cartKey, delta) {
    try {
      const result = await invoke('cart.change', { sessionId: this.data.sessionId, tableId: this.data.tableId, cartKey, delta })
      this.applySharedCart(result)
    } catch (error) {
      wx.showToast({ title: error.message || '点餐单已更新，请刷新查看', icon: 'none' })
      this.loadSharedCart()
    }
  },
  applySharedCart(result) {
    const version = Number(result.version || 0)
    if (version < this.data.cartVersion) return
    this.setData({ cart: Array.isArray(result.items) ? result.items : [], cartVersion: version })
    this.refreshCart()
  },
  async loadSharedCart() {
    if (!this.data.sessionId || this._cartSyncInFlight) return
    this._cartSyncInFlight = true
    try {
      const result = await invoke('cart.get', { sessionId: this.data.sessionId, tableId: this.data.tableId })
      this.applySharedCart(result)
    } catch (error) {
      if (/桌次已结束|重新选择桌号/.test(error.message || '')) wx.showToast({ title: '桌次已结束，请重新选桌', icon: 'none' })
    } finally { this._cartSyncInFlight = false }
  },
  startCartSync() {
    this.stopCartSync()
    this._cartSyncTimer = setInterval(() => this.loadSharedCart(), 2500)
  },
  stopCartSync() {
    if (this._cartSyncTimer) clearInterval(this._cartSyncTimer)
    this._cartSyncTimer = null
  },
  refreshCart() {
    const count = this.data.cart.reduce((sum, item) => sum + item.quantity, 0)
    const cart = this.data.cart.map(item => ({ ...item, unitPriceLabel: Number(item.unitPrice || item.basePrice || 0).toFixed(2) }))
    const total = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
    this.setData({ cart, cartCount: count, cartTotal: total.toFixed(2) })
  },
  async submitOrder() {
    if (!this.data.cart.length) return
    if (!this.data.tableReady || !this.data.tableId) return wx.showToast({ title: '请先选择桌号', icon: 'none' })
    try {
      const availableTables = await invoke('table.available')
      const selectedTable = Array.isArray(availableTables) && availableTables.find(table => table.id === this.data.tableId)
      if (!selectedTable) throw new Error('桌台已不可用，请重新选择桌号')
      this.setData({ tableName: selectedTable.name })
      wx.setStorageSync('tableName', selectedTable.name)
      const session = await invoke('session.current', { tableId: this.data.tableId })
      if (!session?.id || session.tableId !== this.data.tableId || session.status !== 'open') {
        throw new Error('当前桌次无效，请重新选择桌号')
      }
      const result = await invoke('order.create', { sessionId: session.id })
      this.setData({ cart: [], cartOpen: false, cartVersion: Number(result.cartVersion || this.data.cartVersion + 1) }); this.refreshCart()
      wx.setStorageSync('lastPaymentOrder', { id: result.id, batchNo: result.batchNo, subtotal: Number(result.subtotal || 0), tableId: this.data.tableId, tableName: this.data.tableName, createdAt: new Date().toISOString() })
      wx.navigateTo({ url: `/pages/payment/index?orderId=${encodeURIComponent(result.id)}` })
    } catch (error) {
      const message = error.message || '提交失败'
      if (/桌次已结束|桌台.*不可用|桌号.*无效|重新选择桌号/i.test(message)) {
        wx.removeStorageSync('tableId')
        wx.removeStorageSync('tableName')
        wx.removeStorageSync('draftCart')
        this.setData({ tableId: '', tableName: '请选择桌号', tableReady: false, cart: [], cartCount: 0, cartTotal: '0.00' })
        wx.showModal({ title: '请重新选择桌号', content: '当前桌次已失效，返回桌号列表后重新选择餐桌即可继续。', showCancel: false, success: () => wx.reLaunch({ url: '/pages/tables/index' }) })
        return
      }
      wx.showToast({ title: message, icon: 'none' })
    }
  }
})
