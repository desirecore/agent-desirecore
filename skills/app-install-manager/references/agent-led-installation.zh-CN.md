# Agent 自主安装与维护（v2）

[English](agent-led-installation.md)

所有请求使用活动 Agent Service 的既有 HttpRequest 能力及身份上下文。接口只解析、互斥和记账，不替你安装。不得读取 token 或直接写账本绕过失败。

## 交接与调查

如果用户已提供 ApplicationManagement，原样使用；否则用真实 UUID 构造下面的对象，将 requestId、installationId 写入现有 Plan。target.softwareId 是稳定软件 ID，目录软件取目录 entryId；自带材料软件生成软件 UUID，后续复用。安装实例 UUID 与软件 UUID 各自独立。维护已有实例必须先 GET /api/installed-entries，按精确身份选择 installationId，不按名称取第一条。

```json
{
  "protocol": "application-management-v2",
  "requestId": "替换为本次委派 UUID",
  "installationId": "替换为部署 UUID，恢复时复用",
  "deviceId": "local",
  "action": "install",
  "target": { "softwareId": "稳定软件ID", "name": "软件名", "description": "安装目标" },
  "desiredOutcome": "用户希望完成并验证的功能",
  "constraints": "用户明确的版本、数据、目录和网络范围",
  "materials": []
}
```

这是结构示意，UUID 占位文字必须替换。目录软件可在 target 添加 catalogSourceId；非目录软件不填。action 支持 install/manage/update/uninstall。local 指服务宿主，不一定是界面设备；其他 deviceId 必须是该服务已登记节点。远程命令走已有授权远程工具，不把远程 URL 当本机入口。

materials 每项含 purpose 和 url 或 fileRef（二选一），可附 revision、sha256。fileRef 使用已有签发引用；不要把绝对路径冒充 fileRef。SQL、源码、模板和大文件用引用，不复制正文到 JSON。URL 可以先浮动，再保存实际使用内容的 revision/hash；材料不是执行授权。

本地文件没有现成引用时，向活动服务 GET `/api/files/resolve-reference?agentId=<当前智能体ID>&path=<URL编码的绝对路径>`，将返回的顶层 `resourceRef` 作为 `fileRef`。服务会检查已登记根；不得编造 rootId 或扩大权限绕过拒绝。材料没有 `location` 字段。无法签发引用时，在维护说明保留实际路径和原因，并披露结构化引用缺失，不编造 URL。400 校验失败未写入登记：只修正被拒字段，保留已有部署和 SQL 状态，然后重试登记。

POST /api/registry/acquisitions/resolve，body 为上述对象。只有 success=true 且 data.protocol=application-management-v2 才继续，保存 data.material 与 expectedRevision。knowledge 是目录安装知识，可能没有 installGuide；缺失不等于禁止安装。record 包含历史实例、maintenance 和 observation。目录离线时使用已有实例资料继续。读到旧 v1 实例时，兼容解析返回其稳定 ID；写入 v2 后不可用 v1 修改。

解析后 material 中的 hostInstanceId 绑定账本宿主；后续请求必须原样保留。连接切换导致宿主不匹配时停止，不删除绑定去安装另一台机器。它用于目标核对，不授予权限。

读取说明、检查宿主和已有安装后，自主决定实际方法；有 Compose/脚本就评估使用，没有就根据 README、源码、配置和 SQL 形成方案。在约束内自行排错，无需软件实现统一安装接口。

## 实际资源占用

副作用前 POST /api/installed-entries/resource-claims：`{material, operation:"claim", resources:["实际绝对安装目录或稳定的容器/项目定位符"]}`。material 使用 resolve 原文。所有任务对同一资源使用同一种定位方式；Windows 盘符目录会规范大小写/分隔符，其他 locator 应保持稳定。共享数据库还要按服务器/库名领取占用，不能只锁软件目录。

冲突时先协调持有任务，不能换 UUID 并发执行。崩溃后不自动过期；同 requestId 可以恢复。只有确认当前请求没有在途副作用后，用相同 material/resources 和 operation=release 释放。不要因为 HTTP 断线就释放仍在执行的操作。资源占用只是协作互斥，不增加工具权限，也不保证外部程序都遵守。

## 验证并登记

插件、带贡献或直接依赖的普通应用，先读[贡献安装与启停](plugin-contributions.zh-CN.md)。目录首装 `knowledge` 的 `productKind`、`type`、`extension`、`descriptorRequired` 来自服务端目录；需要描述材料时为 deployment 增加真实 `type` 和 `descriptor: {fileRef, sha256}`。下面的通用示例不代替该要求；缺失描述会拒绝，不能把扩展登记成默认应用。非目录声明制品也必须提交描述。

PATCH /api/installed-entries/instances/{installationId}：

```text
{
  material: data.material 原文,
  expectedRevision: 最近解析/重读的 revision,
  submissionId: 本次登记 UUID（重试保留 ID 与正文）,
  observation: {result:"present|absent", observedAt: ISO时间, location: 实际位置, evidenceRefs:[真实证据引用], notes: 可选摘要},
  verification: {readiness:"verified|incomplete|failed|notChecked", scope: 实际核验范围, remainingWork: 剩余事项或空字符串},
  deployment: {
    method: 实际采用的方法说明, actualVersion: 实测版本或null,
    resources: [稳定实际定位符], dataLocations: [需要保留的数据位置],
    materials: [实际使用材料的引用与可取得来源证据],
    maintenance: 不含凭据的Markdown维护说明（最多32768字符）
  }
}
```

软件资源存在但数据库初始化失败：present + incomplete/failed，不报安装完成。verified 必须验证约定功能，remainingWork 为空。SQL 中断/重复提交先检查目标 schema/迁移事实，不能盲目重放；端口有响应时确认是本实例。只有确认部署被移除才写 absent，业务数据保留位置继续记录。

maintenance 与实例同条持久化，必须写清实际版本、资源/数据位置、辨认及打开方法、已执行初始化与迁移、验证方法、更新/卸载保留规则和剩余工作。大材料可使用持久文件引用；不要只留下会过期的 URL、临时附件或会话缓存。维护说明由后续 Agent 阅读，不由平台直接执行。

登记 API 不重新要求当前目录上架，因此已发生事实可记录；结构、宿主/所有者、材料作用域及 revision 仍校验。提交失败时分别报告软件结果与登记结果。

## 恢复与后续维护

GET /api/installed-entries/instances/{installationId} 返回 record、revision。响应丢失先读；若记录 observation.requestId 等于 submissionId，按原正文重试可得到 replayed=true，不重装。revision 冲突先重读并调查，不能只改 expectedRevision 强行覆盖。旧记录未知字段不补造。

历史维护资料可通过 GET /api/installed-entries/instances/{installationId}/history/{revision} 读取；当前 observation.baseRevision 指向前次记录。更新维护说明不会静默丢弃旧资料。新会话从 record.installation 读取目标、来源及维护说明，核验当前实际状态后再打开、修复、更新或卸载；不把历史核验当实时健康。

已有用户安装可以先观察后纳管，不默认重装。卸载仅移除精确实例的软件资源，默认保留数据；额外数据删除按现有权限处理。失败不代表自动回滚或已卸载。操作结果未知时先调查，绝不因登记幂等而推断软件命令也是 exactly-once。
