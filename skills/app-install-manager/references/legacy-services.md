---
name: 应用安装管理
description: 经目录快照或已安装生命周期收据 resolver 授权后安装/卸载/启停 docker-app、native-app 原生应用与 mcp/http-api 服务（docker-app：解析 manifest/installGuide → 跑 docker compose → 健康校验 → 回写安装状态；mcp 服务：使用 resolver 返回的 install/connection 执行安装与连接测试 → 已连通或需授权才注册到 Agent → 回写状态）。Use when 用户要求"安装 Dify/n8n 等应用"、"安装某 MCP 服务"、"卸载某应用/服务"、"启动/停止/重启某应用"，或安装/卸载请求以"请安装/卸载 {名称} 到/从 {设备}"形式到达。
version: "1.5.0"
type: procedural
risk_level: high
status: enabled
disable-model-invocation: true
tags: [installation, docker, mcp, registry, app-management]
metadata:
  author: desirecore
  updated_at: "2026-11-20"
---

# app-install-manager 技能

> 兼容参考，不是自动加载的 Skill 正文。本文件保留旧版本协议以支持 MCP/http-api 服务；只在当前请求明确 kind=service 时读取。下文旧 App 状态机段落为历史材料，不能用于 application-observation-v1，也不能用于构造新的 App 中间态。应用按 ../SKILL.md 和 recording-api.md 执行；本文件中的“本技能目录”仍指 app-install-manager 根目录。


## L0：一句话摘要

应用/服务生命周期执行者：把目录里的 docker-app、native-app 原生应用与 mcp/http-api 服务真正装起来/卸下去，并把真实结果回写到安装记录，让"应用与服务"界面反映真实状态。

## L1：概述与使用场景

DesireCore 的安装是**委派式**的——界面发送自然语言说明加机器 envelope，并乐观记下一条中间态
（首装 `installing` / 重装 `reinstalling` / 卸载 `uninstalling`）；**真正的执行与终态回写由本技能
（你）完成**。后端会监听安装记录文件：在状态变为 `installed` 后自动派生 docker-app 暴露的服务，
在中间态保留既有派生，仅在终态（`failed`/`uninstalled`/条目移除）清理派生。

覆盖三类目标：
- **native-app**：DesireCore Control 等宿主机原生应用，按固定制品与安装指南安装；只供外部客户端使用的 MCP 不注册到本 Agent。
- **docker-app**：Dify / n8n / RagFlow 等，走 docker compose 部署。
- **mcp / http-api 服务**：MCP 服务器（按 registry 的 `install` 字段安装，连接测试已连通或需授权后注册到 Agent）与 HTTP API 服务（仅登记安装记录，无自动化部署动作）。

使用场景：
- 用户说"安装 Dify""把 n8n 装到本机""安装某 MCP 服务"
- 用户说"卸载 RagFlow""卸载某 MCP 服务""停止/启动/重启 Open WebUI"
- 收到形如"请安装 {name} 到{device}""请卸载 {name}"的指令

## L2：详细规范（SOP）

### 关键路径与数据

- 当前目录快照解析：`POST http://127.0.0.1:<agent-service-port>/api/registry/acquisitions/resolve`
- 机器消息解析与响应复核：`<本技能目录>/scripts/registry-catalog-acquisition.mjs`（含 MCP 注册响应判定
  `evaluate-register-response` 与操作归属复核 `inspect-operation`）
- 安装记录：`<DesireCore根目录>/config/installed-entries.json`
  （`<根目录>` 为你的 AgentFS 根，生产为 `~/.desirecore`，开发隔离为 `~/.desirecore-dev`，以自我感知里的实际根目录为准）
- agent-service API：`http://127.0.0.1:<agent-service-port>`（端口见自我感知；mcp 服务安装、连接测试、注册，以及按
  runtimeServerId 回滚或删除残留用）

### 执行前协议：精确机器消息 → ownership / resolver（强制）

任何 install/reinstall/uninstall 在环境探测、Docker 查询、包安装或其它执行类 `bash` 前，都必须
先完成本节。自然语言只用于面向用户的说明，**不得**从自然语言猜测 `kind`、`sourceId`、
`entryId`、deviceId、snapshot、install 或 connection。

1. 从**当前这条**生命周期指令中提取唯一一行：
   `RegistryCatalogAcquisition=<单行 JSON>`。App/Service envelope 都必须带
   `operation:{action:"install"|"reinstall"|"uninstall",deviceId,operationId}`；operationId 必须是小写
   UUID，并且只代表这一次 lifecycle 意图。先把指令全文交给
   `parse-locator`，只取得 `sourceId+entryId+operation.deviceId` 的账本定位符；再用
   `parse-message` 校验完整 envelope：

   ```bash
   node "<本技能目录>/scripts/registry-catalog-acquisition.mjs" parse-locator
   node "<本技能目录>/scripts/registry-catalog-acquisition.mjs" parse-message
   ```

   完整解析结果为 `{request,locator}`；App resolver request 必须包含 operation。解析器会拒绝缺失、
   重复、畸形机器行、额外字段、可变 commit、来源/snapshot 不一致和 App 夹带 install/connection。
   不允许回看旧消息或从显示名、同 ID 本地条目、自然语言补字段。若 locator 已解析但完整解析
   失败，先按“执行前停止的强制结算”处理；真正缺失/JSON 畸形且没有 locator 的手工指令不猜写
   安装账本，只报告错误并停止。
2. 对 App 三种 operation 及 Service install/reinstall，把解析结果的 `request` 原样作为 body 调 resolver：

   ```yaml
   tool: HttpRequest
   parameters:
     url: http://127.0.0.1:<agent-service-port>/api/registry/acquisitions/resolve
     method: POST
     body: <parse-message 输出的 request>
   ```

   install/reinstall 由服务端重验 current canonical；uninstall 由服务端按 operation.deviceId 精确读取
   installed-entry 的不可变 lifecycle receipt，并用 receipt 对应的 Git object 返回旧版本定义。它不因
   当前 catalog listing-only、stale 或下架而阻断，但无 receipt、receipt/snapshot 不一致、来源或设备
   不匹配都失败关闭。
   Service uninstall 不调用 current catalog resolver：它只按 locator 命中 exact installed receipt，随后
   由精确 DELETE 端点使用 receipt.runtimeServerId 删除；目录删除、listing-only 或 stale 不得卡住卸载。
3. 只有 HTTP 200 且响应通过同一脚本的 `evaluate-response` 复核后才可继续。复核
   输入是 `{ "expected": <request>, "status": <HTTP状态>, "body": <响应JSON> }`。响应的
   kind/sourceId/entryId/snapshot、manifest.id/type 必须一致，App 还必须取得非空 installGuide。
   响应还必须包含服务端生成并校验的完整 `catalogReceipt` candidate。`allowed:true` 才是本次执行
   定义；App 只使用其 manifest/installGuide/catalogReceipt，忽略任何 install/connection。uninstall 的
   manifest/installGuide/receipt 必须来自服务端 receipt 解析结果，不能改读当前目录。
