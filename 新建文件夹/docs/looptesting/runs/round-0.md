# Round 0 — 2026-11-12

## 盘点与本轮范围

- 覆盖内容：要求的顾客选桌、点餐、支付、订单查看、员工逐道处理与结束桌次；当前范围还包括真实 UI 与云端验证能力检查。
- 与上轮差异：本次执行用户要求的 loop-testing 流程，加入真实测试记录与隔离要求。
- 角色画像：第一次使用的小白顾客；前台与后厨员工。

## 实际操作与结果

### 客户流程模拟

- 通过临时 Node harness 模拟微信运行时：载入实际 `app.js`、页面 JS 与 `utils/api.js`；模拟冷启动旧缓存、无桌号菜单路由、桌号选择、提交订单、微信模拟支付、本桌订单页展示。
- 结果：PASS。冷启动清理旧桌号；未选桌时回选桌页；提交跳到本批支付；付款标记为 paid；订单页读到菜品；菜未上桌时 `canFinish=false`。
- 盲区：未实际渲染 WXML/WXSS；支付宝和银行卡点击及未付款订单页重试未实际执行。

### 云函数全状态流

- 对本地 `cloudfunctions/api/dist/index.js` 使用临时内存数据库和合成账号 token 调用 `main()`，无真实云端写入。
- 操作：`table.available` → `session.current` → `menu` → `order.create` → `payment.simulate` → `order.confirm` → `item.start` → `item.ready` → `item.serve` → `session.finish`。
- 断言：未付款执行 `order.confirm` 被拒绝；菜品未上桌执行 `session.finish` 被拒绝；菜品已上桌后 `session.finish` 成功，桌台变空闲。
- 结果：PASS。输出摘要：`PASS: table -> session -> order -> payment -> frontdesk confirm -> kitchen start/ready -> frontdesk served -> customer finish; unpaid confirmation and early finish are rejected`。
- 盲区：只测单菜订单；内存数据库不是 CloudBase；未覆盖并发、HTTP 网关、Web UI 和各角色登录流程。

### 构建与静态检查

- `npm run build:function`：通过。
- `npm run build:admin`：受限执行第一次报 `spawn EPERM`；经提升权限批准后构建通过，只有 Vite 大包体积警告。
- `node --check miniprogram\app.js`、`menu/index.js`、`tables/index.js`、`payment/index.js`、`orders/index.js`、`utils/api.js`：通过。
- 项目没有 `test` 脚本；本轮临时测试 harness 写入 `%TEMP%` 并在运行后删除。

### 沙箱阻塞

- `git rev-parse --show-toplevel`：`fatal: not a git repository`。
- `Test-Path D:\新建文件夹\.git`：`False`。
- 尝试启动 Git Bash：`couldn't create signal pipe, Win32 error 5`。
- 未能安全运行技能 `sandbox-setup.sh` 并创建 worktree；依据技能要求，不在用户主工作树继续修复/提交或完整循环。

## 本轮发现

```
new_P0: 0
new_P1: 1
new_P2: 0
new_P3: 0
cases_this_round: 0
```

- `ISSUE-001`：截图中的旧桌号缓存与提交失败场景未能在真实环境复验；当前本地修复只通过模拟。
- `ISSUE-002`：缺少 Git 仓库与 worktree 隔离导致 loop-testing BLOCKED。

## 轮末结算

- 是否收敛低风险轮：否。第 0 轮盘点阶段遇阻，未做全功能回归。
- `converged_streak`: 0/2。
- 下一步：提供可用 Git 仓库，或明确授权初始化隔离仓库后，从 R0 隔离基线开始完整 UI/API 验收。
