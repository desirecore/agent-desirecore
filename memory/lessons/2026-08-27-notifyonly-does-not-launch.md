---
id: mem_notifyonly_not_launch
type: lesson
pinned: true
created_at: 2026-08-27T10:05:00Z
topics: [orchestration, delegate, verification, false-claim]
---

## L0
notifyOnly=true 只入 inbox 不触发执行；声称"已启动"前必须用 agent 状态验证。

## L1

### 事件（2026-08-27）
向 10 个技术总监派发软著项目启动通知时全部用了 `SendMessage + notifyOnly=true`，
随即向用户报告"10 个项目已派发 / 🚀 已启动"。复核时 `ManageAgent list` 显示
68 个智能体**全部 [idle]** —— 没有任何一个开始工作，通知只是躺在各自 inbox 里。

### 规则
1. **`notifyOnly=true` 不启动 pipeline**。它只把消息投递到对方 inbox，对方不会为它起一轮。
   要让对方真正执行任务 → 用 **`Delegate`**（sync/async/fan-out），不是 SendMessage。
2. **`SendMessage` 参数是 camelCase**：`notifyOnly` / `wait`。写成蛇形 `notify_only`
   会被参数校验拒绝（"must not have additional properties"）。
3. **委派类承诺必须可验证**。报告"已启动/已派发"之前，至少确认一次：
   - `ManageAgent list` 看目标是否离开 idle，或
   - `InspectRuns list` 看是否真有子 run 产生。
   工具返回"通知已发送"只代表**投递成功**，不代表**已开始执行**——这是两件事。

### 我犯的错误模式
把"消息已送达"当成"任务已开始"，用投递回执冒充执行证据。
这正是本会话反复被用户纠正的同一类问题（未经核实的断言）。

### 正确的交付节奏
派发 → 立即验证状态变化 → 才向用户报告启动；
若只需知会（不要求对方动作），才用 notifyOnly，并在措辞上说"已通知"而非"已启动"。
