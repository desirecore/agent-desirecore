---
id: mem_notifyonly_not_launch
type: lesson
pinned: true
created_at: 2026-08-27T10:05:00Z
topics: [orchestration, delegate, verification, false-claim]
---

## L0
notifyOnly=true 只入 inbox 不触发执行；声称"已启动"前必须用 run/状态证据验证。

## L1

### 规则
1. **`notifyOnly=true` 不启动 pipeline**。只把消息投递到对方 inbox，对方不会起一轮。
   要对方真正执行任务用 **`Delegate`**（sync/async/fan-out），不是 SendMessage。
2. **`SendMessage` 参数是 camelCase**：`notifyOnly` / `wait`。蛇形命名会被参数校验拒绝。
3. **委派类承诺必须可验证**。报告"已启动/已派发"前至少确认一次：
   `ManageAgent list` 看目标离开 idle，或 `InspectRuns` 看真有子 run 产生。
   "通知已发送"只是投递成功，不代表已开始执行——两件事。
4. 只需知会（不要求对方动作）才用 notifyOnly，措辞说"已通知"而非"已启动"。

### 错误模式
把"消息已送达"当成"任务已开始"，用投递回执冒充执行证据。

### 正确节奏
派发 → 立即验证状态变化 → 才向用户报告启动。
