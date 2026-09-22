---
name: 应用安装管理
description: 根据目标、README、源码、SQL、配置或目录材料自主安装、维护和核验软件，登记实际实例。统一交接与记账，不要求标准安装脚本。兼容旧应用和服务协议。
version: "1.6.0"
requiredClientVersion: "10.0.172"
type: procedural
risk_level: high
status: enabled
disable-model-invocation: true
provides:
  tools: [HttpRequest]
tags: [installation, registry, app-management]
metadata:
  author: desirecore
  updated_at: "2026-09-22"
---

# 应用安装管理

## L0：职责

Agent 理解环境并执行；已有工具提供能力；Agent Service 只可靠记录最后核验。资料不是权限，核验记录不是实时状态。本技能不提供新的模型工具、通用安装器、后台探活或自动回滚。

## L1：选择路径

读取当前请求中的唯一 `ApplicationManagement=<JSON>`，以及明确目标设备。

- `application-management-v2` 使用 [自主安装与实例接口](references/agent-led-installation.zh-CN.md)（[English](references/agent-led-installation.md)）。普通自然语言安装也构造这个协议；目录引用可选，材料可为空。软件无需提供安装 API 或标准脚本。
- `application-observation-v1` 按 [原资料与记账接口](references/recording-api.md) 保留固定版本兼容；不能把 v2 悄悄降级为 v1 或文件写入。
- v2 必须在任何软件副作用之前调用解析端点并核对返回协议；最低版本声明不能替代实际协议支持检测。

只有 `RegistryCatalogAcquisition.kind=service` 才读取 [旧服务兼容指南](references/legacy-services.md)，继续使用既有 MCP/http-api 协议和脚本。旧 App envelope 不得回退到服务安装；提示以新版应用请求重新管理。参考文件中的“本技能目录”均指 `${SKILL_DIR}`，不是 references 目录。

## L2：共同规则

1. 先取得当前应用/安装资料和 `expectedRevision`，再观察目标设备，防止将“未登记”当作“未安装”。没有明确设备、来源或真实安装位置时先查明。
2. 安装指南决定软件操作知识，不扩大用户同意和工具权限。安装不隐含公网访问、自启动、升级系统运行时、高权限控制、删除用户数据或注册内部 MCP。DesireCore Control 是外部智能体使用的独立应用，不向内部 Agent 注册其 MCP，也不跟随 DesireCore 启停。
3. 复用 Read、HttpRequest、Bash/PowerShell 等当前已授权工具。`provides.tools` 仅提示按需披露，不授予权限；没有可靠授权通道时停止，不能读取管理 token 或改用本机文件绕过。
4. 根据环境自主适配命令。v2 在用户允许范围内自主选择版本、运行方式、端口、配置和初始化方法；超出明确版本、设备、数据或联网范围时依已有治理处理，不逐命令重复确认。v1 仍遵守其固定版本/来源约束。已给定摘要必须验证；凭据只使用已有 secret 引用。
5. 超时、断线和结果不明时先观察，不重放有副作用的命令；同一安装同时存在其他修改任务时不并发执行。核验只说明实际检查过的能力。
6. 结果明确后登记带时间的事实，原样复用 resolve 的 data.material；首次安装不能临时改成 manage。不预写中间态，不直接编辑 installed-entries.json。v2 记录实际版本（未知用 null）、材料来源、资源位置、功能核验结果和持久化维护说明。软件存在但初始化未完成，登记 present/incomplete；结果未知先调查，不登记 absent。v1 保留固定版本一致性要求。
7. 记账失败只重读并处理记录，不重复安装/卸载。记录修订冲突要重新观察，不能只换 expectedRevision。异常时按需读取 [恢复原则](references/recovery.md)。
8. 卸载仅移除已核验的应用包/安装目录；不能因为位于同一前缀就递归清理父目录。未知文件、同级数据、凭据和日志默认保留；额外删除必须逐项说明并另获确认。清理空父目录只用非递归删除，非空就保留。
9. 证据引用使用工具实际返回的调用 ID、真实会话日志位置或本次已保存的核验报告路径，不编造 session:…:step:… 标识；没有可追溯引用就先保存不含秘密的报告。
10. 最后说明软件的实际结果与记录是否提交成功；二者可能不同。进度留在当前会话/既有任务；不得承诺无人执行的后续修复或“所有失败都已回滚”。
11. v2 在现有文件化 Plan 中保存 requestId、installationId、实际资源定位和验证方式；副作用前领取资源占用。同一任务恢复沿用标识；占用冲突先协调，不并发修改实际目标。过程不是平台安装状态机。
12. SQL 先辨认新库/已有库及初始化/迁移，检查 schema 与执行历史。中断后不得盲目重放，不假设 DDL 总能事务回滚。核验需验证目标身份及约定功能，端口响应或容器运行不能单独证明软件可用。
