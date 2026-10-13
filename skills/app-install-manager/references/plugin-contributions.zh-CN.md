# 插件与应用附属贡献的安装、维护与启停

[English](plugin-contributions.md) · [通用 v2 流程](agent-led-installation.zh-CN.md)

插件增加宿主能力，普通应用承载业务；普通应用也可携带贡献或仅使用直接依赖。productKind 表达主要归属，extension 表达贡献/依赖，不能因为带 extension 把应用改名为插件。系统应用保持原受信身份与保护策略，不伪造用户 installationId。

## 先确认目标和客户端契约

沿通用 v2 流程保存 Plan、解析精确实例并领取实际资源占用。目录首装读取 knowledge.productKind、type、extension、descriptorRequired；writer 提交前会重读同来源/产品，正文不能自报 knownProduct 绕过约束。没有这些知识且包明确是插件/扩展时调查实际客户端支持，不直接沿旧默认应用示例提交。旧客户端不理解 artifact、描述材料或设置 API 时停止并说明需更新，不删字段降级、不读 token 或手写账本。

材料来源是目录提供的固定产品或用户已授权材料。非目录包 sourceId 为 user-managed，id 对应 target.softwareId；不能只改来源标签宣称官方发布。名称不能替代 sourceId + appId + installationId + deviceId + hostInstanceId。

## 准备实际描述材料

在实际安装目录保存 AppDefinition JSON。它包含 sourceId、id、name、version、productKind、entrypoints、placementPolicy，以及贡献关系 extension。plugin 必须至少提供一项真实贡献，可以 entrypoints: []；仅使用依赖的 application 可以 contributes: []，但保留自己的有效入口。configurationSchemaRef、definitionRef、service descriptor 及 Skill 引用必须是包内规范相对路径和实际字节 SHA-256，不复制未核验的内联模型声明。

通过 GET /api/files/resolve-reference?agentId=<当前Agent>&path=<URL编码绝对路径> 获得描述文件的 resourceRef；按原始字节计算 SHA-256。登记 deployment.descriptor: {fileRef: resourceRef, sha256: 实际摘要}，并写实际 type、actualVersion、resources、materials、dataLocations 和 maintenance。描述版本须等于实际登记版本；不把目录版本替代未知部署事实。

目录插件/附属贡献首装的 deployment.type 必须与 knowledge.type 一致，并保留目录主要归属和扩展关系。缺少描述、丢失 extension、把 plugin 写成 application 或改变交付类别都会拒绝；先修复材料再登记，不反复执行软件副作用。纯声明包使用 artifact 且 runtime.kind=declarative，不填虚假端口/进程；MCP/HTTP 服务插件保留真实 native-app/docker-app 部署，其 runtime descriptor 只引用原连接/工具 owner 已登记的身份。运行/注册/授权工具仍走原治理，不因安装插件自动获得权限。

核验约定能力后用唯一 PATCH /api/installed-entries/instances/<installationId> 提交事实。非目录扩展同样提交描述。安装成功只说明安装事实，启用与实际健康分别读取；文档、模型回复或端口响应不能代替真实消费者验证。

## 配置、直接依赖和启停

GET /api/installed-entries/<installationId>/extensions 读取当前安装引用、installationRevision、manifestDigest、settings、configurationSchema、activation 和诊断。用包内已核验的 Draft-07 Schema 校验非秘密配置；不写明文凭据。任意新配置键不自动改变 UI/服务；需实际消费者契约，声明文字改动通过材料修订。

PATCH /api/installed-entries/<installationId>/extension-settings 提交真实 mutationId、当前 expectedRevision（初次为 none）、installationRevision、manifestDigest、enabled、完整 configuration 和 dependencyBindings。保留用户现有配置及依赖选择，不把无关字段置空。重试保持同 ID 和正文；409 先重读、合并用户最新选择，不能只替换修订强行覆盖。

启用不授予 Tool/Agent/团队/父 Run 权限。必需依赖缺失会阻塞，可选依赖缺失明确降级；按精确来源/产品/贡献及兼容版本选择现有安装。多候选必须显式选择，不能按名称猜测、自动下载/启用、级联卸载或清除共享服务。

停用后重新读取权威状态和诊断，区分已拒绝新调用与清理中/清理失败。只释放本实例引用，不停止其他主体共享的进程。请求失败、断线或迟到返回不能推定启停结果；重读当前 owner。

## 会话临时开发预览

