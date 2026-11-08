---
id: mem_2026-11-07-avatar-gen-default-provider-bypass
type: lesson
pinned: false
created_at: 2026-11-07T20:50:00+08:00
topics: [头像生成, 算力配置, image_gen, GenerateImage, 自动化任务]
---

## L0
头像生成失败"默认图像供应商不可用"时，用 GenerateImage(provider="desirecore-cloud") 显式指官方算力生成，再 avatarImage.source 挂载即可绕过。

## L1
### 事件（2026-11-07）
「历史默认头像补全」调度 594 次触发全部空转 + ManageAgent avatarGeneration 报
"failed（默认图像供应商不可用；未自动切换供应商，请在算力设置中调整）"。
根因：compute.json 的 `defaultServiceMap.image_gen` 指向 `provider-minimax-001`
（已禁用、无凭据），而系统**不自动切换**到已启用且同样提供 image-01 的
desirecore-cloud（官方算力）。

### 修复路径（已验证可用）
1. `GenerateImage(purpose="agent-avatar", provider="desirecore-cloud", model="image-01", prompt=...)`
   ——显式指定 provider 就绕开坏的默认解析；purpose=agent-avatar 强制 1:1/透明/写实风格
2. 视觉复核（抠图边缘/发丝/构图）
3. `ManageAgent(update, avatarImage={source: "dc-media://<mediaId>"})` 挂载
   ——落盘 assets/avatar.webp，generationPolicy 自动置 manual（自动任务不再覆盖）

### 排查要点
- 调度类任务"没跑"先查 `ManageSchedule get` 的 **admission_hold**（准入拦截，
  拦住时不产生任何 run 记录——grep runs 查不到≠任务没触发，fire_count 才是真相）
- 头像生成任务状态看 `ManageAgent(get)` 的"头像后台任务"行
- `defaultServiceMap`（compute.json）无类型化工具可改，只能 GUI 算力设置
  （desktopGuiControl 未开启时 GUI 工具报 ui_context_disabled，需用户在设置里改）
- 平台"严格静默"调度不能加 result_policy 用户通知（会被拒）；prompt 自足化是合法修法