4. 服务端有界拒绝码必须逐字保留：
   `registry_acquisition_invalid_request`、`registry_acquisition_not_found`、
   `registry_acquisition_snapshot_stale`、`registry_acquisition_blocked`、
   `registry_acquisition_client_upgrade_required`、`registry_acquisition_config_mismatch`、
   `registry_acquisition_install_guide_unavailable`、`registry_acquisition_receipt_missing`、
   `registry_acquisition_ownership_mismatch`；同时保留通过有界校验的 reasons。任何非 200、
   连接失败、非 JSON 或身份/快照/manifest 不一致都禁止执行命令，并先完成强制结算。本条只管
   resolver（含 `/api/mcp/install` 执行命令前的同一准入）；注册端点在 postInstall 执行之后返回的
   409 按 mcp 安装流程第 4 步判定，不套用执行前结算。
5. **禁止 fallback**：不得读取任何本地 Registry 条目、改用同 ID 其它来源或沿用旧 resolver 响应。
   resolver/ownership 只决定本次读取与精确归属，不新增安装账本，也不替代工具审批、健康校验、
   回滚和终态收据。

安装记录条目结构（写回时必须完整保留全部字段）：

```json
{
  "entryId": "dify",
  "sourceId": "registry:official",
  "type": "docker-app | native-app | mcp | http-api",
  "deviceId": "<设备ID>",
  "deviceName": "<设备名>",
  "version": "<版本>",
  "installedAt": 1730000000000,
  "installedBy": "agent",
  "status": "installing | reinstalling | installed | uninstalling | failed | uninstalled",
  "conversationId": "<对话ID>",
  "messageId": "<消息ID>",
  "operationId": "<本次操作UUID>",
  "catalogReceipt": {
    "schemaVersion": 1,
    "kind": "app | service",
    "catalogSourceId": "registry:official",
    "entryId": "dify",
    "catalogCommit": "<40/64位commit>",
    "catalogPath": "entries/dify",
    "releaseVersion": "<安装版本>",
    "lifecycle": {
      "manifest": {
        "id": "dify",
        "name": "Dify",
        "type": "docker-app | mcp",
        "version": "<安装版本>",
        "description": "<最多4096字符>"
      },
      "installGuide": "<仅App，服务端返回且最多64KiB>"
    },
    "runtimeServerId": "<仅MCP注册成功后由服务端签发>"
  }
}
```

`catalogReceipt` 是同一 installed-entry 内的最小不可变生命周期收据，不是第二账本。UI 意图只带
snapshot 基线；install/reinstall 成功时必须原样采用 resolver 返回的完整 candidate，禁止 Skill 根据
snapshot、manifest 或 installGuide 自行构造/扩展 lifecycle。Service 注册成功后只允许在该 candidate
上补服务端返回的 runtimeServerId。

重装时主记录的 `catalogReceipt` 和 version 仍是旧的已安装事实；新目标只存在同一条记录的
`pendingCatalogReceipt`（base snapshot，无 lifecycle/runtime）。Skill 不写 PUT，也不把 pending 当成
最终 receipt。成功时用 resolver 的新 candidate + 新 releaseVersion 原子切换；失败/取消只用同一
operationId PATCH `installed`，省略 receipt/version，让服务端保留旧事实并清除 pending。

**状态语义表（六枚举）**——中间态由界面乐观写入、终态由你回写：

| status | 谁写入 | 你的退出动作 |
|--------|--------|-------------|
| `installing` | 界面首装乐观态 | 成功→`installed`（mcp 连接测试为需授权 `needs_auth` 也算成功：已注册，是否还要授权看下一轮工具列表）；失败→`failed` |
| `reinstalling` | 界面重装乐观态（此前已 `installed`） | 成功→`installed`；失败但**旧版本仍在运行**→回写 `installed` 并说明重装失败；失败且应用已不可用→`failed` |
| `uninstalling` | 界面卸载乐观态 | 成功→`uninstalled`（或移除条目）；**失败→回写 `installed`** 并向用户说明失败原因 |
| `installed` / `failed` / `uninstalled` | 你回写的终态 | — |

本次操作已被接替（「操作归属复核」为 `superseded`）时不写任何状态：记录已归新操作所有。

**后端派生规则（务必理解）**：只在 `installed` 派生 docker-app 的服务；在中间态（`installing`/`reinstalling`/`uninstalling`）**保留**既有派生；仅在终态（`failed`/`uninstalled`/条目移除）**清理**派生。因此：
- 重装/卸载期间派生服务不会被误删（旧容器还在跑时目录不抖动）；
- 卸载或重装失败时你回写 `installed`，派生会**无缝恢复**（从未被删）；
- `failed` 语义是"应用当前不可用"——**只有确认容器已不能用才写 `failed`**，否则一律回 `installed`。

### 执行前停止的强制结算

UI 在发消息前已经写入中间态。locator 成功后，完整解析失败、resolver 拒绝/异常、工具审批被拒、
环境检查失败，或任何尚未执行安装/卸载命令的退出，都必须按下面的单账本流程结算：

1. `GET /api/installed-entries` 取得当前实例记录；不得直读其它实例或构造新记录。
2. 把 `{stage,locator,entries}` 交给脚本的 `plan-settlement`。stage 取
   `parse|resolver|pre_execution`：解析失败用 `parse`，resolver 拒绝/异常用 `resolver`，工具审批
   被拒、环境检查失败及其它执行前退出用 `pre_execution`。脚本仍接受旧值 `human_gate` 作兼容，
   本流程不再使用。它严格匹配 sourceId+entryId+deviceId 和与 operation
   对应的中间态与 operationId；同 ID 双来源、跨设备或旧消息重放都不会串写，零条/多条都返回
   settlement:null。
3. settlement 非空时，按“回写安装记录的统一方式”PATCH 它给出的精确三元组和 status：
   `installing → failed`，`reinstalling → installed`，`uninstalling → installed`，并原样携带
   settlement.operationId。结算前后都不得执行
   Docker、包管理或安装脚本。settlement:null 时先做「操作归属复核」：`superseded` 按被接替处理；
   其余报告有界原因并停止，不按数组顺序、名称或设备猜测。
4. 工具审批被拒或用户在对话中叫停也是正常停止而非悬空：首装回 `failed`，重装/卸载恢复
   `installed`。resolver 错误码与 reasons 在完成结算后原样说明。

### 操作归属复核（inspect-operation）

较新的客户端允许用户在界面「重试」卡住一段时间的 `installing`/`reinstalling` 记录：界面用新的 operationId
替换这条记录（服务端不替换仍有在途 `/api/mcp/install` 或注册请求的操作），账本里不会留下旧操作的终态。
只有 install 与注册请求在服务端执行期间受在途保护；其余任何时间（install 返回后到发起注册之前、复测、注册返回
之后、等待审批、PATCH 与 DELETE）都可能被接替。以下时点先复核本次操作是否仍持有记录：

- 任何回滚之前，以及删除残留之前；
- PATCH 返回 409 `catalog_operation_mismatch`，或 PATCH 没有响应（见「回写安装记录的统一方式」）；
- `/api/mcp/install` 或注册返回不带 reasons 的 409 `registry_acquisition_ownership_mismatch`；
- `plan-settlement` 返回 settlement:null。

