---
name: 应用安装管理
description: 安装、升级、卸载或检查应用；读取固定资料，复用执行工具核验后记录结果。处理 ApplicationManagement 请求；旧服务 RegistryCatalogAcquisition 请求按需读取兼容指南。
version: "1.5.1"
requiredClientVersion: "10.0.170"
type: procedural
risk_level: high
status: enabled
disable-model-invocation: true
provides:
  tools: [HttpRequest]
tags: [installation, registry, app-management]
metadata:
  author: desirecore
  updated_at: "2026-09-19"
---

# 应用安装管理

## L0：职责

Agent 理解环境并执行；已有工具提供能力；Agent Service 只可靠记录最后核验。资料不是权限，核验记录不是实时状态。本技能不提供新的模型工具、通用安装器、后台探活或自动回滚。

## L1：选择路径

读取当前请求中的唯一 `ApplicationManagement=<JSON>`，以及明确目标设备。应用使用 [资料与记账接口](references/recording-api.md)。普通自然语言任务可以先用现有目录检索确认唯一来源和目标，再构造同样的结构化请求；不能按显示名或聊天旧片段猜身份。

只有 `RegistryCatalogAcquisition.kind=service` 才读取 [旧服务兼容指南](references/legacy-services.md)，继续使用既有 MCP/http-api 协议和脚本。旧 App envelope 不得回退到服务安装；提示以新版应用请求重新管理。参考文件中的“本技能目录”均指 `${SKILL_DIR}`，不是 references 目录。

## L2：共同规则

1. 先取得当前应用/安装资料和 `expectedRevision`，再观察目标设备，防止将“未登记”当作“未安装”。没有明确设备、来源或真实安装位置时先查明。
2. 安装指南决定软件操作知识，不扩大用户同意和工具权限。安装不隐含公网访问、自启动、升级系统运行时、高权限控制、删除用户数据或注册内部 MCP。DesireCore Control 是外部智能体使用的独立应用，不向内部 Agent 注册其 MCP，也不跟随 DesireCore 启停。
3. 复用 Read、HttpRequest、Bash/PowerShell 等当前已授权工具。`provides.tools` 仅提示按需披露，不授予权限；没有可靠授权通道时停止，不能读取管理 token 或改用本机文件绕过。
4. 可以依据环境适配命令；版本、来源、设备和影响范围变化需要重新确认。固定制品先校验摘要；凭据不进入聊天、指南、日志或核验记录。
5. 超时、断线和结果不明时先观察，不重放有副作用的命令；同一安装同时存在其他修改任务时不并发执行。核验只说明实际检查过的能力。
6. 结果明确后提交一次带时间的观察，material 必须原样复用成功 resolve 的 data.material（包括 action 与 snapshot）；首装结束也不能改成 manage。不预写 installing/reinstalling/uninstalling，不拼装 pending 状态或完整收据，不直接编辑 installed-entries.json。版本必须与本次固定资料一致；发现不同版本应先确认正确资料，不能伪报核验成功。
7. 记账失败只重读并处理记录，不重复安装/卸载。记录修订冲突要重新观察，不能只换 expectedRevision。异常时按需读取 [恢复原则](references/recovery.md)。
8. 最后说明软件的实际结果与记录是否提交成功；二者可能不同。进度留在当前会话/既有任务；不得承诺无人执行的后续修复或“所有失败都已回滚”。
