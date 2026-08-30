---
name: 应用安装管理
description: 经目录快照或已安装生命周期收据 resolver 授权后安装/卸载/启停 docker-app 与 mcp/http-api 服务（docker-app：解析 manifest/installGuide → 跑 docker compose → 健康校验 → 回写安装状态；mcp 服务：使用 resolver 返回的 install/connection → 注册到 Agent → 连接验证 → 回写状态）。Use when 用户要求"安装 Dify/n8n 等应用"、"安装某 MCP 服务"、"卸载某应用/服务"、"启动/停止/重启某应用"，或安装/卸载请求以"请安装/卸载 {名称} 到/从 {设备}"形式到达。
version: "1.3.0"
type: procedural
risk_level: high
status: enabled
disable-model-invocation: true
tags: [installation, docker, mcp, registry, app-management]
metadata:
  author: desirecore
  updated_at: "2026-08-31"
---

# app-install-manager 技能

## L0：一句话摘要

应用/服务生命周期执行者：把目录里的 docker-app 与 mcp/http-api 服务真正装起来/卸下去，并把真实结果回写到安装记录，让"应用与服务"界面反映真实状态。

## L1：概述与使用场景

DesireCore 的安装是**委派式**的——界面发送自然语言说明加机器 envelope，并乐观记下一条中间态
（首装 `installing` / 重装 `reinstalling` / 卸载 `uninstalling`）；**真正的执行与终态回写由本技能
（你）完成**。后端会监听安装记录文件：在状态变为 `installed` 后自动派生 docker-app 暴露的服务，
在中间态保留既有派生，仅在终态（`failed`/`uninstalled`/条目移除）清理派生。

覆盖两类目标：
- **docker-app**：Dify / n8n / RagFlow 等，走 docker compose 部署。
- **mcp / http-api 服务**：MCP 服务器（按 registry 的 `install` 字段安装 + 注册到 Agent）与 HTTP API 服务（仅登记安装记录，无自动化部署动作）。

使用场景：
- 用户说"安装 Dify""把 n8n 装到本机""安装某 MCP 服务"
- 用户说"卸载 RagFlow""卸载某 MCP 服务""停止/启动/重启 Open WebUI"
- 收到形如"请安装 {name} 到{device}""请卸载 {name}"的指令

## L2：详细规范（SOP）

### 关键路径与数据

- 当前目录快照解析：`POST http://127.0.0.1:<agent-service-port>/api/registry/acquisitions/resolve`
- 机器消息解析与响应复核：`<本技能目录>/scripts/registry-catalog-acquisition.mjs`
- 安装记录：`<DesireCore根目录>/config/installed-entries.json`
  （`<根目录>` 为你的 AgentFS 根，生产为 `~/.desirecore`，开发隔离为 `~/.desirecore-dev`，以自我感知里的实际根目录为准）
- agent-service API：`http://127.0.0.1:<agent-service-port>`（端口见自我感知；mcp 服务安装/注册用）

### 执行前协议：精确机器消息 → ownership / resolver（强制）

任何 install/reinstall/uninstall 在环境探测、Docker 查询、包安装或其它执行类 `bash` 前，都必须
先完成本节。自然语言只用于面向用户的说明，**不得**从自然语言猜测 `kind`、`sourceId`、
`entryId`、deviceId、snapshot、install 或 connection。

1. 从**当前这条**生命周期指令中提取唯一一行：
   `RegistryCatalogAcquisition=<单行 JSON>`。App envelope 必须额外带
   `operation:{action:"install"|"reinstall"|"uninstall",deviceId}`；Service resolver 为兼容旧调用方
   允许缺省 operation，但 UI 发起的 Service lifecycle 也必须携带它，才能可靠结算。先把指令全文交给
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
2. 对 App 三种 operation 及 Service，把解析结果的 `request` 原样作为 body 调 resolver：

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
3. 只有 HTTP 200 且响应通过同一脚本的 `evaluate-response` 复核后才可继续。复核
   输入是 `{ "expected": <request>, "status": <HTTP状态>, "body": <响应JSON> }`。响应的
   kind/sourceId/entryId/snapshot、manifest.id/type 必须一致，App 还必须取得非空 installGuide。
   `allowed:true` 才是本次执行定义；App 只使用其 manifest/installGuide，忽略任何 install/connection。
   uninstall 的 manifest/installGuide 必须来自服务端 receipt 解析结果，不能改读当前目录。
