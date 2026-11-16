const { invoke } = require('../../utils/api')
const labels = { pending: '待前台确认', confirmed: '待制作', preparing: '制作中', ready: '待上桌', served: '已上齐', paid: '已结账', canceled: '已取消' }
const paymentLabels = { unpaid: '待付款', paid: '已模拟付款' }
const productionLabels = { pending: '待制作', preparing: '制作中', ready: '已备好，待上桌' }

Page({
  data: { orders: [], tableName: '请选择桌号', grandTotal: '0.00', sessionId: '', sessionStatus: '', canFinish: false, finishReason: '完成付款并确认所有菜品上桌后可结束本桌' },
  onShow() { this.loadOrders(); this.startRefresh() },
  onHide() { this.stopRefresh() },
  onPullDownRefresh() { this.loadOrders().finally(() => wx.stopPullDownRefresh()) },
  onUnload() { this.stopRefresh() },
  startRefresh() { this.stopRefresh(); this.refreshTimer = setInterval(() => this.loadOrders(), 5000) },
  stopRefresh() { if (this.refreshTimer) clearInterval(this.refreshTimer); this.refreshTimer = null },
  async loadOrders() {
    try {
      const tableId = wx.getStorageSync('tableId')
      if (!tableId) {
        wx.navigateTo({ url: '/pages/tables/index' })
        return
      }
      const session = await invoke('session.current', { tableId })
      const result = await invoke('session.orders', { tableId, sessionId: session.id })
      const orders = result.orders.map(order => ({
        ...order,
        statusLabel: order.status === 'canceled' ? '已取消' : order.paymentStatus === 'paid' && order.status === 'served' ? '已付款 · 已上齐' : order.paymentStatus === 'paid' && order.status === 'pending' ? '已付款 · 待前台确认' : order.paymentStatus === 'unpaid' ? '待付款' : labels[order.status] || order.status,
        paymentLabel: paymentLabels[order.paymentStatus || 'unpaid'],
        paymentMethodLabel: ({ wechat: '微信支付', alipay: '支付宝', card: '银行卡' })[order.paymentMethod] || '',
        canPay: order.status !== 'canceled' && order.paymentStatus !== 'paid',
        createdLabel: new Date(order.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        subtotalLabel: Number(order.subtotal || 0).toFixed(2),
        items: order.items.map(item => ({
          ...item,
          optionLabel: (item.optionNames || []).join('、'),
          productionLabel: productionLabels[item.productionStatus] || (item.status === 'served' ? '已上桌' : '待制作'),
          serviceLabel: item.serviceStatus === 'served' || item.status === 'served' ? '已上桌' : '未上桌',
          amountLabel: (Number(item.unitPrice || 0) * Number(item.quantity || 0)).toFixed(2)
        }))
      }))
      const total = orders.reduce((sum, order) => sum + Number(order.subtotal || 0) - Number(order.refundedTotal || 0), 0)
      const activeOrders = orders.filter(order => order.status !== 'canceled')
      const unpaid = activeOrders.filter(order => order.paymentStatus !== 'paid').length
      const unserved = activeOrders.reduce((sum, order) => sum + order.items.filter(item => item.serviceStatus !== 'served' && item.status !== 'served' && (item.refunds || []).reduce((n, refund) => n + refund.quantity, 0) < item.quantity).length, 0)
      this.setData({ orders, grandTotal: total.toFixed(2), tableName: wx.getStorageSync('tableName') || '本桌', sessionId: result.session.id, sessionStatus: result.session.status, canFinish: activeOrders.length > 0 && !unpaid && !unserved && result.session.status === 'open', finishReason: unpaid ? `${unpaid} 批订单尚未付款` : unserved ? `${unserved} 道菜尚未上桌` : '所有订单已付款、菜品已上齐，可以结束本桌' })
    } catch (error) { wx.showToast({ title: error.message || '订单加载失败', icon: 'none' }) }
  },
  payOrder(event) {
    const order = this.data.orders.find(item => item.id === event.currentTarget.dataset.id)
    if (!order) return
    wx.setStorageSync('lastPaymentOrder', { id: order.id, batchNo: order.batchNo, subtotal: order.subtotal, tableId: order.tableId, tableName: this.data.tableName, createdAt: order.createdAt })
    wx.navigateTo({ url: `/pages/payment/index?orderId=${encodeURIComponent(order.id)}` })
  },
  finishSession() {
    if (!this.data.canFinish) return wx.showToast({ title: this.data.finishReason, icon: 'none' })
    wx.showModal({ title: '结束本桌', content: '本桌订单都已付款且菜品已上齐，确认结束本次用餐吗？', success: async result => {
      if (!result.confirm) return
      try {
        await invoke('session.finish', { tableId: wx.getStorageSync('tableId'), sessionId: this.data.sessionId })
        wx.removeStorageSync('tableId'); wx.removeStorageSync('tableName'); wx.removeStorageSync('draftCart')
        wx.reLaunch({ url: '/pages/tables/index' })
      } catch (error) { wx.showToast({ title: error.message || '暂时无法结束本桌', icon: 'none' }) }
    } })
  },
  goMenu() { wx.switchTab({ url: '/pages/menu/index' }) }
})
