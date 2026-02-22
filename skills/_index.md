# 技能索引 — DesireCore

## 元技能（Meta-Skills）

元技能管理 Agent 的完整生命周期：创建、更新、删除、进化。

| 技能 ID | 描述 | 风险 |
|---------|------|------|
| [create-agent](./create-agent/SKILL.md) | 通过对话收集需求，调用 API 创建新 Agent | medium |
| [update-agent](./update-agent/SKILL.md) | 安全修改 Agent 配置、人格、规则和技能 | high |
| [delete-agent](./delete-agent/SKILL.md) | 安全删除指定的智能体及其关联数据 | high |
| [self-evolve](./self-evolve/SKILL.md) | 在交互中学习，自主提出改进建议 | high |

### 元技能共享配置

| 配置文件 | 说明 |
|---------|------|
| [_protected-paths.yaml](./_protected-paths.yaml) | 受保护路径配置（所有元技能共享） |

## 流程型技能（Procedural Skills）

流程型技能封装了具体业务流程，面向特定场景提供结构化执行能力。

| 技能 ID | 描述 | 风险 |
|---------|------|------|
| [task-management](./task-management/SKILL.md) | 任务创建、分配、跟踪与多 Agent 编排 | low |
| [discover-agent](./discover-agent/SKILL.md) | 根据用户需求推荐最匹配的智能体 | low |

## 技能协作关系

```
            Agent 生命周期（元技能）
┌──────────────────────────────────────────────┐
│                                              │
│  ┌─────────────┐  ┌─────────────┐            │
│  │ create-agent │  │ delete-agent │            │
│  │ （创建）     │  │ （删除）     │            │
│  └──────┬──────┘  └─────────────┘            │
│         │ 创建后可更新                         │
│         ↓                                    │
│  ┌─────────────┐  ┌─────────────┐            │
│  │ update-agent │←─│ self-evolve  │            │
│  │ （更新）     │  │ （进化）     │            │
│  └─────────────┘  └─────────────┘            │
│                                              │
└──────────────────────────────────────────────┘

            业务流程（流程型技能）
┌──────────────────────────────────────────────┐
│                                              │
│  ┌─────────────┐  ┌──────────────────┐       │
│  │discover-agent│─→│ task-management   │       │
│  │ （发现）     │  │ （任务管理）      │       │
│  └──────┬──────┘  └──────────────────┘       │
│         │ 无匹配时                             │
│         ↓                                    │
│  ┌─────────────┐                             │
│  │ create-agent │  ← 跨层调用                  │
│  └─────────────┘                             │
│                                              │
└──────────────────────────────────────────────┘
```

**协作说明**：
- `self-evolve` 在应用进化变更时调用 `update-agent` 的能力
- `task-management` 在未指定执行者时调用 `discover-agent` 推荐候选
- `discover-agent` 在无匹配时建议调用 `create-agent` 创建新 Agent
- `delete-agent` 删除前通过 `GET /api/agents` 检查 Agent 状态

## 目录结构

```
skills/
├── _index.md                      # 本文件：技能索引
├── _protected-paths.yaml          # 受保护路径配置（元技能共享）
├── create-agent/                  # 元技能：创建新 Agent
│   └── SKILL.md
├── update-agent/                  # 元技能：修改 Agent 配置
│   └── SKILL.md
├── delete-agent/                  # 元技能：删除 Agent
│   └── SKILL.md
├── self-evolve/                   # 元技能：自主学习与进化
│   └── SKILL.md
├── task-management/               # 流程技能：任务管理与编排
│   └── SKILL.md
└── discover-agent/                # 流程技能：智能体发现与推荐
    └── SKILL.md
```