4. 服务端有界拒绝码必须逐字保留：
   `registry_acquisition_invalid_request`、`registry_acquisition_not_found`、
   `registry_acquisition_snapshot_stale`、`registry_acquisition_blocked`、
   `registry_acquisition_client_upgrade_required`、`registry_acquisition_config_mismatch`、
   `registry_acquisition_install_guide_unavailable`、`registry_acquisition_receipt_missing`、
   `registry_acquisition_ownership_mismatch`；同时保留通过有界校验的 reasons。任何非 200、
   连接失败、非 JSON 或身份/快照/manifest 不一致都禁止执行命令，并先完成强制结算。
5. **禁止 fallback**：不得读取任何本地 Registry 条目、改用同 ID 其它来源或沿用旧 resolver 响应。
   resolver/ownership 只决定本次读取与精确归属，不新增安装账本，也不替代 Human Gate、健康校验、
   回滚和终态收据。

安装记录条目结构（写回时必须完整保留全部字段）：

```json
{
  "entryId": "dify",
  "sourceId": "registry:official",
  "type": "docker-app | mcp | http-api",
  "deviceId": "<设备ID>",
  "deviceName": "<设备名>",
  "version": "<版本>",
  "installedAt": 1730000000000,
  "installedBy": "agent",
  "status": "installing | reinstalling | installed | uninstalling | failed | uninstalled",
  "conversationId": "<对话ID>",
  "messageId": "<消息ID>",
  "catalogReceipt": {
    "schemaVersion": 1,
    "catalogSourceId": "registry:official",
    "entryId": "dify",
    "catalogCommit": "<40/64位commit>",
    "catalogPath": "entries/dify",
    "releaseVersion": "<安装版本>",
    "runtimeServerId": "<仅MCP注册成功后由服务端签发>"
  }
}
```

`catalogReceipt` 是同一 installed-entry 内的最小不可变生命周期收据，不是第二账本。App 安装意图
已携带无 runtimeServerId 的 receipt；MCP 注册成功后才把服务端返回的 runtimeServerId 原子补入。

**状态语义表（六枚举）**——中间态由界面乐观写入、终态由你回写：

| status | 谁写入 | 你的退出动作 |
|--------|--------|-------------|
| `installing` | 界面首装乐观态 | 成功→`installed`；失败→`failed` |
| `reinstalling` | 界面重装乐观态（此前已 `installed`） | 成功→`installed`；失败但**旧版本仍在运行**→回写 `installed` 并说明重装失败；失败且应用已不可用→`failed` |
| `uninstalling` | 界面卸载乐观态 | 成功→`uninstalled`（或移除条目）；**失败→回写 `installed`** 并向用户说明失败原因 |
| `installed` / `failed` / `uninstalled` | 你回写的终态 | — |

**后端派生规则（务必理解）**：只在 `installed` 派生 docker-app 的服务；在中间态（`installing`/`reinstalling`/`uninstalling`）**保留**既有派生；仅在终态（`failed`/`uninstalled`/条目移除）**清理**派生。因此：
- 重装/卸载期间派生服务不会被误删（旧容器还在跑时目录不抖动）；
- 卸载或重装失败时你回写 `installed`，派生会**无缝恢复**（从未被删）；
- `failed` 语义是"应用当前不可用"——**只有确认容器已不能用才写 `failed`**，否则一律回 `installed`。

### 执行前停止的强制结算

UI 在发消息前已经写入中间态。locator 成功后，完整解析失败、resolver 拒绝/异常、Human Gate
取消、环境检查失败，或任何尚未执行安装/卸载命令的退出，都必须按下面的单账本流程结算：

