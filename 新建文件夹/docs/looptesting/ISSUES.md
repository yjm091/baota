# ISSUES — 问题总账

### ISSUE-001 | P1 | FIXED_UNVERIFIED | 旧桌号缓存可能绕过选桌流程并导致提交订单失败
- 类型: 流程
- 发现轮次: R0    最近轮次: R0    功能/角色: 选桌与提交订单 / 顾客
- 环境: 用户提供的微信开发者工具截图；当前源码 `miniprogram/pages/menu/index.js` 与 `miniprogram/app.js`。
- 复现: 保留小程序旧的 `tableId` 本地缓存并从菜单页继续点餐；截图显示菜单页带有桌号且提交后出现桌次相关错误。
- 期望: 每次冷启动先选择桌号；提交前桌号和桌次仍有效；失效后返回选桌页并可恢复。
- 实际: 截图显示菜单可达但提交失败。当前本地代码已在冷启动清理桌号、提交前查询 `table.available`，并在失效时清理状态回选桌；尚未在真实微信工具/CloudBase 重放原场景。
- 证据: 用户截图 `codex-clipboard-0b5a1e7a-4d30-40d0-9aa5-e01294889e0d.png`；本地路径门禁与提交流程模拟见 `runs/round-0.md#客户流程模拟`。
- 根因: 本地菜单页曾将缓存 `tableId` 当成有效桌号；真实云端失败的精确触发条件仍待开发者工具复现。
- 修复/阻塞原因: 此轮开始前已有本地修复；loop-testing 无法创建隔离 worktree，因此不得在此工作树继续修复或提交。
- 验证: 本地模拟通过；原用户截图场景未在真实微信开发者工具和已部署 CloudBase 上原样重放，保持未验证。
- 提交: 无（当前文件夹不是 Git 仓库）。

### ISSUE-002 | P1 | BLOCKED | 无法按 loop-testing 要求建立隔离工作树
- 类型: ENV
- 发现轮次: R0    最近轮次: R0    功能/角色: 全量验收 / QA
- 环境: `D:\新建文件夹`。
- 复现: 执行 `git rev-parse --show-toplevel`，结果 `fatal: not a git repository`；检查 `D:\新建文件夹\.git` 得到不存在。Git Bash 启动错误：`couldn't create signal pipe, Win32 error 5`。
- 期望: 使用技能 `sandbox-setup.sh` 创建独立 qa worktree 后再运行交互验收。
- 实际: 项目没有 Git 元数据，无法建立基线提交或 worktree；当前受限环境中的 Git Bash 也未能启动。
- 证据: `runs/round-0.md#沙箱阻塞`。
- 根因: 提供的项目目录是无版本库的文件夹；技能要求的隔离执行条件不成立。
- 修复/阻塞原因: 初始化 Git 会把项目文件纳入新的版本控制并可能涉及敏感/生成文件，不在本次 QA 授权范围；继续在主工作目录改代码违反技能红线。
- 验证: 只读检查已确认；未执行代码修改或部署。
- 提交: —
