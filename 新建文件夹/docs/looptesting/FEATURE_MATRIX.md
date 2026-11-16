# FEATURE_MATRIX — 覆盖矩阵

> 状态针对本次验收证据；本地模拟 PASS 不等于已部署云端 PASS。

| 功能 | 入口 | 角色 | 场景 | 覆盖状态 | 最近轮次 | 关联 ISSUE | 证据 |
|---|---|---|---|---|---|---|---|
| 冷启动强制选桌、桌号缓存清理 | 小程序启动/选桌页 | 顾客 | 冷启动、无桌号返回选桌 | PASS（运行时模拟） | R0 | ISSUE-001 | `runs/round-0.md#客户流程模拟` |
| 桌台列表与桌次创建 | 小程序 + API | 顾客 | 1–8 桌、创建当前桌次 | PASS（内存 DB） | R0 | — | `runs/round-0.md#云函数全状态流` |
| 点餐提交并按批次快照 | 菜单页 + API | 顾客 | 单批提交、订单生成 | PASS（运行时/内存 DB） | R0 | — | `runs/round-0.md#云函数全状态流` |
| 三支付方式页面图标与真实视觉 | 支付页 | 顾客 | 微信/支付宝/银行卡逐项点选 | BLOCKED（只完成静态代码检查；未真实渲染） | R0 | — | `runs/round-0.md#盲区` |
| 模拟支付与未付款订单重试 | 支付页/订单页 + API | 顾客 | 微信支付、待付态 | BLOCKED（未模拟订单页重试及支付宝/银行卡） | R0 | — | `runs/round-0.md#客户流程模拟` |
| 本桌订单批次、菜品和支付状态展示 | 订单页 + API | 顾客 | 已付款单批展示菜品 | PASS（运行时模拟） | R0 | — | `runs/round-0.md#客户流程模拟` |
| 前台只能确认已付订单 | Web + API | 前台 | 未付款拒绝、已付确认 | BLOCKED（API 状态机通过；Web UI 未实际点按） | R0 | — | `runs/round-0.md#云函数全状态流` |
| 后厨逐道制作、标记备好 | Web + API | 后厨 | 单菜开始/备好 | BLOCKED（API 状态机通过；Web UI 和多菜未测） | R0 | — | `runs/round-0.md#云函数全状态流` |
| 前台逐道确认上桌 | Web + API | 前台 | 菜品备好后上桌 | BLOCKED（API 状态机通过；Web UI 未实际点按） | R0 | — | `runs/round-0.md#云函数全状态流` |
| 全桌付款且全部上桌才可结束 | 订单页 + API | 顾客 | 提前结束被拒、齐备后关闭 | BLOCKED（API 内存 DB 通过；齐备后的顾客 UI 未验证） | R0 | — | `runs/round-0.md#云函数全状态流` |
| 管理员菜单/桌台维护与 HTTP 网关连通 | Web + API | 管理员 | CRUD、部署连接 | BLOCKED（本轮未实测） | R0 | — | `runs/round-0.md#盲区` |

```
total_features: 11
covered: 4
pass: 4
fail: 0
blocked: 7
na: 0
cases_this_round: 0
```

> 尚未进入正式轮循环；此处 R0 的 PASS 是局部模拟证据，不构成全功能回归或收敛轮。
