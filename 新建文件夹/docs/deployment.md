# 部署与凭据配置

环境：`cloud1-d0gzbyfl738d13c13`。本项目使用 CloudBase 文档型数据库、云函数、云存储和 Web 托管；保留现有环境，不执行数据库迁移。

## 1. 准备 CloudBase 环境

在 CloudBase 控制台确认环境可用，并启用文档型数据库、云存储、云函数及 Web 静态托管。创建以下集合：

`users`, `staff`, `categories`, `dishes`, `tables`, `diningSessions`, `orders`, `auditLogs`。首次管理员初始化会在管理员口令验证通过后自动补建缺失集合；如果部署的是旧版本函数，需先在控制台手动创建这些集合。

集合访问规则设为客户端拒绝直接读写，仅云函数可以访问。订单相关数据必须走 `api` 云函数，避免顾客端自行改价或修改状态。文档型数据库事务在环境支持时使用；云函数会对每桌活动用餐单和订单状态执行校验后写入。

## 2. 构建并上传云函数

在项目根目录运行：

```sh
npm install
npm run build:function
```

在控制台或 CloudBase CLI 中部署名为 `api` 的 Node.js **事件云函数**，入口为 `dist/index.main`。小程序通过 `wx.cloud.callFunction` 调用该事件函数；Web 工作台通过 HTTP 网关路由调用同一事件函数。HTTP 网关把请求包装为云函数事件，因此两个入口共用同一份业务逻辑、同一环境和同一数据库。不要把它误部署成另一套独立的 HTTP Web Server 函数。执行构建后上传整个 `cloudfunctions/api` 目录（须包含 `dist/` 与 `package.json`），并安装生产依赖。首次部署函数后配置环境变量：

- `CLOUDBASE_ENV_ID=cloud1-d0gzbyfl738d13c13`
- `ADMIN_BOOTSTRAP_USERNAME=admin`
- `ADMIN_BOOTSTRAP_PASSWORD`：使用密码管理器生成的强随机初始密码
- `FRONTDESK_BOOTSTRAP_PASSWORD`：至少 12 位；首次初始化时创建前台账号（用户名可由 `FRONTDESK_BOOTSTRAP_USERNAME` 配置，默认 `frontdesk`）
- `KITCHEN_BOOTSTRAP_PASSWORD`：至少 12 位；首次初始化时创建后厨账号（用户名可由 `KITCHEN_BOOTSTRAP_USERNAME` 配置，默认 `kitchen`）
- `SESSION_SECRET`：至少 32 字节随机值
- `MINIPROGRAM_ENV_VERSION`：可选，`release`、`trial` 或 `develop`，默认 `release`

当前云函数不生成桌台二维码，也不需要微信 OpenAPI 权限。CloudBase 控制台仍需将小程序 AppID `wx7c24bace1dd57b9a` 关联到环境 `cloud1-d0gzbyfl738d13c13`，以便小程序调用 `api` 云函数读取菜单、桌台和订单数据。

Web 登录页点“首次部署？初始化管理员”，输入 `ADMIN_BOOTSTRAP_PASSWORD`。云函数首次初始化管理员，并在配置相应环境变量时同时创建前台和后厨账号；三类账号首次登录都会要求改密。人员管理 UI 不属于首版范围。

HTTP 网关路由使用 `/restaurant-api`（或控制台中选择的等价路径），接收 JSON `{ "action": "...", "payload": {...} }`，员工会话令牌放在 `Authorization: Bearer <token>` 请求头中。当前代码由云函数处理跨域，网关的跨域校验应关闭，以免两处重复添加允许来源头；路由须放行 `POST` 和 `OPTIONS`。云函数默认只允许 `https://restaurant-admin-cloud1-d0gzbyfl738d13c13.webapps.tcloudbase.com`，如需其他管理端域名，可通过服务端 `ADMIN_WEB_ORIGINS` 设置以逗号分隔的完整来源（含协议和端口，不含路径、末尾斜杠），不使用通配符。HTTP 返回使用集成响应格式，小程序仍收到原有 `{ ok, data/error }`。如果改用网关统一处理跨域，必须同时移除云函数的跨域响应头，不能同时启用。网关请求没有可信微信 `OPENID` 上下文，因此顾客身份操作只能经小程序事件云函数入口完成。不要把云函数访问密钥放入 Web 构建配置。

## 3. 管理 Web 托管

在根目录执行 `npm run build:admin`，将 `apps/admin/dist` 发布至 CloudBase Web 静态托管。托管配置需将 SPA 路由回退到 `index.html`。构建环境变量：

- `VITE_CLOUDBASE_ENV_ID=cloud1-d0gzbyfl738d13c13`
- `VITE_CLOUDBASE_HTTP_API_URL`：控制台配置的 `api` HTTP 网关 HTTPS 完整地址
- `VITE_USE_MOCK=false`

独立静态托管域名使用 `apps/admin/.env.production.local` 配置完整网关地址。本地 `.env.local` 的 `/restaurant-api` 依赖 Vite 开发代理，不可直接用于独立静态网站。修改生产配置后须重新构建并上传 `dist`；只修改本地环境文件不会改变已发布网页。

Web 工作台通过 HTTPS HTTP 网关调用 `api`，员工权限由云函数内的账号会话令牌校验。图片上传通过同一 CloudBase 环境的 Web SDK 和云存储交互；如当前环境的存储规则要求登录，请在控制台启用匿名登录，并保持存储规则禁止客户端直接写入业务集合。

请只在公开配置中放环境 ID；SecretId、SecretKey、函数签名密钥和管理员口令不得写入 `VITE_*` 变量。

## 4. 小程序

在微信开发者工具导入项目根目录（`project.config.json` 已将小程序目录设为 `miniprogram/`、云函数目录设为 `cloudfunctions/`），项目已填入 AppID `wx7c24bace1dd57b9a`。小程序当前配置为真实云调用：

```js
module.exports = {
  envId: 'cloud1-d0gzbyfl738d13c13',
  mock: false
}
```

云开发初始化后，小程序通过 `wx.cloud.callFunction` 调用 `api` 普通入口，云函数从微信上下文读取顾客 OpenID。小程序启动后首先进入 `pages/tables/index`，从云函数读取启用桌台；顾客选择桌号后进入 `pages/menu/index`。每次提交点餐后进入 `pages/payment/index`，选择微信、支付宝或银行卡完成模拟支付；该功能不调用真实支付渠道。付款后的订单由前台确认，后厨逐道标记制作和备好，前台逐道确认上桌。仅当全部订单已付款且全部菜品已上桌时，顾客才可在订单页结束本桌。正式开放前需上传并发布小程序正式版。提交体验版前配置小程序隐私指引，并验证微信登录身份能映射到服务端顾客 ID。

## 5. 首次运营设置

登录管理员账号后新建分类、菜品和规格，上传菜品图片到 CloudBase 云存储。云端首次读取桌台列表时会自动补齐 1 至 8 号桌；已有桌台记录会保留，管理员可继续在工作台添加其他桌台。顾客打开小程序后从已启用桌台中选择桌号。前台与后厨账号通过受控的 `staff` 集合初始化流程发放，密码使用同样的哈希与首次改密策略。

## 发布前验收清单

- 使用顾客、前台、后厨、管理员四类账号分别验证权限。
- 测试两人同时对同桌提交、确认、加菜、退菜、结账和再次开桌。
- 验证停售菜品不能下单，历史订单保持原菜名/规格/金额。
- 验证图片只能通过已授权上传流程写入，顾客不能直接写订单集合。
- 配置定期数据库备份和云函数日志告警；先体验版验证，再发布正式版。