`GET /api/installed-entries` 后，把 `{ "locator": <locator>, "entries": <响应的 data.entries> }` 交给脚本：

```bash
node "<本技能目录>/scripts/registry-catalog-acquisition.mjs" inspect-operation
```

脚本按 sourceId+entryId+operation.deviceId 找记录：

- `current`：恰好一条且 operationId 是本次的，带 status。按原流程结算。`mayRollback` 只在同时满足时为 true：
  输入带了 `"runtimeServerId": <注册判定输出的 runtimeServerId>`；首装且记录仍为 `installing`；没有别的记录
  （任一状态不是 `uninstalled`，含 `failed`）在回执里持有这个键。回滚前必须重新跑一次带 runtimeServerId 的
  复核，不沿用为其它原因做的复核结果。
- `superseded`：恰好一条但 operationId 不同，本次已被界面重试或新指令接替，记录归新操作所有。不结算、不回滚、不撤销已执行的命令和已注册的配置、不换用新的 operationId、不调用任何 PUT（带不带 `retryOf` 都不行）；向用户说明本次已被新操作接替，结果以新操作为准。
- `missing`（没有记录）/ `ambiguous`（多条）：都不得结算或回滚，报告并停止。

旧客户端不会在操作进行中替换意图，这条规则在旧客户端上没有副作用。复核只是弱判定，复核之后仍可能被替换。
PATCH 与注册绑定 operationId，被替换时服务端回 409；回滚用的无信封 DELETE 不绑定 operation，只看有没有活回执
持有这个键（新意图只有基础回执，不算持有者），被替换时服务端不会拦。所以复核为 `current` 后立刻发回滚或删除
残留的 DELETE，中间不插入等待或询问。同一会话里收到同一 sourceId+entryId+deviceId、operationId 不同的新指令，也说明旧操作
已被接替：旧操作照上面停止，新指令从它自己的机器消息重新走执行前协议，不沿用旧操作的 resolver 响应、
candidate、runtimeServerId 或连接测试结论。

### 授权与审批

界面发来的生命周期指令（含机器消息）就是用户本次操作的授权：用户已在界面上选定条目与设备并点击
安装/卸载，MCP 服务还在设备选择处看到了完整命令与风险说明（ADR-349 决策 1）。不在对话里再确认
一次。后续 HttpRequest、`bash` 等调用按本 Agent 当前审批档位和「总是允许」规则审批，全部放行时不再
询问；审批被拒按 `pre_execution` 结算。只有操作超出本次机器消息的范围（例如删除用户数据、改用其它
端口、停掉不属于本应用的进程）时，才向用户说明并询问。MCP 注册冲突留下的残留键（ADR-371 的两个
reasons）是否删除、是否在编辑器里启用一份停用的本机配置，都属于超出范围的操作：先说明并询问，用户
选择之前只结算，不删除、不启用。

### 回写安装记录的统一方式（端点优先，404 降级）

**所有「回写安装记录」都用这一方式**——不要再直接 file-write 改 `installed-entries.json`（除非端点不可用时降级）。这样 installed-entries 成为「你校验后回写的事实」，界面以它为准。

**首选：PATCH 端点**（结构化 + 原子写 + 自动广播刷新前端）：

```yaml
tool: HttpRequest
parameters:
  url: http://127.0.0.1:<agent-service-port>/api/installed-entries/<entryId>/<deviceId>
  method: PATCH
  timeout: 120000   # 带 receipt 的 PATCH 会在服务端重跑 resolver；HttpRequest 缺省只等 30 秒
  body:
    sourceId: <locator 中的精确 sourceId>
    operationId: <locator.operation.operationId>
    status: installed        # 六枚举之一
    # version: "<新版本>"    # 可选，重装升级时更新版本号
```

- `200` → 回写成功，前端自动刷新，**无需**再手动改文件。
- `400` → status/sourceId 非法，检查取值。
- `404 entry_not_found` → 该条中间态记录不存在（界面未写/已被清理）。**不要**重试或伪造记录；跳过并一句话提示用户重发指令即可。
- receipt PATCH 的 `catalog_receipt_*` / `catalog_status_transition_invalid` / `invalid_operation_id`
  400/409，以及重跑 resolver 给出的 `registry_acquisition_*`，表示候选非法、
  ownership/CAS/runtime/lifecycle/operation 不一致或目录已前进；
  不得删字段、重建 receipt 或换 snapshot 重试。App 停止并按失败语义结算；MCP 按「mcp 注册后的
  回滚与残留出口」的回滚规则判断能否回滚，再结算。
- `409 catalog_operation_mismatch` → 账本里这条记录的 operationId 已不是本次（较新的客户端上可能已被界面
  重试接替）。先做「操作归属复核」：`superseded` 时不结算、不回滚；`current` 才继续原流程。
- **PATCH 没有响应**（请求超时或连接中断）→ 写入可能已生效，也可能仍在服务端执行。先做「操作归属复核」：
  `current` 且 status 已是本次要写的终态（带 receipt 的，还要求记录里 catalogReceipt 的 releaseVersion 与
  runtimeServerId 和本次 PATCH 的一致）→ 本次回写已生效，按这个终态汇报（写的是 `failed` 就汇报安装失败），
  不回滚也不再结算；`superseded` → 按被接替处理；仍是中间态 → 用完全相同的请求体（同一 operationId、同一
  receipt）再发一次 PATCH，按这次的响应处理（已落盘时同状态重放返回 200）。拿到明确的拒绝码之前不回滚、
  不改写成别的状态；再次没有响应就停止，如实说明记录可能仍停在中间态，请用户稍后在界面查看或重试。
- PATCH 一律带 sourceId：不带时操作不一致在旧客户端上落成 500 `installed_entry_write_failed`，看不出
  是被接替。拒绝码可能在 `error`（安装记录路由）或 `errorCode`（PATCH installed 重跑 resolver，如
  `registry_acquisition_snapshot_stale`）字段，两个都看。
- **连接失败 / 路由 404（旧客户端无此端点）** → catalog lifecycle 回写不得降级 file-write；否则会
  绕过 operationId 和 receipt CAS。停止并报告客户端不兼容。

**降级 file-write**（仅无 catalog envelope 的历史普通操作可用；本节 catalog intent 绝无此降级）：读
`installed-entries.json` → 按 `sourceId`+`entryId`+`deviceId` 精确定位那条中间态记录 → **只改
`status`（保留 `installedAt` 等其余所有字段与其它条目）** → 写回整个文件（界面也写此文件，
勿覆盖丢失）。来源缺失或存在多条候选时失败关闭，不得按同 ID 猜测。

下文各流程的「回写安装记录」一律指这套统一方式，只标注目标 `status`。

### docker-app 安装流程

1. **解析机器消息并调用 resolver**：严格执行“执行前协议”。action 与 deviceId 只认 operation；
   `entryId`、`type`、版本、端口、exposes 和安装步骤只认复核后的服务端结果。manifest.type 不是
   `docker-app` 时必须按准确类型路由：`native-app` 走原生应用流程；只有 `mcp`/`http-api` 才走服务流程。身份或类型不一致立即停止。