自然语言定制先将实际 AppDefinition 和包内贡献 JSON 写入当前已授权工作目录，核验实际字节摘要，再取得描述文件的 resourceRef。预览路径为 `/api/agents/<agentId>/conversations/<conversationId>/plugin-preview`；使用当前可信会话的真实 Agent/Conversation 标识，不从名称猜测、不使用其他用户或会话的标识。服务从认证身份验证会话归属，描述引用还必须属于当前 Agent 与目标 hostInstanceId；API 地址、材料或模型声明本身不授予权限。

| 操作 | API 与正文 | 返回及后续 |
| --- | --- | --- |
| 读取 | `GET <预览路径>` | `data.preview` 为当前快照或 null；使用返回的 revision、hostInstanceId、agentId、conversationId 核对作用域。 |
| 创建/替换 | `PUT <预览路径>`，`{ "descriptor": { "fileRef": <实际resourceRef>, "sha256": "<实际摘要>" }, "configuration": {}, "expectedRevision": "none或当前revision" }` | 首次为 none，替换为当前 revision；成功才发布新快照，失败保留上一份。configuration 是完整的非秘密预览配置，省略则为空对象。 |
| 退出 | `DELETE <预览路径>`，`{ "expectedRevision": "<当前revision>", "mutationId": "<UUID>" }` | 成功返回 null，移除临时预览并恢复普通会话贡献；不会卸载或停用已经保存的正式实例。DELETE 也要求 mutationId，但不据此推定重试成功，丢回执后先 GET。 |
| 保存并使用 | `POST <预览路径>/save`，`{ "expectedRevision": "<当前revision>", "mutationId": "<UUID>" }` | 固定快照写入当前可写授权根，再经唯一安装 writer 和贡献设置 owner 登记、启用。完整成功返回 savedInstallationId；预览仍保留，退出需另行 DELETE。 |

当前临时预览仅接受 sourceId=user-managed、productKind=plugin、entrypoints=[]、runtime.kind=declarative、唯一宿主 agent-service 且无依赖的声明包。贡献限 session.widgets、session.panels 与 session.actions，动作仅 open-panel。它们由原生有限 UI 消费，不运行任意 HTML/JavaScript，也不在预览中执行工具、parser、Skill、服务或任意动作。其他贡献沿正式安装/授权/消费者核验流程，不删掉能力以伪装预览支持。通用 configuration Schema 只定义校验与保存；字段的显示或行为仍需真实消费者契约。

预览是创建/替换时已核验的固定历史材料快照。之后编辑或删除源文件不会静默更新它；继续修改时核验新材料，再 PUT 当前 revision。保存保留用户正在查看的快照，不重新读取源文件把未预览的修改带入正式版本。临时记录只在当前服务实例内存中存在，换实例或服务重启后不能声称恢复原预览；已正式保存的安装由原登记与设置 owner 恢复。

409 时 GET 并核对用户正在查看的快照，不只替换 expectedRevision 强行覆盖。断线或返回不明先 GET；若返回 pendingSaveMutationId，复用它和同一 revision 重试 /save，不生成第二个安装。完整成功则按 savedInstallationId 读取正式安装/设置状态。服务重启后预览为 null 时，先核对已记录的正式实例；不能把 null 当作此前保存没有发生，再重复创建。plugin-preview:changed 只提示同一可信会话重读，不携带材料或配置。根授权撤销或可信会话不可用时停止读取/保存并说明实际错误，不沿旧引用或读取 token 绕过。

## 更新、卸载与自然语言定制

更新/重装（即使版本相同）重新核验 AppDefinition、包内材料及摘要，经原 writer 提交新安装修订；不靠直接改文件热替换正式活动版本。权限扩大需要重新治理，配置必须通过新 Schema；失败不声称自动回滚。

卸载先明确停用、共享引用、真实进程及材料范围，默认保留用户数据。确认精确实例 absent 后提交卸载事实；旧描述文件已移除时可保留既有快照用于卸载和完全相同提交重放。已有实例可依据历史记录离线维护，不要求目录仍在架。

维护说明保存描述位置/摘要、配置与启停入口、工具/服务引用、核验方法、更新及共享数据保留规则。自然语言创建纯声明贡献先走客户端支持的会话开发预览，退出释放临时绑定；用户显式保存并使用后才保留正式材料并经过同一登记与设置 owner。不把生成文件或预览称为已安装/已启用，也不绕过审批创建分享/发布制品。
