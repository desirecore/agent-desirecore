# 技能索引 — DesireCore

> create-agent、update-agent、delete-agent、discover-agent 已迁移至全局技能层（`~/.desirecore/skills/`），
> 由 `syncBuiltinSkills()` 捆绑源自动同步，不再随 Agent 仓库分发。

## 元技能（Meta-Skills）

| 技能 ID | 描述 | 风险 |
|---------|------|------|
| [self-evolve](./self-evolve/SKILL.md) | 在交互中学习，自主提出改进建议 | high |

## 流程型技能（Procedural Skills）

| 技能 ID | 描述 | 风险 |
|---------|------|------|
| [task-management](./task-management/SKILL.md) | 任务创建、分配、跟踪与多 Agent 编排 | low |

## 技能协作关系

```
            Agent 级技能
┌──────────────────────────────────────────────┐
│  ┌─────────────┐  ┌──────────────────┐       │
│  │ self-evolve  │  │ task-management   │       │
│  │ （进化）     │  │ （任务管理）      │       │
│  └─────────────┘  └──────────────────┘       │
└──────────────────────────────────────────────┘

            全局技能（~/.desirecore/skills/）
┌──────────────────────────────────────────────┐
│  ┌─────────────┐  ┌─────────────┐            │
│  │ create-agent │  │ delete-agent │            │
│  │ （创建）     │  │ （删除）     │            │
│  └──────┬──────┘  └─────────────┘            │
│         │                                    │
│         ↓                                    │
│  ┌─────────────┐  ┌──────────────┐           │
│  │ update-agent │  │discover-agent│           │
│  │ （更新）     │  │ （发现）     │           │
│  └─────────────┘  └──────────────┘           │
└──────────────────────────────────────────────┘
```

## 目录结构

```
skills/
├── _index.md                      # 本文件：技能索引
├── self-evolve/                   # 元技能：自主学习与进化
│   └── SKILL.md
└── task-management/               # 流程技能：任务管理与编排
    └── SKILL.md
```
