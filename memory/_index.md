# 记忆索引 — DesireCore

## L0

系统中枢调度器的通用记忆。按 timeline/topics/pinned/lessons 组织。

## Lessons Learned

### 2026-04-16 — 团队创建时 DesireCore 绝不可当 TL
- **背景**：创建论文写作团队时，`manage_team` 的 `create` 操作默认将调用者设为组长，导致 DesireCore 被误设为 TL
- **教训**：创建团队前，必须先确保有一个独立的 TL Agent 已就绪（已有或新建），再创建团队并指定其为组长。DesireCore 始终是调度中枢，不加入任何团队
- **关联原则**：principles.md L1 第6条
