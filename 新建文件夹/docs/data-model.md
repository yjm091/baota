# 数据模型与 API

主键均使用 CloudBase 文档 `_id`。时间统一存 ISO 8601 UTC。订单相关集合只由 `api` 云函数读写。

## 集合

- `staff`: `{ username, passwordHash, role: 'admin'|'frontdesk'|'kitchen', active, mustChangePassword, createdAt }`
- `users`: `{ openid, displayName?, createdAt }`，只用于顾客身份映射。
- `categories`: `{ name, sort, active }`
- `dishes`: `{ categoryId, name, description, imageFileId?, basePrice, options: [{ group, required, choices: [{ name, priceDelta }] }], active, soldOut, sort }`
- `tables`: `{ name, active }`。小程序端只读取启用桌台的 ID、名称和是否已有开放桌次。
- `diningSessions`: `{ tableId, status: 'open'|'closed', openedAt, closedAt?, closedBy? }`
- `orders`: `{ sessionId, tableId, batchNo, userId, status, paymentStatus: 'unpaid'|'paid', paymentMethod?: 'wechat'|'alipay'|'card', paymentMode?: 'simulated', items: [{ dishId, name, optionNames, unitPrice, quantity, note, productionStatus: 'pending'|'preparing'|'ready', serviceStatus: 'pending'|'served', refunds: [{ quantity, reason, by, at }] }], subtotal, createdAt, confirmedAt?, paidAt?, servedAt?, canceledAt? }`
- `auditLogs`: `{ actorId, role, action, targetId, details, createdAt }`

## 云函数 action

所有 action 经 `api` 云函数路由。`menu`, `table.available`, `customer.login` 可公开调用；其他顾客 action 使用小程序 CloudBase 身份，员工 action 使用 scrypt 哈希和 HMAC 签名短期令牌。每个写操作仍由云函数校验角色与字段。

- 顾客：`menu`, `table.available`, `customer.login`, `session.current`, `order.create`, `payment.simulate`, `session.orders`, `session.finish`
- 管理员：`auth.login`, `auth.changePassword`, `admin.bootstrap`, `category.save`, `dish.save`, `dish.setAvailability`, `table.create`, `table.list`, `image.upload`
- 前台：`order.confirm`, `item.refund`, `item.serve`, `session.cancel`
- 后厨：`kitchen.list`, `item.start`, `item.ready`

写操作记录审计日志。订单创建时服务端读取现行菜单、验证上架与非售罄、重算金额并复制快照。顾客按订单批次完成模拟支付，前台才可确认订单交由后厨制作；后厨逐道标记备好，前台逐道确认上桌。全部订单均已付款、全部菜品均已上桌后，顾客才可结束本桌。退菜按菜品数量和状态校验；已关闭桌次不可追加订单。会话列表只返回桌次/菜品/价格/状态，不返回他人身份信息。