1. `GET /api/installed-entries` 取得当前实例记录；不得直读其它实例或构造新记录。
2. 把 `{stage,locator,entries}` 交给脚本的 `plan-settlement`。stage 只能是
   `parse|resolver|human_gate|pre_execution`。它严格匹配 sourceId+entryId+deviceId 和与 operation
   对应的中间态；同 ID 双来源不会串写，零条/多条都返回 settlement:null。
3. settlement 非空时，按“回写安装记录的统一方式”PATCH 它给出的精确三元组和 status：
   `installing → failed`，`reinstalling → installed`，`uninstalling → installed`。结算前后都不得执行
   Docker、包管理或安装脚本。settlement:null 时报告有界原因并停止，不按数组顺序、名称或设备猜测。
4. Human Gate 取消也是正常停止而非悬空：首装回 `failed`，重装/卸载恢复 `installed`。resolver
   错误码与 reasons 在完成结算后原样说明。

### 回写安装记录的统一方式（端点优先，404 降级）

**所有「回写安装记录」都用这一方式**——不要再直接 file-write 改 `installed-entries.json`（除非端点不可用时降级）。这样 installed-entries 成为「你校验后回写的事实」，界面以它为准。

**首选：PATCH 端点**（结构化 + 原子写 + 自动广播刷新前端）：

```yaml
tool: HttpRequest
parameters:
  url: http://127.0.0.1:<agent-service-port>/api/installed-entries/<entryId>/<deviceId>
  method: PATCH
  body:
    sourceId: <locator 中的精确 sourceId>
    status: installed        # 六枚举之一
    # version: "<新版本>"    # 可选，重装升级时更新版本号
```

- `200` → 回写成功，前端自动刷新，**无需**再手动改文件。
- `400` → status/sourceId 非法，检查取值。
- `404 entry_not_found` → 该条中间态记录不存在（界面未写/已被清理）。**不要**重试或伪造记录；跳过并一句话提示用户重发指令即可。
- **连接失败 / 路由 404（旧客户端无此端点）** → **降级 file-write**（见下）。

**降级 file-write**（仅终态 PATCH 端点不可用时；目录 resolver 绝无此降级）：读
`installed-entries.json` → 按 `sourceId`+`entryId`+`deviceId` 精确定位那条中间态记录 → **只改
`status`（保留 `installedAt` 等其余所有字段与其它条目）** → 写回整个文件（界面也写此文件，
勿覆盖丢失）。来源缺失或存在多条候选时失败关闭，不得按同 ID 猜测。

下文各流程的「回写安装记录」一律指这套统一方式，只标注目标 `status`。

### docker-app 安装流程

1. **解析机器消息并调用 resolver**：严格执行“执行前协议”。action 与 deviceId 只认 operation；
   `entryId`、`type`、版本、端口、exposes 和安装步骤只认复核后的服务端结果。manifest.type 不是
   `docker-app` 时改走下方服务流程；身份或类型不一致立即停止。
2. **读取本次授权定义**：从 resolver 返回的 manifest 读取 `install.requirements`（docker/内存/
   磁盘/ports）与 exposes；只把 resolver 返回的 installGuide 作为部署步骤与验证地址。不得从
   AgentFS 或其它目录补读/覆盖同 ID 定义。
3. **环境校验**（`bash`）：`docker version` / `docker compose version` 确认 docker 就绪；用
   `manifest.install.requirements.ports` 检查端口占用（`lsof -i :<port>` 或 `docker ps`）；检查磁盘
   空间。任一不满足→先按 `pre_execution` 结算再停下，向用户说明并给出修复建议。
4. **高风险确认**：安装/卸载会改动本机容器，属高风险。执行前用一句话向用户确认（应用名 +
   目标设备 + 端口）。用户取消则按 `human_gate` 结算后中止。
5. **执行**（`bash`，严格按 resolver 返回的 installGuide）：
   - docker-compose 类：在应用工作目录 `docker compose up -d`；docker 类：`docker run ...`。
   - 失败立即捕获输出，进入"失败处理"。