2. **读取本次授权定义**：从 resolver 返回的 manifest 读取 `install.requirements`（docker/内存/
   磁盘/ports）与 exposes；只把 resolver 返回的 installGuide 作为部署步骤与验证地址。不得从
   AgentFS 或其它目录补读/覆盖同 ID 定义。
3. **环境校验**（`bash`）：`docker version` / `docker compose version` 确认 docker 就绪；用
   `manifest.install.requirements.ports` 检查端口占用（`lsof -i :<port>` 或 `docker ps`）；检查磁盘
   空间。任一不满足→先按 `pre_execution` 结算再停下，向用户说明并给出修复建议。
4. **授权与审批**：界面发来的安装指令就是用户的操作，不在对话里再确认（见「授权与审批」）。
   下一步的 `bash` 调用按当前审批档位审批，审批被拒按 `pre_execution` 结算后中止。
5. **执行**（`bash`，严格按 resolver 返回的 installGuide）：
   - docker-compose 类：在应用工作目录 `docker compose up -d`；docker 类：`docker run ...`。
   - 失败立即捕获输出，进入"失败处理"。
6. **健康校验（先校验后回写，强制）**：按 installGuide 的验证地址或 manifest.exposes 的 `http://localhost:<port><path>`，`bash` 用 `curl` 轮询（最多 ~2 分钟）确认服务可达。**只有这步通过才算安装成功**——不要仅凭 `docker compose up -d` 无报错就回写 `installed`。
7. **回写安装记录**（**本技能的核心职责**，按上方「回写安装记录的统一方式」）：
   - 健康校验通过 → 用 `build-receipt-patch` 把 resolver 原样 candidate 与 `status: installed` 组成
     CAS-safe PATCH，并携带 locator.operationId 和 candidate.releaseVersion；不得本地重建 receipt。
     未通过/失败 → 首装 `status: failed`；重装失败但旧版本仍在运行 → 只 PATCH
     `{sourceId,operationId,status:installed}`，不得附 receipt/version/pending（见状态语义表）。
   - 成功后无需手动派生服务——后端文件 watcher 检测到 `installed` 后自动派生；重装期间派生始终保留。
8. **回报用户**：一句话总结结果 + 访问地址（成功）或失败原因 + 排查建议（失败）。

### docker-app 卸载流程

1. 完整解析 App envelope 并调用 resolver。resolver 必须用 operation.deviceId 精确命中
   sourceId+entryId+deviceId 的 `uninstalling` 记录，再按该记录的不可变 lifecycle receipt 读取旧 Git
   object；**不得以当前 catalog eligibility 重新授权卸载**。同 ID 其它来源、其它设备、无 receipt
   legacy 记录或 receipt/snapshot 不一致都拒绝。
2. 只使用 resolver 从 receipt 返回并通过脚本复核的 manifest/installGuide 作为卸载定义；不得读取
   当前 Registry 同 ID 条目补命令。resolver 拒绝时先结算回 `installed` 并提示手工管理/升级，不能
   发明 compose 目录或容器名。界面发出的卸载指令就是用户的操作，取得定义后直接执行，不在对话里
   再确认；工具审批被拒按 `pre_execution` 结算回 `installed`。
3. `bash`：只按 receipt 绑定的 installGuide 停止并移除容器（如 `docker compose down`）。卷里的
   用户数据默认保留；删除卷超出本次卸载指令的范围，需先向用户说明并取得同意。
4. 回写安装记录（按「回写安装记录的统一方式」）：
   - **成功**（容器确已停止/删除）→ PATCH `status: uninstalled`。后端 watcher 据此清理派生服务与 per-service Skill。
   - **失败**（容器未能停止/删除，应用仍在运行）→ PATCH `status: installed`，向用户说明卸载失败原因。**切勿**留在 `uninstalling`（界面卸载按钮会禁用，用户被卡住直至 stale 超时）。
5. 回报用户。

### native-app 原生应用安装、升级与卸载

原生应用属于 App，不是本 Agent 的 MCP 工具。**DesireCore Control 是外部智能体控制 DesireCore 的独立应用；即使它向外暴露 MCP，也绝不调用内部 `/api/mcp/install` 或 `/api/agents/desirecore/mcp-servers` 注册它。** 不改写 Agent 配置，不创建自启动项，不跟随 DesireCore 启停，不把宿主机 CDP 放进 Docker。

1. 执行前协议与「授权与审批」完全沿用 App 流程，不在对话里再确认。先调用 resolver 并用 `evaluate-response` 复核，再进行任何环境探测或包管理操作。manifest.type 与 lifecycle.manifest.type 必须同为 `native-app`，candidate.kind 为 `app`，不接受 runtimeServerId。
2. 新装/升级只认复核后 manifest 的 `install.method=native-node`、`requirements.node`、目标设备、固定 Release URL/ref/SHA-256 和 installGuide。检查宿主机 Node 版本、可写安装目录、磁盘、默认管理端口；不要求 Docker。缺乏不可变制品或不支持原生应用的客户端时先结算再停止，不改写 type 兼容旧客户端。
3. 在 installGuide 指定（或用户另行指定）的独立应用目录按 installGuide 下载、**先核对 SHA-256 再安装**。版本、启动命令与目录绑定到该安装，不执行浮动 latest，不复用其他应用/实例目录。升级前保留旧版；新包验证失败时恢复可用旧版并按既有重装语义回写。
4. 使用 installGuide 的隔离安装自检验证包、版本及本机 HTTP 管理页；不要为了安装验证读取真实 DesireCore 实例、截图或运行模型。**安装成功不等于持续运行**：验证进程正常退出后可回写 installed，运行态保持 stopped/unknown。用户另行请求启动时再启动。`--allow-control`、外部隧道、真实 OpenAI key 均需独立明确授权；安装本身不启用它们。
5. 自检通过后用 `build-receipt-patch` 原样保存服务器 candidate，`kind=app`、`type=native-app`，按精确 operationId 回写 installed。不要派生内部 MCP/HTTP 服务，不以登记工具数作为安装成功条件。
6. 卸载只使用原安装 receipt 的 installGuide；停止准确的自有应用进程、卸载该应用的包。不得按进程名批量终止 Node、其他 tunnel-client 或 DesireCore，也不得删除 DesireCore 数据。凭据与用户配置默认保留，删除需另行确认。卸载成功回 uninstalled；失败但仍可用回 installed，不能遗留中间态。

原生应用启动/停止同样要求精确安装身份和原生命周期定义，通过用户批准的独立终端运行。状态改变不伪造安装/升级事实，管理页用系统浏览器打开；已配置的默认端口被占用时先停止并说明，不悄悄换端口导致“我的应用”指向别处。

### mcp / http-api 服务安装流程

**mcp 服务**（manifest.type=`mcp`，条目含 `install` 与 `connection` 字段）：

1. **解析机器消息并调用 resolver**：严格执行“执行前协议”，以复核后的复合身份确定
   `entryId`，以 operation.deviceId 确定目标设备（mcp 通常装到本机）。resolver 失败时在任何安装命令前
   停止。商店发来的机器消息就是用户本次操作的授权（用户已在设备选择处看到完整命令与风险说明并
   点击，ADR-349 决策 1），不在对话里再确认。后续 HttpRequest、`bash` 调用按本 Agent 当前审批档位
   和「总是允许」规则审批，全部放行时不再询问；审批被拒按 `pre_execution` 结算。界面已乐观写
   `installing`/`reinstalling`。
