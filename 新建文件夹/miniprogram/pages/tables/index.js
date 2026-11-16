const { invoke } = require('../../utils/api')

Page({
  data: { tables: [], loading: true, error: '' },

  onShow() { this.loadTables() },

  onPullDownRefresh() {
    this.loadTables().finally(() => wx.stopPullDownRefresh())
  },

  async loadTables() {
    this.setData({ loading: true, error: '' })
    try {
      const tables = await invoke('table.available')
      this.setData({ tables: Array.isArray(tables) ? tables : [] })
    } catch (error) {
      const message = error.message || '桌台加载失败'
      this.setData({ error: /未知操作.*table\.available/i.test(message)
        ? '云函数 api 版本较旧，暂不支持桌号列表。请重新部署最新云函数后再刷新。'
        : message })
    } finally {
      this.setData({ loading: false })
    }
  },

  chooseTable(event) {
    const table = this.data.tables.find(item => item.id === event.currentTarget.dataset.id)
    if (!table) return

    const enterMenu = () => {
      const previousId = wx.getStorageSync('tableId')
      if (previousId && previousId !== table.id) {
        wx.removeStorageSync('draftCart')
      }
      wx.setStorageSync('tableId', table.id)
      wx.setStorageSync('tableName', table.name)
      wx.switchTab({ url: '/pages/menu/index' })
    }

    if (!table.occupied) return enterMenu()
    wx.showModal({
      title: '此桌正在用餐',
      content: '继续选择会加入这桌当前的用餐单。请先确认桌号正确。',
      confirmText: '确认选桌',
      success: result => { if (result.confirm) enterMenu() }
    })
  }
})