6. **健康校验（先校验后回写，强制）**：按 installGuide 的验证地址或 manifest.exposes 的 `http://localhost:<port><path>`，`bash` 用 `curl` 轮询（最多 ~2 分钟）确认服务可达。**只有这步通过才算安装成功**——不要仅凭 `docker compose up -d` 无报错就回写 `installed`。
7. **回写安装记录**（**本技能的核心职责**，按上方「回写安装记录的统一方式」）：
   - 健康校验通过 → PATCH `status: installed`；未通过/失败 → `status: failed`；重装失败但旧版本仍在运行 → 回 `installed`（见状态语义表）。
   - 成功后无需手动派生服务——后端文件 watcher 检测到 `installed` 后自动派生；重装期间派生始终保留。
8. **回报用户**：一句话总结结果 + 访问地址（成功）或失败原因 + 排查建议（失败）。

### docker-app 卸载流程

1. 完整解析 App envelope 并调用 resolver。resolver 必须用 operation.deviceId 精确命中
   sourceId+entryId+deviceId 的 `uninstalling` 记录，再按该记录的不可变 lifecycle receipt 读取旧 Git
   object；**不得以当前 catalog eligibility 重新授权卸载**。同 ID 其它来源、其它设备、无 receipt
   legacy 记录或 receipt/snapshot 不一致都拒绝。
2. 只使用 resolver 从 receipt 返回并通过脚本复核的 manifest/installGuide 作为卸载定义；不得读取
   当前 Registry 同 ID 条目补命令。resolver 拒绝时先结算回 `installed` 并提示手工管理/升级，不能
   发明 compose 目录或容器名。取得定义后再做 Human Gate；取消即回 `installed`。
3. `bash`：只按 receipt 绑定的 installGuide 执行卸载（如 `docker compose down -v`），按需清理
   卷/镜像。
4. 回写安装记录（按「回写安装记录的统一方式」）：
   - **成功**（容器确已停止/删除）→ PATCH `status: uninstalled`。后端 watcher 据此清理派生服务与 per-service Skill。
   - **失败**（容器未能停止/删除，应用仍在运行）→ PATCH `status: installed`，向用户说明卸载失败原因。**切勿**留在 `uninstalling`（界面卸载按钮会禁用，用户被卡住直至 stale 超时）。
5. 回报用户。

### mcp / http-api 服务安装流程

**mcp 服务**（manifest.type=`mcp`，条目含 `install` 与 `connection` 字段）：

1. **解析机器消息并调用 resolver + 确认**：严格执行“执行前协议”，以复核后的复合身份确定
   `entryId`，以 operation.deviceId 确定目标设备（mcp 通常装到本机）。resolver 失败时在任何安装命令前
   停止；成功后再做高风险确认。界面已乐观写 `installing`/`reinstalling`。
2. **使用本次授权定义**：只用 resolver 响应的 manifest/install/connection（`install` 含 method、
   packageName、command、args、postInstall；`connection` 含 transport/command/args/url/headers）。
   不读取或合并本地同 ID 条目。
3. **执行安装**（优先走 API，逐条跑 `postInstall` 命令 + 可选连接测试）：
   ```yaml
   tool: HttpRequest
   parameters:
     url: http://127.0.0.1:<agent-service-port>/api/mcp/install
     method: POST
     body:
       install: <manifest.install 原样>
       connection: <manifest.connection 原样>   # 传入则安装后自动测连接
       catalogAcquisition: <parse-message 输出的 request 原样>
   ```
   返回 `data.steps`（每条命令 exitCode/stdout/stderr）与 `data.connectionTest`。任一命令失败→`success:false`，进入"失败处理"。无 API 可用时用 `bash` 逐条跑 `postInstall`。
4. **注册到 Agent**（让 MCP 工具下轮可用）：
   ```yaml
   tool: HttpRequest
   parameters:
     url: http://127.0.0.1:<agent-service-port>/api/agents/desirecore/mcp-servers
     method: POST
     body:
       serverId: <entryId>
       config: <manifest.connection 原样>
       catalogAcquisition: <parse-message 输出的 request 原样>
   ```
   端点锁内 read-modify-write 写入 agent.json 的 `mcp_servers`——**勿手工编辑 agent.json**（绕锁会丢
   并发更新）。catalog 响应的 `data.runtimeServerId` 是服务端签发的复合 ownership key；不得用
   entryId、显示名或调用方值代替。