2. **使用本次授权定义**：只用 resolver 响应的 manifest/install/connection（`install` 含 method、
   packageName、command、args、postInstall；`connection` 含 transport/command/args/url/headers）。
   不读取或合并本地同 ID 条目。
3. **执行安装并做连接测试**（优先走 API，逐条跑 `postInstall` 命令 + 安装后连接测试；连接测试的结论决定第 4 步
   是否注册）：
   ```yaml
   tool: HttpRequest
   parameters:
     url: http://127.0.0.1:<agent-service-port>/api/mcp/install
     method: POST
     timeout: 300000   # 安装命令 + 安装后连接测试；HttpRequest 缺省只等 30 秒
     body:
       install: <manifest.install 原样>
       connection: <manifest.connection 原样>   # 传入则安装后自动测连接
       catalogAcquisition: <parse-message 输出的 request 原样>
   ```
   返回 `data.steps`（每条命令 exitCode/stdout/stderr）与 `data.connectionTest`。无 API 可用时用 `bash` 逐条跑
   `postInstall`，再按下面的复测做连接测试。
   **必须显式传 `timeout`**：npx / uvx 类 stdio 服务首次启动要先下载运行环境或依赖，较新的客户端给 stdio 连接测试的期限是 120 秒（旧客户端 30 秒），期限后还要等子进程关闭；`HttpRequest` 缺省 30 秒会先于服务端结束，只能看到「请求超时 (30s)」，服务端的测试仍在后台继续。`connectionTest.errorCode` 为 `timeout` 时，较新的客户端会在说明里写明服务端进程从未回复（首次下载依赖未完成的样子）：包管理器通常保留已下载的部分，可以再单独测一次连接（见下方复测）。

   先按响应分类，再决定是否注册：
   - HTTP 200 且 `success:false`：某条 postInstall 失败，响应里没有 connectionTest。不注册，按「失败处理」的
     postInstall 失败结算：首装 `failed`；重装时 agent.json 未被替换，旧版本仍可用就用同一 operationId PATCH
     `installed`、省略 receipt/version，确认旧版本已损坏才回写 `failed`。
   - 400/404/409（带 `registry_acquisition_*`，或 400 请求体不合法）：服务端在执行任何命令之前拒绝，按
     `resolver` 阶段做执行前结算；不带 reasons 的 409 `registry_acquisition_ownership_mismatch` 先做「操作归属
     复核」。
   - HTTP 200 且 `success:true`：只说明命令都成功，连通性看 `data.connectionTest`：
     - `connectionTest.success === true`：**已连通**，进入第 4 步。
     - `connectionTest.status === 'needs_auth'`：**需授权**（远端服务端要求 OAuth，`errorCode` 为
       `auth_required`）。照常进入第 4 步注册：授权入口（`<runtimeServerId>__authenticate` 工具）要注册并启用后
       才出现，不注册或回滚都会让用户无法授权。判据只认 `status === 'needs_auth'`；只有
       `errorCode: 'auth_required'`、没有 status 的是普通失败。连接测试不使用已保存的 OAuth 凭据，已授权过的
       服务端也会测出需授权；重装或替换已有配置时它不代表授权已失效（汇报见第 7 步）。
     - `errorCode` 为 `timeout` 或 `cancelled`，或响应里没有 connectionTest：可以复测一次（下方），复测结果按
       同样的分类处理。旧客户端（10.0.196 之前）的连接测试失败既不带 `errorCode` 也不带 `status`，期限只有
       30 秒，首次下载依赖常常超时：`success === false` 且两者都没有时同样复测一次。
     - 其它失败：**不注册**。首装用同一 operationId PATCH `{sourceId,operationId,status:failed}`；重装用同一
       operationId PATCH `installed`，省略 receipt/version（旧版本仍在用）。向用户说明 `errorCode` 与 `error`
       摘要；`credential_unavailable` 时提示先配置所需凭据，再从商店重新安装。
   - install 请求本身超时、没有响应：命令可能仍在服务端执行（每条最长 300 秒；请求断开后的连接测试会按
     `cancelled` 跳过），也可能已经失败，结果无从确认。不重放 install，也不注册：按失败语义结算（首装 `failed`；
     重装用同一 operationId 恢复 `installed`、省略 receipt/version），说明结果不明、命令可能仍在后台执行，请几分钟
     后到商店重新安装。只有 `manifest.install` 没有 postInstall 命令时，超时的只可能是连接测试，可以直接复测，结论
     按上面分类。

   复测（`POST /api/mcp/test-connection`，只测连接，不带 catalogAcquisition，不重跑安装命令）：
   ```yaml
   tool: HttpRequest
   parameters:
     url: http://127.0.0.1:<agent-service-port>/api/mcp/test-connection
     method: POST
     timeout: 150000   # stdio 连接测试最长 120 秒，另加关闭子进程的时间
     body:
       connection: <与第 3 步相同的 connection>
   ```
   HTTP 200 且 `data.status === 'connected'` 为已连通（工具数是 `data.toolCount`）；HTTP 200 且
   `data.status === 'needs_auth'` 为需授权（授权指引在 `data.message`）；400（`invalid_config`）与 500（其它
   `errorCode`，说明在 `error`）为失败；复测请求再次超时也按失败处理。复测没有服务端在途保护，期间若被界面重试
   接替，第 4 步会收到不带 reasons 的 409。
4. **注册到 Agent**（只在第 3 步结论为已连通或需授权时；让 MCP 工具下轮可用）：
   ```yaml
   tool: HttpRequest
   parameters:
     url: http://127.0.0.1:<agent-service-port>/api/agents/desirecore/mcp-servers
     method: POST
     timeout: 150000   # 重装到新版本时端点会先连接验证新包（stdio 最长 120 秒）
     body:
       serverId: <entryId>
       config: <manifest.connection 原样>
       catalogAcquisition: <parse-message 输出的 request 原样>
   ```
   端点锁内 read-modify-write 写入 agent.json 的 `mcp_servers`（首装与普通替换写入 `enabled: true`；目录重装到
   新版本、stdio 且方法为 npx/uvx 时保留原配置的启用状态）——**勿手工编辑 agent.json**（绕锁会丢并发更新）。catalog 响应的 `data.runtimeServerId` 是服务端签发的复合 ownership key；
   不得用 entryId、显示名或调用方值代替。
   不手工解析响应：把 `{ "expected": <parse-message 输出的 request>, "status": <HTTP状态>, "body": <响应JSON> }`
   交给脚本判定：

   ```bash
   node "<本技能目录>/scripts/registry-catalog-acquisition.mjs" evaluate-register-response
   ```

   - `registered:true`：记下输出的 `runtimeServerId`、`reclaimed` 与 `rollbackAllowed`，进入第 5 步。
     `reclaimed: true` 表示服务端收回了这个键上原有的同一服务端配置（首装失败留下的残留，或同一 operation
     重放注册）。合并是按顶层键覆盖：目录连接配置没给出的键（cwd、sampling，以及目录没给出时的 env、headers、
     oauth）照样沿用；目录给出的键改回目录值，env、headers 是整个对象换成目录值，不逐项保留。之后任一步失败
     都不回滚。
   - `residue` 非空：注册 409 带 ADR-371 的 reasons，键上有一份不能收回的无主配置，按「mcp 注册后的回滚与
     残留出口」处理。
   - 其它（`registered:false` 且 `residue:null`）：没有可回滚的注册，不删除任何键，也不从 agent.json 按
     entryId 或后缀猜键。`errorCode` 为 `registry_acquisition_ownership_mismatch` 且不带 reasons 时先做「操作
     归属复核」；其余按失败语义结算：首装 `failed`，重装用同一 operationId 恢复 `installed`、省略
     receipt/version，并说明错误码。500 时 agent.json 可能已被写入，但无法证明是本次写的，同样不删。注册请求
     超时、没有响应时也按这里处理，不回滚。
   - 兼容：旧客户端（ADR-371 之前）注册 200 不带 `reclaimed`、409 不带 `reasons`，脚本据此给出
     `reclaimed:false` 与 `residue:null`，即按原规则处理：首装注册成功后的失败可以回滚，409 结算后停止。
   - registry:official 的条目在已有回执声明了裸键、且该键已在 agent.json 里时会注册到裸 entryId：脚本与卸载判定
     一致接受它，但它一定是替换已有配置，`rollbackAllowed` 恒为 false；随后 `build-receipt-patch` 只接受复合键
     会拒绝，按第 6 步的失败处理，不回滚。重装走到这里永远完成不了（服务端回写同样只接受复合键），如实说明。
