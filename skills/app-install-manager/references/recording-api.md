# 应用资料与最后核验记录 API

仅应用 `application-observation-v1` 使用。本协议不新增模型工具，不创建持久安装中意图。API 未支持时停止并提示客户端需更新；不能降级 file-write 或旧 App receipt 流程。

## 目标与资料

API base 使用当前会话已确认的活动 Agent Service；不要猜固定端口。`deviceId=local` 指该 Agent Service 主机，不一定是界面所在电脑。远程设备使用已授权的现有设备执行工具；接口接受设备定位不代表它验证了远程证据。身份/位置不清楚就停止。

通过已有 HttpRequest 调用 `POST /api/registry/acquisitions/resolve`，body 为 `ApplicationManagement` 原对象：

```json
{
  "protocol": "application-observation-v1",
  "sourceId": "registry:official",
  "entryId": "desirecore-control",
  "deviceId": "local",
  "action": "manage"
}
```

`action=install|update` 必须加上由精确目录条目取得的 `snapshot`：schemaVersion、catalogSourceId、完整 catalogCommit、catalogPath、releaseVersion，及存在时的 contentRef/contentSha256。只允许明确固定版本，不填写 latest，不自行拼下载地址。`action=uninstall|manage` 不传 snapshot，服务端读取原安装资料。

成功 `data` 包含 `material`、`expectedRevision`、`manifest`、`installGuide` 和 `record`。读取不写账本、不执行软件、不代替审批。复用返回的 material，不复制整份指南进提交请求。服务端内部复核不需要模型重复读全部目录。

目录的无关条目更新不替换选定版本；资料必须在受信分支可达，当前目标条目仍允许获取。下架/撤回可以阻止新装，原安装的 manage/uninstall 使用历史指南，不依赖目录在线。历史安装缺乏维护资料时明确报告，不能用同名最新指南猜卸载命令。

## 执行与核验

依照应用自己的 install.md 和目标环境执行。固定版本指南中的旧 bookkeeping 部分不覆盖本协议：软件命令按该指南，记账只能使用下面的观察请求。不要为了兼容旧说明伪造安装中记录或改走 MCP 注册。

先检查实际包名、版本、位置与指南要求的自检。只能提交当时确认的 `present` 或 `absent`；失败、不明、设备离线不构成“已移除”。没有结果就保留旧历史记录。升级核验失败不自动宣称旧版可用。

## 提交观察

`PATCH /api/installed-entries/<entryId>/<deviceId>`，路径段应正常 URL 编码，body：

```json
{
  "material": { "protocol": "application-observation-v1", "sourceId": "registry:official", "entryId": "desirecore-control", "deviceId": "local", "action": "manage" },
  "expectedRevision": "使用此次读取返回的修订值",
  "requestId": "为本次提交生成一个 UUID，重试保持不变",
  "deviceName": "本机",
  "observation": {
    "result": "present",
    "observedAt": "实际核验时取得的 ISO 时间",
    "location": "实际核验的安装目录或部署位置",
    "evidenceRefs": ["当前工具执行结果或已有会话日志的可追溯引用"],
    "notes": "可选的简短维护信息，不含秘密或自动执行指令"
  }
}
```

示例中的占位文字不能直接提交。首次安装前没有精确记录时，expectedRevision 为服务端返回的 `none`。observedAt 由实际观察决定；recordedAt 由服务端记录，不要把任务开始时间当核验时间。版本来自固定资料，只有实际匹配时才提交。

限制：location 最多 2048 字符、不能含换行/NUL；evidenceRefs 1–8 个，每项最多 512 字符；notes 最多 2000 字符。不填 runtimeStatus、operationId、pending 字段或 catalogReceipt。证据引用由 Agent 报告，服务端校验结构和记录一致性，不声称验证引用内容或软件真实安全。

成功返回新的 revision、replayed 和当前记录摘要。相同 requestId＋相同 body 的当前结果可重复读取，且不重写时间；同 ID 不同 body 拒绝。旧提交已被后续修订取代时，不换 ID/修订强行重提，也不承诺任意历史请求的全局去重。

## 重读和失败

使用 `GET /api/installed-entries/<entryId>/<deviceId>?sourceId=<精确来源>` 取得小范围 revision/record；不要反复拉取全部账本和完整指南。`record=null` 表示未登记，不证明软件不存在；`legacy=true` 是未迁移历史记录。

提交响应丢失：先重读；当前 requestId 相同可用原正文重试。修订变化：观察实际软件再决定是否发起新的核验，禁止只替换 expectedRevision。写入失败：说明软件可能已修改但记录未完成，不重执行安装。具体恢复见 recovery.md。

应用正常停止后无需改观察记录。卸载默认保留用户数据和凭据；删除这些材料需要独立确认。注册内部服务也属于单独任务，应用安装不派生新的内部 MCP/HTTP 服务。