5. **连接校验（先校验后回写，强制）**：看第 3 步返回的 `connectionTest.success`，或单独 `POST /api/mcp/test-connection`（body `{connection}`）确认能连通、能列出工具。**只有校验通过才算安装成功**——不要仅凭 postInstall 命令退出码 0 就回写 `installed`（装了包不等于连得上）。
6. **回写安装记录**（按「回写安装记录的统一方式」）：连接校验通过后，用脚本 `build-receipt`
   把 request.snapshot 加 `entryId` 与服务端返回的 `runtimeServerId` 组成 `catalogReceipt`，与
   `status: installed` 在同一次
   精确 PATCH 中写回原 installed-entry；这仍是唯一安装账本。缺 runtimeServerId 或 receipt 回写失败
   时不得宣布成功，先按精确 runtimeServerId 回滚刚注册的 MCP，再按失败语义结算。连接校验失败
   → `failed`（重装失败但旧配置仍可用 → 回 `installed`）。
7. **回报用户**：总结安装结果 + 发现的工具数（成功）或失败原因摘要（失败）。

**http-api 服务**（manifest.type=`http-api`，无 `install` 字段、界面也无自动化安装动作）：按「回写安装记录的统一方式」维护回写（`installing`→`installed`、`uninstalling`→`uninstalled`/失败回 `installed`），明确告知用户该类服务无本地部署步骤、只是登记可达性。

### mcp / http-api 服务卸载流程

1. 先**解析机器消息并调用 resolver**；失败则不执行包管理、配置写入或 `bash`。成功后确认
   （高风险）。界面已置 `uninstalling`。
2. **执行卸载**（mcp）：从 Agent 移除 MCP server 配置：
   ```yaml
   tool: HttpRequest
   parameters:
     url: http://127.0.0.1:<agent-service-port>/api/agents/desirecore/mcp-servers/<entryId>?sourceId=<sourceId>&deviceId=<deviceId>
     method: DELETE
   ```
   服务端从精确 installed-entry receipt 的 runtimeServerId 删除对应配置；不得按裸 entryId 删除。
   端点幂等。如安装时全局装了包，按需 `bash` 卸载（可选，多为无害保留）。http-api 服务无需执行
   动作，直接进第 3 步。
   - **旧客户端降级**：该 DELETE 端点是较新客户端才有的能力。若返回 **404 / Not Found / 路由不存在**，说明当前客户端版本尚未包含 mcp 卸载端点——**不要**当作卸载成功。此时回写安装记录为 `installed`（保持"仍在用"），并一句话告知用户"当前客户端版本不支持 mcp 服务卸载，请升级客户端后重试"。切勿手工编辑 agent.json 绕过（绕锁会丢并发更新）。
3. **回写安装记录**（按「回写安装记录的统一方式」）：成功 → PATCH `status: uninstalled`；**失败（含 DELETE mcp-servers 端点 404 降级）→ PATCH `status: installed`** 并说明原因（勿留在 `uninstalling`）。
4. 回报用户。

### 启动 / 停止 / 重启

收到"启动/停止/重启 {应用}"（docker-app）不走 catalog acquisition envelope：它只能以资源管理面
已经精确选中的 sourceId+entryId+deviceId 和实例级生命周期定义执行。缺精确实例或定义时停止，
不得用名称、本地 Registry 同 ID 条目或当前 catalog 猜容器。完成高风险确认后才用 `bash` 执行
该实例定义允许的 start/stop/restart；这类运行态切换不改变 installed-entry 的 install 状态。

### 失败处理