5. **确认连接结论（注册之后不再重测）**：按第 3 步（或复测）的结论走：已连通 → 第 6 步成功路径；需授权 →
   同样走第 6 步成功路径（配置已注册并启用，授权在第 7 步引导），不得按「连接测试失败」处理。**只有连接测试
   已连通或需授权才算安装成功**——不要仅凭 postInstall 命令退出码 0 就注册或回写 `installed`（装了包不等于
   连得上）。
6. **回写安装记录**（按「回写安装记录的统一方式」）：用脚本
   `build-receipt-patch` 原样接收 resolver 的 catalogReceipt candidate，只在其上补第 4 步判定输出的
   runtimeServerId，并与 locator.operationId、`status: installed` 在同一次精确 PATCH 中写回原
   installed-entry，PATCH version 取 candidate.releaseVersion；禁止从
   request snapshot/manifest 自建或替换 lifecycle。需授权的首装同样回写 `installed`（已注册、待授权）。
   缺 candidate/runtimeServerId、candidate 被篡改、`build-receipt-patch` 拒绝或 receipt CAS 回写失败时不得
   宣布成功：按「mcp 注册后的回滚与残留出口」的回滚规则判断能否回滚，再按失败语义结算——首装 `failed`；
   重装只带同一 operationId 恢复 `installed`，省略 receipt/version/pending，并如实说明：注册已把 agent.json
   里的配置换成新定义，安装记录仍是旧版本，界面可能继续提示更新。
7. **回报用户**：总结安装结果 + 发现的工具数（已连通）或失败原因摘要（失败）。另外几种情况：
   - 需授权：说明已注册并启用。连接测试不使用已保存的 OAuth 凭据，所以是否还要授权以下一轮的工具列表为准。
     授权入口的注册名是 `<runtimeServerId>__authenticate`，但复合键已占 30 个字符，条目 ID 较长或含 `.` 时模型看到
     的是截短加哈希的派生名，可能不含 authenticate，所以按描述认：描述以 `MCP server "<runtimeServerId>"` 开头、
     说明需要 OAuth 认证的那个工具就是授权入口。出现它就是还要授权，授权前工具数为 0，按 `connectionTest.error`
     （复测为 `data.message`）的指引说明，用户同意后调用它完成登录，是否现在授权由用户决定；没有它而出现了该服务
     的其它工具，说明沿用了原有授权。首装新注册（键上原来没有配置）通常要授权；
     重装、`reclaimed: true` 或替换了已有配置时，服务端地址与 OAuth 配置没变就会沿用原有授权，不要直接说还要授权。
   - 收回（`reclaimed: true`）：说明沿用了这个键上原有的同一服务端配置；目录没给出的键（cwd、sampling 等）照旧，
     目录给出的键（含整个 env、headers 对象）已改回目录值。
   - 残留待确认：说明原因（reasons）、涉及的 runtimeServerId 与可选出路，等用户选择（见「mcp 注册后的回滚与
     残留出口」）。
   - 被接替（`superseded`）：说明本次已被界面重试或新指令接替，本次没有回写安装记录、也没有回滚，已执行的
     命令与已注册的配置原样保留，结果以新操作为准。

**http-api 服务**（manifest.type=`http-api`，无 `install` 字段、界面也无自动化安装动作）：按「回写安装记录的统一方式」维护回写（`installing`→`installed`、`uninstalling`→`uninstalled`/失败回 `installed`），明确告知用户该类服务无本地部署步骤、只是登记可达性。

### mcp 注册后的回滚与残留出口

**回滚规则**（注册 200 之后任一步失败，例如 `build-receipt-patch` 拒绝、receipt PATCH 冲突）：

只有同时满足以下条件才回滚：本次 action 为 `install`；注册 200 且 `evaluate-register-response` 给出
`rollbackAllowed:true`；回滚前「操作归属复核」（输入带上注册判定输出的 runtimeServerId）为 `current` 且
`mayRollback:true`。复核后立刻回滚，中间不等待、不询问。回滚用无信封 `DELETE`，路径取注册判定输出的 runtimeServerId，不带任何 query，不按 entryId：

```yaml
tool: HttpRequest
parameters:
  url: http://127.0.0.1:<agent-service-port>/api/agents/desirecore/mcp-servers/<注册判定输出的 runtimeServerId>
  method: DELETE
```

- 200 → 回滚完成（`removed:false` 只说明键已不在）；409 `registry_acquisition_ownership_mismatch` → 别的设备或
  记录仍持有这个键，保留配置并向用户说明。之后都按失败语义结算 `failed`。
- `reclaimed: true`（收回）一律不回滚：那是用户原有的配置，保留即可，下次首装重试照样收回。重装、`superseded`、注册非 200 或请求超时也一律不回滚。
- 回执持有的普通替换也不带 `reclaimed`：别的记录在回执里持有这个键（含 `failed`）时，键上原本就有配置，
  这种情况不回滚（复核输入带上 runtimeServerId 时输出 `mayRollback:false`）；持有记录都已 `failed` 时无信封
  DELETE 不会 409，回滚会删掉替换前就有的配置。

**残留出口**（第 4 步判定输出 `residue` 非空，只会出现在首装）：

1. 先按「回写安装记录的统一方式」用同一 operationId PATCH `{sourceId,operationId,status:failed}` 结算本次首装。
   返回 409 `catalog_operation_mismatch` 时先做「操作归属复核」，`superseded` 就停止，不再询问。
