# 技能索引 — DesireCore

> create-agent、update-agent、delete-agent、discover-agent 已迁移至全局技能层（`<根目录>/skills/`），
> 由 `syncBuiltinSkills()` 捆绑源自动同步，不再随 Agent 仓库分发。

> self-evolve（自我进化）已移出核心 Agent，改为市场可选装技能
> （[desirecore-agent/skill-self-evolve](https://github.com/desirecore-agent/skill-self-evolve)），
> 需要时经 DiscoverCapabilities / InstallCapability 选装。

## 流程型技能（Procedural Skills）

| 技能 ID | 描述 | 风险 |
|---------|------|------|
| [task-management](./task-management/SKILL.md) | 任务创建、分配、跟踪与多 Agent 编排 | low |
| [app-install-manager](./app-install-manager/SKILL.md) | v2 自主应用/插件安装、维护与实例事实登记；目录资料不授予执行权限，兼容旧服务协议 | high |

## 技能协作关系

```
            Agent 级技能
┌──────────────────────────────────────────────┐
│  ┌─────────────────┐ ┌─────────────────────┐ │
│  │ task-management │ │ app-install-manager │ │
│  │ （任务管理）    │ │ （应用安装）        │ │
│  └─────────────────┘ └─────────────────────┘ │
└──────────────────────────────────────────────┘

            全局技能（<根目录>/skills/）
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
├── task-management/               # 流程技能：任务管理与编排
│   └── SKILL.md
└── app-install-manager/           # 流程技能：应用/插件安装与维护
    └── SKILL.md
```
