# 餐厅点餐系统

单门店堂食点餐系统，包含微信原生小程序、React Web 工作台和 CloudBase 云函数。顾客进入小程序后先选择桌号，再浏览菜单、按订单批次模拟支付并查看本桌菜品进度；前台、管理员和后厨按角色处理同一桌次。

## 项目结构

- `miniprogram/`：原生微信小程序顾客端，开发期支持模拟桌台选择。
- `apps/admin/`：React + TypeScript 的管理、前台和后厨 Web 工作台。
- `cloudfunctions/api/`：TypeScript CloudBase 云函数 API，运行时数据采用 CloudBase 文档数据库。
- `docs/`：数据模型、权限与接入/部署说明。

## 本地开发

要求 Node.js 20 或更新版本、npm，以及微信开发者工具（运行小程序时）。

```sh
npm install
npm run dev:admin
```

默认管理端地址由 Vite 输出。管理端未配置 CloudBase 时会使用浏览器本地演示数据，便于查看完整界面与流程；该演示数据不会上传。连接 CloudBase 时，在 `apps/admin/.env.local` 配置 `VITE_CLOUDBASE_ENV_ID`、`VITE_CLOUDBASE_HTTP_API_URL` 和 `VITE_USE_MOCK=false`。小程序与云函数均从项目根目录导入微信开发者工具。部署步骤见 [docs/deployment.md](docs/deployment.md)。云函数本地构建：

```sh
npm run build:function
```

在微信开发者工具中导入 `miniprogram/`。项目已配置 AppID `wx7c24bace1dd57b9a`，将 `miniprogram/config.js` 的 `mock` 保持为 `true` 可使用八张模拟桌台；CloudBase 函数和集合部署好后设为 `false`。云端首次请求桌台列表时会幂等补齐 1 至 8 号桌，已有桌台记录会保留。

## CloudBase 部署

环境 ID 已配置为 `cloud1-d0gzbyfl738d13c13`。部署前先在控制台确认云函数、文档型数据库、云存储和 Web 托管已启用。函数使用 `wx-server-sdk` 访问文档集合，因此沿用该环境的文档数据库模式。参照 [`docs/deployment.md`](docs/deployment.md) 编译并上传 `api` 云函数、发布 Web 静态文件，并配置环境变量和首个管理员账号。不要把云 API 密钥放入小程序或浏览器构建产物。

### 真实微信能力

项目已配置 AppID `wx7c24bace1dd57b9a`。管理员创建桌台后，桌台会出现在小程序的桌号列表中；当前点餐流程不生成或扫描桌台二维码。开发阶段可使用模拟身份，Web 演示账号为 `admin`、`frontdesk` 或 `kitchen`，密码均为 `ChangeMe123!`；此口令只适用于本机 mock 数据。云端部署前必须设置强随机管理员初始口令和 `SESSION_SECRET`，初始化后立即改密。

## 核心规则

- 用餐单按桌台当前开放桌次聚合；每次提交形成独立订单批次。
- 菜品、规格和单价在提交时复制到订单明细，菜单改价不影响历史订单。
- 顾客对每一批订单完成模拟支付后，前台确认订单进入制作；后厨逐道更新制作状态，前台逐道确认菜品已上桌。前台可退单品并需填写原因。
- 顾客选择桌号后可查看整桌菜品与状态，不显示其他顾客身份资料。
- 提交订单后进入支付页，可选择微信、支付宝或银行卡完成模拟支付；页面会明确提示不会发生真实扣款。全部订单已付款且全部菜品已上桌后，顾客才能结束本桌并关闭桌次。
- 图片存储使用 CloudBase 云存储 fileID；售罄状态由管理员手动维护。

## 安全与运营

角色权限在云函数内校验，不能依赖前端隐藏按钮。订单金额由服务端根据菜单重新计算；退菜、结账和状态变更均由服务端执行。CloudBase 集合安全规则应设为仅云函数可读写。请先按部署文档初始化菜品与桌台，再用于真实营业。