2. 向用户说明原因与涉及的键（`residue.runtimeServerId`）：
   - `unowned_runtime_config_differs`：键上的配置指向别的服务端（用户改过的残留，或目录升版后旧固定版本参数），
     出路只有删除或保留。
   - `unowned_runtime_config_disabled_local_keys`：键上是同一服务端，但当前停用（`enabled:false`，或严格能力模式
     下没写 enabled）且带本机改动（多出、改过或删掉的键），出路是删除、到编辑器启用或保留。
3. 询问用户选哪条（删除或启用用户配置超出本次机器消息的范围，见「授权与审批」），再按选择执行：
   - **删除**：用户回答可能隔了很久，期间用户也可能已在商店重新安装。先重新 `GET /api/installed-entries` 做
     「操作归属复核」：只有 `current` 且 status 为 `failed` 才继续；`superseded` 说明新操作可能正在注册或收回这个
     键（新意图只有基础回执，DELETE 不会被拦），停止并说明结果以新操作为准，不删除；其余结果报告后停止。复核后
     立刻发无信封 `DELETE /api/agents/desirecore/mcp-servers/<residue.runtimeServerId>`，不带任何 query，不按
     entryId，也不从 agent.json 猜键。200（`removed:true`，或 `removed:false` 表示已不在）→ 请用户到「应用」页
     该服务的详情里重新点「安装」（产生新的 operation）。409 → 别的设备或记录仍持有这个键，停下说明，不再尝试。
   - **启用**（仅 `unowned_runtime_config_disabled_local_keys`）：引导用户在「资源管理器」里打开 DesireCore 的
     「核心配置」（agent.json；处于预览时先点「编辑」），切到「表单」，展开「工具与能力」中的「MCP Servers」，
     找到 `residue.runtimeServerId` 这一条，勾选条目里标为 `enabled` 的复选框（上方说明为「是否启用此 MCP
     server」），再点页面顶部的「保存」；之后到「应用」页重新点「安装」，
     服务端会收回这份启用中的配置（目录没给出的键沿用，目录给出的键改回目录值，env、headers 整个对象替换）。
   - **保留**：结束，不做任何改动；用户以后可以自己删除，或启用后重新安装。
4. Agent 不得自己生成 operationId、不得调用 PUT 写意图、不得手改 agent.json、不得不带 catalogAcquisition
   注册来绕过归属；重新安装只由用户在界面发起。

### mcp / http-api 服务卸载流程

1. 完整解析机器消息，但不调用 current catalog resolver。用脚本 `resolve-service-uninstall` 对 locator、
   request.snapshot 和 `GET /api/installed-entries` 结果做完整复核：必须精确命中
   sourceId+entryId+deviceId 的唯一 `uninstalling` 记录，receipt.kind 必须为 service，且
   catalogReceipt.runtimeServerId 与 snapshot 必须有效。无 receipt/kind/runtimeServerId、身份/快照不符、
   零条或多条都先结算回 `installed` 并停止。界面发出的卸载指令就是用户的操作，复核通过后直接
   执行，不在对话里再确认；工具审批被拒按 `pre_execution` 结算回 `installed`。
2. **执行卸载**（mcp）：从 Agent 移除 MCP server 配置：
   ```yaml
   tool: HttpRequest
   parameters:
     url: http://127.0.0.1:<agent-service-port>/api/agents/desirecore/mcp-servers/<entryId>?sourceId=<sourceId>&deviceId=<deviceId>&operationId=<operationId>
     method: DELETE
   ```
   URL 参数先用脚本 `build-service-delete` 从 locator 生成；operationId 必须原样来自 locator。服务端
   从精确 installed-entry receipt 的 runtimeServerId 删除对应
   配置；不得按裸 entryId 删除，
   也不得因为当前目录删除、listing-only 或 snapshot stale 改走 resolver。
   端点幂等。如安装时全局装了包，按需 `bash` 卸载（可选，多为无害保留）。http-api 服务无需执行
   动作，直接进第 3 步。
   - **旧客户端降级**：该 DELETE 端点是较新客户端才有的能力。若返回 **404 / Not Found / 路由不存在**，说明当前客户端版本尚未包含 mcp 卸载端点——**不要**当作卸载成功。此时回写安装记录为 `installed`（保持"仍在用"），并一句话告知用户"当前客户端版本不支持 mcp 服务卸载，请升级客户端后重试"。切勿手工编辑 agent.json 绕过（绕锁会丢并发更新）。
3. **回写安装记录**（按「回写安装记录的统一方式」）：成功 → 用同一 operationId PATCH
   `status: uninstalled`；**失败（含 DELETE mcp-servers 端点 404 降级）→ 用同一 operationId PATCH
   `status: installed`** 并说明原因（勿留在 `uninstalling`）。
4. 回报用户。

### 启动 / 停止 / 重启

收到"启动/停止/重启 {应用}"（docker-app / native-app）不走 catalog acquisition envelope：它只能以资源管理面
已经精确选中的 sourceId+entryId+deviceId 和实例级生命周期定义执行。缺精确实例或定义时停止，
不得用名称、本地 Registry 同 ID 条目或当前 catalog 猜容器。界面发出的启停指令就是用户的操作，
不在对话里再确认；`bash` 按当前审批档位执行该实例定义允许的 start/stop/restart；这类运行态切换不改变 installed-entry 的 install 状态。

### 失败处理

