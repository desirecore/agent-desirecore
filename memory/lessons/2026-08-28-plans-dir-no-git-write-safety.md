---
id: mem_plans_no_git_write_safety
type: lesson
pinned: false
created_at: 2026-08-28T06:55:00+08:00
topics: [plan-protocol, write-safety, revisions]
---

## L0
`.desirecore/plans/` 不在 git 管理、无 reflog：Write 覆盖 revision 文件或 PLAN.md 即永久丢失，写前必须先 Read+合并，绝不盲写。

## L1

- 教训形态：恢复长任务时未 `ls revisions/` 就直接 Write 新 revision 与 PLAN.md，覆盖旧版本；
  无 git 可回滚，只能靠工具 diff 的旧侧人工重建。
- 规则：
  1. 修改任何 PLAN.md / revisions/*.md 前先 Read 现内容；已有内容合并写入，不整体覆盖
  2. revisions 只能追加新编号（max+1），禁止改写/删除历史文件
  3. 委派多 Agent 长任务时，在任务书里加一句"写计划文件前先读现状"，降低成员侧同类事故
