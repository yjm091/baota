const config = require('./config')

App({
  globalData: { config },
  onLaunch() {
    if (!config.mock && wx.cloud) wx.cloud.init({ env: config.envId, traceUser: true })
    // A table selection is local to the current visit. Reopen at table selection
    // so a stale selection cannot bypass the first step of the dining flow.
    wx.removeStorageSync('tableId')
    wx.removeStorageSync('tableName')
  }
})
