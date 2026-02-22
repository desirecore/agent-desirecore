---
name: task-management
description: 创建、分配和跟踪任务，支持多 Agent 编排与进度追踪，确保每个任务被正确的 Agent 执行并按时完成。Use when 用户需要创建任务、指定执行者、查看任务进度，或需要协调多个 Agent 协作完成复杂任务。
version: "1.1.0"
type: procedural
risk_level: low
status: enabled
disable-model-invocation: false
requires:
  tools:
    - fetch_api
  optional_tools:
    - read_file
    - list_directory
tags: [task, management, orchestration]
metadata:
  author: desirecore
  updated_at: "2026-02-17"
---

# task-management 技能

## L0：一句话摘要

任务管理技能，负责任务的全生命周期管理：创建 → 分配 → 跟踪 → 完成。

## L1：概述与使用场景

### 能力描述

task-management 是一个**流程型技能（Procedural Skill）**，赋予 DesireCore 任务编排和管理的能力。它通过解析用户意图，将任务分配给最合适的 Agent，并跟踪执行进度直至完成。

### 使用场景

- 用户需要将一个任务委派给特定智能体
- 复杂任务需要拆解为子任务，分配给多个 Agent 协作完成
- 用户想查看当前任务的执行进度和状态
- 任务超时或失败时需要自动提醒和重新分配

### 核心价值

- **智能分配**：根据任务类型和 Agent 能力自动匹配最佳执行者
- **全程追踪**：实时监控任务状态，超时自动提醒
- **编排协调**：支持多 Agent 协作的复杂任务流

## L2：详细规范

### 执行流程

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   意图解析    │ ──→ │   能力匹配    │ ──→ │   任务创建    │
└──────────────┘     └──────────────┘     └──────────────┘
                                                  │
                                                  ↓
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   结果汇总    │ ←── │   状态跟踪    │ ←── │   任务下发    │
└──────────────┘     └──────────────┘     └──────────────┘
```

### 阶段 1：意图解析

**触发条件**：
- 用户说"帮我做..."、"安排..."、"让 XX 去做..."
- 用户描述了一个需要委派执行的任务
- 用户要求查看任务状态或进度

**解析内容**：

| 字段 | 说明 | 示例 |
|------|------|------|
| `task_type` | 任务类型 | 创建 / 查询 / 取消 |
| `objective` | 任务目标 | "审查这份合同" |
| `priority` | 优先级 | high / medium / low |
| `deadline` | 截止时间 | 可选 |
| `assignee` | 指定执行者 | 可选，未指定则自动匹配 |

### 阶段 2：能力匹配

**路由策略**：

| 策略 | 条件 | 说明 |
|------|------|------|
| 指定分配 | 用户明确指定 Agent | 直接分配给指定 Agent |
| 自动匹配 | 用户未指定 Agent | 根据任务类型匹配能力最优的 Agent |
| 发现推荐 | 无直接匹配 | 调用 discover-agent 技能推荐候选 |

**自动匹配逻辑**：
1. 解析任务所需的领域和技能
2. 查询在线且空闲的 Agent 列表
3. 按能力匹配度排序
4. 选择最优匹配或请用户确认

### 阶段 3：任务创建

**任务结构**：

```yaml
task:
  id: "task_<uuid>"
  objective: "审查供应商合同的风险条款"
  priority: high
  status: pending
  created_at: "2026-02-17T10:00:00Z"
  deadline: "2026-02-17T18:00:00Z"
  assignee:
    agent_id: "legal-assistant"
    agent_name: "法律顾问助手"
  subtasks: []  # 复杂任务可拆解为子任务
  context:
    user_input: "帮我看看这份合同有什么风险"
    attachments: []
```

### 阶段 4：任务下发

**下发方式**：
- 通过 Socket.IO 事件将任务发送给目标 Agent
- 携带完整任务上下文（用户需求、附件、历史对话片段）

**确认要求**：

| 任务风险 | 确认要求 |
|---------|---------|
| 低风险（信息查询等） | 直接下发，告知用户 |
| 中风险（数据处理等） | 简要确认后下发 |
| 高风险（涉及外部操作） | 详细确认后下发 |

### 阶段 5：状态跟踪

**状态机**：

```
pending → assigned → in_progress → completed
                  ↘             ↗
                   → failed → reassigned
                        ↓
                     cancelled
```

**跟踪机制**：
- 定期轮询任务状态
- 超时自动提醒（用户和执行 Agent）
- 失败时通知用户并建议重新分配

**进度报告格式**：

```
任务进度更新

任务：审查供应商合同的风险条款
执行者：法律顾问助手
状态：执行中 (60%)
已完成：
  - 合同条款逐条审查
  - 关键风险识别
进行中：
  - 修改建议撰写
预计完成：2026-02-17 14:00
```

### 阶段 6：结果汇总

**完成回执**：

```yaml
receipt:
  type: task-completion
  task_id: "task_abc123"
  status: completed
  completed_at: "2026-02-17T14:00:00Z"

  result:
    summary: "已完成合同风险审查，发现 3 处高风险条款"
    details_ref: "runs/<run_id>/output.md"

  metrics:
    duration_minutes: 240
    subtasks_completed: 3
    subtasks_total: 3

  follow_up:
    suggested_actions:
      - "查看详细审查报告"
      - "将修改建议发送给供应商"
```

### 与其他技能的协作

| 协作技能 | 协作方式 |
|---------|---------|
| discover-agent | 未指定执行者时，调用 discover-agent 推荐最合适的 Agent |
| create-agent | 需要的 Agent 类型不存在时，建议用户创建新 Agent |

### 复杂任务编排

**多 Agent 协作场景**：

```yaml
# 示例：年度财务报告任务拆解
composite_task:
  objective: "完成年度财务报告"
  subtasks:
    - id: sub_1
      objective: "收集并整理财务数据"
      assignee: data-analyst
      depends_on: []

    - id: sub_2
      objective: "审查数据合规性"
      assignee: legal-assistant
      depends_on: [sub_1]

    - id: sub_3
      objective: "撰写报告文档"
      assignee: writer-assistant
      depends_on: [sub_1]

    - id: sub_4
      objective: "最终审核和格式化"
      assignee: desirecore
      depends_on: [sub_2, sub_3]
```

### 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| 目标 Agent 不在线 | 提示用户，建议等待或选择其他 Agent |
| 任务执行超时 | 通知用户，提供选项：等待 / 催促 / 取消 / 重新分配 |
| 执行失败 | 收集失败原因，通知用户并建议重新分配 |
| 指定 Agent 能力不匹配 | 提醒用户，推荐更合适的 Agent |

### 权限要求

- 需要调用 `fetch_api` 工具访问 Agent 管理 API
- 任务创建和分配为低风险操作

### 依赖

- Agent Service HTTP API
- Socket.IO 实时事件系统
- Agent Registry 状态查询
