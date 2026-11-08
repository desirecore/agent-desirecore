---
id: mem_delegate_unavailable_td_20260827
type: fact
pinned: true
created_at: 2026-08-27T18:58:00+08:00
topics: [orchestration, delegate, sendmessage, monitoring]
---

## L0

团队成员会话的工具集没有 Delegate，团队内委派用 SendMessage；中枢监控须直接查成员自己的 run，不能只看自己的子 run 列表。

## L1

### 事实
团队成员智能体（负责人及下属）的运行时工具集无 `Delegate`，团队内委派全部走
`SendMessage`（`wait=true` 同步等结果效果等同）。

### 对中枢监控方式的影响（关键）
`InspectRuns(action="list")` 不带 agentId 时只返回**当前会话委派出去的子 run**；
成员之间用 SendMessage 派发的 run 不挂在我的会话下：

- ❌ 只查自己的委派列表 → 误判"成员没在干活"
- ✅ `InspectRuns list agentId=<成员id>` 直查该成员最新 run，或 `ManageAgent list` 看谁离开 idle

### SendMessage 是否触发执行
| 参数 | 对方是否起轮 |
|---|---|
| `notifyOnly=true` | ❌ 只入 inbox |
| 默认（都不传） | ✅ 起一轮处理 |
| `wait=true` | ✅ 起轮且阻塞等回复 |

### 规则
1. 判断项目是否真在推进，查成员自己的 run，不查自己的委派列表
2. 要求负责人汇报"已派发"前先确认对方在跑
3. 连续两次"已启动"但成员仍 idle → 疑似 notifyOnly 坑，interject 纠正