| 场景 | 处理 |
|------|------|
| 机器行缺失/畸形/重复 | 无 locator 时不猜写；有 locator 时先强制结算。都禁止从自然语言或本地目录补全 |
| resolver 400/404/409/连接失败 | 保留真实 `registry_acquisition_*` 与有界 reasons，先强制结算，再停止；禁止 Docker/bash/包管理和同 ID fallback |
| resolver 200 但身份/快照/manifest/指南不一致 | 视为不可信响应，先强制结算，不执行任何生命周期副作用 |
| resolver 200 缺失/篡改 catalogReceipt 或 App lifecycle guide 超过 64 KiB | 拒绝执行；禁止本地补建/截断 lifecycle，先强制结算 |
| receipt PATCH CAS/runtime/lifecycle 冲突 | 禁止修改候选绕过；MCP 只在首装、`rollbackAllowed:true`，且操作归属复核为 `current`、`mayRollback:true` 时用无信封 DELETE 回滚，再结算；App 按失败语义结算 |
| operationId 缺失/畸形或旧消息重放 | 失败关闭；不得用当前 installed-entry 的新 operationId 替换旧消息，禁止执行或结算新意图 |
| **本次操作已被接替**（操作归属复核为 `superseded`） | 不结算、不回滚、不撤销已执行的命令、不换 operationId、不调用 PUT；说明本次已被新操作接替，结果以新操作为准 |
| 工具审批被拒或用户叫停 | 按 `pre_execution` 结算：首装回 `failed`，重装/卸载回 `installed`，不得遗留中间态 |
| docker 未运行 | 提示用户启动 Docker；首装回 `failed`，重装回 `installed` |
| 端口被占用 | 列出占用进程，建议换端口或停占用，征求用户意见 |
| compose 启动失败 | `docker compose logs` 取错误，回写 `failed`，附日志摘要 |
| 健康校验超时 | 提示"可能仍在启动"，给出查看日志的命令；如确认失败回写 `failed` |
| **卸载失败**（容器/配置未能移除，应用仍可用） | 回写 **`installed`**（不是 `failed`、不留 `uninstalling`），向用户说明卸载失败原因与排查建议 |
| **重装失败** | 旧版本仍在运行→回写 **`installed`** 并说明重装失败；旧版本已损坏不可用→`failed` |
| **mcp postInstall 失败** | 不注册到 Agent；首装回写 `failed`；重装时旧版本仍可用就用同一 operationId 恢复 `installed`（省略 receipt/version），确认旧版本已损坏才回写 `failed`；附失败命令的 stderr/exitCode 摘要 |
| **mcp 连接测试失败且不是 needs_auth**（含复测仍失败） | 不注册；首装回写 `failed`，重装同一 operationId 恢复 `installed`（省略 receipt/version）；说明 errorCode 与 error 摘要，`credential_unavailable` 时提示先配置凭据再从商店重试 |
| **mcp 连接测试 needs_auth** | 照常注册并回写 `installed`；下一轮出现授权工具时再引导用户调用它完成登录（重装或替换已有配置时可能沿用原有授权）；不按失败处理、不回滚 |
| **mcp 注册 409 带 `unowned_runtime_config_differs` / `unowned_runtime_config_disabled_local_keys`** | 先结算首装 `failed`，再说明并询问：删除（无信封 DELETE 409 响应里的 runtimeServerId）、启用（仅后者）或保留；重新安装由用户在商店发起 |
| **mcp 注册 409 不带 reasons** | 先做操作归属复核；`current` 时按失败语义结算后停止。不删除任何键，不从 agent.json 猜键 |
| **回滚的无信封 DELETE 返回 409** | 别的设备或记录仍持有这个键：保留配置并说明，不再重试 DELETE；记录仍是 `installing`，照常用同一 operationId PATCH `failed` 结算（返回 409 `catalog_operation_mismatch` 时先做操作归属复核） |
| **残留删除的无信封 DELETE 返回 409** | 别的设备或记录仍持有这个键：保留配置，停下说明，不再尝试（本次首装已在残留出口第 1 步结算） |
| **注册后失败且 `reclaimed: true`** | 不回滚、保留收回的配置，按失败语义结算 `failed` |
| **mcp 卸载端点 404**（旧客户端无 DELETE mcp-servers 能力） | 回写 `installed`（不是 `uninstalled`），告知用户升级客户端后重试 mcp 卸载；不手工改 agent.json |

### 边界与安全

- 新安装只处理当前机器消息与 resolver 共同确认的应用/服务；卸载只处理精确 installed ownership。
- `sourceId+entryId+snapshot+operation.deviceId+operation.operationId` 是本次边界；显示名、历史消息、本地同 ID 条目、
  installed-entries 和调用方提供的 install/connection 都不能扩大它。
- App resolver 必须先于 Docker 探测、包管理和所有执行类 `bash`；非 200 或复核失败没有 fallback，
  并必须先结算中间态。uninstall 不受当前 catalog listing/stale 阻断，但只能使用精确 ownership 与
  lifecycle receipt 解析出的旧版本定义。
- 破坏性操作与 Agent 配置写入由工具审批按当前档位把关，全部放行时不再询问；只有操作超出本次机器
  消息的范围时，才向用户说明并询问（见「授权与审批」）。
- 回写状态优先用 PATCH 端点（自带 status 枚举校验与原子写）；仅端点不可用时降级 file-write，此时须自行保证结构合法（status 仅限六枚举值），否则界面加载会过滤掉脏条目。
- **先校验后回写**：docker-app 必须健康校验通过才回写 `installed`；mcp 必须连接测试已连通（或需授权
  `needs_auth`）才注册到 Agent 并回写 `installed`——installed-entries 是「你校验过的事实」，不是「执行过命令」。
- MCP 配置只按服务端签发的键删除：回滚取本次注册 200 判定输出的 runtimeServerId，残留取注册 409 判定输出的
  `residue.runtimeServerId`，都用无信封 DELETE、不带 query；不按 entryId 或显示名删除，也不从 agent.json 按后缀
  猜键。`reclaimed: true` 收回的配置不删除。删除残留、启用本机配置都要先经用户确认。
- operationId 只来自本条机器消息：不自己生成、不改用账本里新的 operationId、不调用任何
  `PUT /api/installed-entries`（带不带 `retryOf` 都不行）。用户要求重试时，引导用户到商店重新安装或点「重试」，
  由界面写新意图并发来新指令。
- **中间态是过渡态，你必须回写终态或（卸载/重装失败时）回 `installed`**——绝不把记录停在 `installing`/`reinstalling`/`uninstalling`，否则界面对应操作按钮会禁用、用户被卡住。唯一例外是本次已被接替（`superseded`）：记录已归新操作所有，旧操作不得写入。

## 与其他技能/系统的协作

- **后端 installed-entries watcher**：消费你回写的 status，只在 `installed` 派生 docker-app 服务、中间态保留派生、终态清理，无需你手动调派生接口。
- **Registry acquisition resolver**：`POST /api/registry/acquisitions/resolve`（install/reinstall 复核当前
  canonical snapshot；App uninstall 按精确 ownership + lifecycle receipt 解析旧 Git object；只授权
  本次读取，不记录安装事实）。
- **installed-entries 回写端点**：`PATCH /api/installed-entries/:entryId/:deviceId`（body 携带 sourceId，结构化回写状态，原子写 + 自动广播刷新前端；旧客户端 404 时才降级 file-write）。
- **agent-service mcp API**：
  - `POST /api/mcp/install`：执行 postInstall + 连接测试。命令失败是 HTTP 200 `success:false`、没有
    connectionTest；`success:true` 只表示命令成功，连通性看 `data.connectionTest`（`success`、`status`、
    `errorCode`、`error`）。
  - `POST /api/mcp/test-connection`：复测。200 时 `data.status` 为 `connected` 或 `needs_auth`；配置非法 400；
    其它失败 500，带 `errorCode` 与 `error`。
  - `POST /api/agents/desirecore/mcp-servers`：注册。200 的 `data.runtimeServerId` 是服务端签发的键，收回时另带
    `data.reclaimed: true`；409 `registry_acquisition_ownership_mismatch` 可能在顶层带 `reasons` 与
    `runtimeServerId`；500 不保证 agent.json 未被写。用 `evaluate-register-response` 判定。
  - `DELETE /api/agents/desirecore/mcp-servers/:serverId` 有两种用法，不得混用：卸载用带信封的形式，路径是
    entryId，query 带 `sourceId`/`deviceId`/`operationId`（由 `build-service-delete` 生成）；回滚与删除残留用
    无信封形式，路径是服务端签发的 runtimeServerId，不带任何 query，有活回执持有时 409，否则删掉这个名字的
    配置（200 `removed:true`），键不存在时 200 `removed:false`。误传裸 entryId 时，agent.json 里若有同名配置
    （例如用户在商店用「添加到 Agent」加过的，或旧的裸键），会被真的删掉，所以绝不能用 entryId 调它。
- **task-management**：长安装可登记为任务跟踪进度。
- **service-health**：派生出的服务由后端周期探活，你无需自行维护其健康。