| 场景 | 处理 |
|------|------|
| 机器行缺失/畸形/重复 | 无 locator 时不猜写；有 locator 时先强制结算。都禁止从自然语言或本地目录补全 |
| resolver 400/404/409/连接失败 | 保留真实 `registry_acquisition_*` 与有界 reasons，先强制结算，再停止；禁止 Docker/bash/包管理和同 ID fallback |
| resolver 200 但身份/快照/manifest/指南不一致 | 视为不可信响应，先强制结算，不执行任何生命周期副作用 |
| Human Gate 取消 | 首装回 `failed`，重装/卸载回 `installed`，不得遗留中间态 |
| docker 未运行 | 提示用户启动 Docker；首装回 `failed`，重装回 `installed` |
| 端口被占用 | 列出占用进程，建议换端口或停占用，征求用户意见 |
| compose 启动失败 | `docker compose logs` 取错误，回写 `failed`，附日志摘要 |
| 健康校验超时 | 提示"可能仍在启动"，给出查看日志的命令；如确认失败回写 `failed` |
| **卸载失败**（容器/配置未能移除，应用仍可用） | 回写 **`installed`**（不是 `failed`、不留 `uninstalling`），向用户说明卸载失败原因与排查建议 |
| **重装失败** | 旧版本仍在运行→回写 **`installed`** 并说明重装失败；旧版本已损坏不可用→`failed` |
| **mcp postInstall 失败** | 回写 `failed`，附失败命令的 stderr/exitCode 摘要；不注册到 Agent |
| **mcp 卸载端点 404**（旧客户端无 DELETE mcp-servers 能力） | 回写 `installed`（不是 `uninstalled`），告知用户升级客户端后重试 mcp 卸载；不手工改 agent.json |

### 边界与安全

- 新安装只处理当前机器消息与 resolver 共同确认的应用/服务；卸载只处理精确 installed ownership。
- `sourceId+entryId+snapshot+operation.deviceId` 是本次边界；显示名、历史消息、本地同 ID 条目、
  installed-entries 和调用方提供的 install/connection 都不能扩大它。
- App resolver 必须先于 Docker 探测、包管理和所有执行类 `bash`；非 200 或复核失败没有 fallback，
  并必须先结算中间态。uninstall 不受当前 catalog listing/stale 阻断，但只能使用精确 ownership 与
  lifecycle receipt 解析出的旧版本定义。
- 所有破坏性 docker 操作与 Agent 配置写入前必须有用户确认（risk_level: high）。
- 回写状态优先用 PATCH 端点（自带 status 枚举校验与原子写）；仅端点不可用时降级 file-write，此时须自行保证结构合法（status 仅限六枚举值），否则界面加载会过滤掉脏条目。
- **先校验后回写**：docker-app 必须健康校验通过、mcp 必须连接校验通过，才回写 `installed`——installed-entries 是「你校验过的事实」，不是「执行过命令」。
- **中间态是过渡态，你必须回写终态或（卸载/重装失败时）回 `installed`**——绝不把记录停在 `installing`/`reinstalling`/`uninstalling`，否则界面对应操作按钮会禁用、用户被卡住。

## 与其他技能/系统的协作

- **后端 installed-entries watcher**：消费你回写的 status，只在 `installed` 派生 docker-app 服务、中间态保留派生、终态清理，无需你手动调派生接口。
- **Registry acquisition resolver**：`POST /api/registry/acquisitions/resolve`（install/reinstall 复核当前
  canonical snapshot；App uninstall 按精确 ownership + lifecycle receipt 解析旧 Git object；只授权
  本次读取，不记录安装事实）。
- **installed-entries 回写端点**：`PATCH /api/installed-entries/:entryId/:deviceId`（body 携带 sourceId，结构化回写状态，原子写 + 自动广播刷新前端；旧客户端 404 时才降级 file-write）。
- **agent-service mcp API**：`POST /api/mcp/install`（执行 postInstall + 连接测试）、`POST /api/agents/desirecore/mcp-servers`（注册）、`DELETE /api/agents/desirecore/mcp-servers/:serverId`（卸载）、`POST /api/mcp/test-connection`（验证）。
- **task-management**：长安装可登记为任务跟踪进度。
- **service-health**：派生出的服务由后端周期探活，你无需自行维护其健康。
