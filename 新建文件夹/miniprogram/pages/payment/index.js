const { invoke } = require('../../utils/api')

Page({
  data: { order: null, amount: '0.00', method: 'wechat', paying: false },

  onLoad(options) {
    const order = wx.getStorageSync('lastPaymentOrder')
    const orderId = options.orderId || order?.id
    this.setData({
      order: order && order.id === orderId ? order : null,
      amount: Number(order?.subtotal || 0).toFixed(2)
    })
  },

  selectMethod(event) { this.setData({ method: event.currentTarget.dataset.method }) },
  async confirmPayment() {
    if (!this.data.order || this.data.paying) return
    this.setData({ paying: true })
    try {
      await invoke('payment.simulate', { orderId: this.data.order.id, method: this.data.method })
      wx.removeStorageSync('lastPaymentOrder')
      wx.switchTab({ url: '/pages/orders/index' })
    } catch (error) {
      wx.showToast({ title: error.message || '模拟支付失败', icon: 'none' })
    } finally { this.setData({ paying: false }) }
  },
  goMenu() { wx.switchTab({ url: '/pages/menu/index' }) },
  goOrders() { wx.switchTab({ url: '/pages/orders/index' }) },
  chooseTable() { wx.redirectTo({ url: '/pages/tables/index' }) }
})
