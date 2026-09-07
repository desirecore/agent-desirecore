---
id: mem_delegate_unavailable_td_20260827
type: fact
pinned: true
created_at: 2026-08-27T18:58:00+08:00
topics: [orchestration, delegate, sendmessage, monitoring, team-delegation]
---

## L0

技术总监会话无 Delegate 工具，改用 SendMessage 委派；中枢监控须直接查成员 run，不能看自己的子 run 列表。

## L1

### 事实（2026-08-27 实测，10 个 TL 中 5 个主动报告）
TD1/TD2/TD4/TD6/TD8/TD9/TD10 在实时快照里都写过类似：
> "Delegate 工具在当前运行时不可用，改用 SendMessage（wait=true 同步等结果）做委派，效果等同。"

即：**团队成员智能体的工具集里没有 Delegate**，它们的团队内委派全部走 SendMessage。

### 对中枢监控方式的直接影响（关键）
`InspectRuns(action="list")` 不带 agentId 时，只返回**当前会话委派出去的子 run**。
TL 用 SendMessage 派给 PM/开发的 run **不挂在我的会话下**，所以：

- ❌ 错误做法：`InspectRuns list`（我的）→ 只看到 10 个 TL 的 run → 误判"PM 和开发没在干活"
- ✅ 正确做法：`InspectRuns list agentId=chan-pin-jing-li-9` 直接查那个成员的最新 run
- ✅ 或用 `ManageAgent list` 看哪些 agent 离开 idle

### 委派是否真的触发执行的判据（SendMessage）
| 参数 | 对方是否起轮 |
|---|---|
| `notifyOnly=true` | ❌ 只入 inbox，不触发（本中枢 08-27 犯过的错） |
| 默认（都不传） | ✅ 对方起一轮处理 |
| `wait=true` | ✅ 起轮且阻塞等回复 |

### 规则
1. 判断项目是否真在推进，**查成员 agent 的 run**，不查自己的委派列表
2. 向 TL 下发纪律时，明确要求：汇报"已派发"前必须先用 InspectRuns 确认对方在跑
3. 若某 TL 连续两次汇报"已启动"但成员仍 idle → 判定它踩了 notifyOnly 坑，直接 interject 纠正
