---
name: 应用安装管理
description: 从应用与服务目录安装/卸载/启停 docker-app 与 mcp/http-api 服务（docker-app：读 install.md → 跑 docker compose → 健康校验 → 回写安装状态；mcp 服务：按 install 字段安装 → 注册到 Agent → 连接验证 → 回写状态）。Use when 用户要求"安装 Dify/n8n 等应用"、"安装某 MCP 服务"、"卸载某应用/服务"、"启动/停止/重启某应用"，或安装/卸载请求以"请安装/卸载 {名称} 到/从 {设备}"形式到达。
version: "1.2.0"
type: procedural
risk_level: high
status: enabled
disable-model-invocation: true
tags: [installation, docker, mcp, registry, app-management]
metadata:
  author: desirecore
  updated_at: "2026-07-20"
---

# app-install-manager 技能

## L0：一句话摘要

应用/服务生命周期执行者：把目录里的 docker-app 与 mcp/http-api 服务真正装起来/卸下去，并把真实结果回写到安装记录，让"应用与服务"界面反映真实状态。

## L1：概述与使用场景

DesireCore 的安装是**委派式**的——界面只发出"请安装 {名称} 到 {设备}"这类自然语言指令并乐观记下一条中间态（首装 `installing` / 重装 `reinstalling` / 卸载 `uninstalling`）；**真正的执行与终态回写由本技能（你）完成**。后端会监听安装记录文件：在状态变为 `installed` 后自动派生 docker-app 暴露的服务，在中间态保留既有派生，仅在终态（`failed`/`uninstalled`/条目移除）清理派生。

覆盖两类目标：
- **docker-app**：Dify / n8n / RagFlow 等，走 docker compose 部署。
- **mcp / http-api 服务**：MCP 服务器（按 registry 的 `install` 字段安装 + 注册到 Agent）与 HTTP API 服务（仅登记安装记录，无自动化部署动作）。

使用场景：
- 用户说"安装 Dify""把 n8n 装到本机""安装某 MCP 服务"
- 用户说"卸载 RagFlow""卸载某 MCP 服务""停止/启动/重启 Open WebUI"
- 收到形如"请安装 {name} 到{device}""请卸载 {name}"的指令

## L2：详细规范（SOP）

### 关键路径与数据

- 应用/服务元数据：`<DesireCore根目录>/registry/official/entries/<entryId>/manifest.json`
- 安装指南（docker-app）：`<同目录>/install.md`（含端口、docker compose 步骤、验证地址）
- 安装记录：`<DesireCore根目录>/config/installed-entries.json`
  （`<根目录>` 为你的 AgentFS 根，生产为 `~/.desirecore`，开发隔离为 `~/.desirecore-dev`，以自我感知里的实际根目录为准）
- agent-service API：`http://127.0.0.1:<agent-service-port>`（端口见自我感知；mcp 服务安装/注册用）

安装记录条目结构（写回时必须完整保留全部字段）：

```json
{
  "entryId": "dify",
  "type": "docker-app | mcp | http-api",
  "deviceId": "<设备ID>",
  "deviceName": "<设备名>",
  "version": "<版本>",
  "installedAt": 1730000000000,
  "installedBy": "agent",
  "status": "installing | reinstalling | installed | uninstalling | failed | uninstalled",
  "conversationId": "<对话ID>",
  "messageId": "<消息ID>"
}
```

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

### 回写安装记录的统一方式（端点优先，404 降级）

**所有「回写安装记录」都用这一方式**——不要再直接 file-write 改 `installed-entries.json`（除非端点不可用时降级）。这样 installed-entries 成为「你校验后回写的事实」，界面以它为准。

**首选：PATCH 端点**（结构化 + 原子写 + 自动广播刷新前端）：

```yaml
tool: HttpRequest
parameters:
  url: http://127.0.0.1:<agent-service-port>/api/installed-entries/<entryId>/<deviceId>
  method: PATCH
  body:
    status: installed        # 六枚举之一
    # version: "<新版本>"    # 可选，重装升级时更新版本号
```

- `200` → 回写成功，前端自动刷新，**无需**再手动改文件。
- `400` → status 非法枚举，检查取值。
- `404 entry_not_found` → 该条中间态记录不存在（界面未写/已被清理）。**不要**重试或伪造记录；跳过并一句话提示用户重发指令即可。
- **连接失败 / 路由 404（旧客户端无此端点）** → **降级 file-write**（见下）。

**降级 file-write**（仅端点不可用时）：读 `installed-entries.json` → 按 `entryId`+`deviceId` 定位那条中间态记录 → **只改 `status`（保留 `installedAt` 等其余所有字段与其它条目）** → 写回整个文件（界面也写此文件，勿覆盖丢失）。

下文各流程的「回写安装记录」一律指这套统一方式，只标注目标 `status`。

### docker-app 安装流程

1. **解析意图**：从指令提取 `action`（install/uninstall/start/stop/restart）、名称 → 映射到 `entryId`（查 registry entries 目录名 / manifest.id）、`type`（manifest.type），以及目标设备（缺省=本机）。若 `type` 为 `mcp`/`http-api`，改走下方"mcp / http-api 服务安装流程"。
2. **读目录数据**：`read` manifest.json 拿到 `install.requirements`（docker/内存/磁盘/ports）与 `exposes`；`read` install.md 拿到部署步骤与验证地址。
3. **环境校验**（`bash`）：`docker version` / `docker compose version` 确认 docker 就绪；用 manifest.ports 检查端口占用（`lsof -i :<port>` 或 `docker ps`）；磁盘空间。任一不满足→停下，向用户说明并给出修复建议，**不要**继续。
4. **高风险确认**：安装/卸载会改动本机容器，属高风险。执行前用一句话向用户确认（应用名 + 目标设备 + 端口）。用户取消则中止。
5. **执行**（`bash`，严格按 install.md）：
   - docker-compose 类：在应用工作目录 `docker compose up -d`；docker 类：`docker run ...`。
   - 失败立即捕获输出，进入"失败处理"。
6. **健康校验（先校验后回写，强制）**：按 install.md 的验证地址或 manifest.exposes 的 `http://localhost:<port><path>`，`bash` 用 `curl` 轮询（最多 ~2 分钟）确认服务可达。**只有这步通过才算安装成功**——不要仅凭 `docker compose up -d` 无报错就回写 `installed`。
7. **回写安装记录**（**本技能的核心职责**，按上方「回写安装记录的统一方式」）：
   - 健康校验通过 → PATCH `status: installed`；未通过/失败 → `status: failed`；重装失败但旧版本仍在运行 → 回 `installed`（见状态语义表）。
   - 成功后无需手动派生服务——后端文件 watcher 检测到 `installed` 后自动派生；重装期间派生始终保留。
8. **回报用户**：一句话总结结果 + 访问地址（成功）或失败原因 + 排查建议（失败）。

### docker-app 卸载流程

1. 确认（高风险）。此时界面已把记录置 `uninstalling`（派生仍保留）。
2. `bash`：进应用工作目录 `docker compose down -v`（或 `docker rm -f <容器>`），按需清理卷/镜像。
3. 回写安装记录（按「回写安装记录的统一方式」）：
   - **成功**（容器确已停止/删除）→ PATCH `status: uninstalled`。后端 watcher 据此清理派生服务与 per-service Skill。
   - **失败**（容器未能停止/删除，应用仍在运行）→ PATCH `status: installed`，向用户说明卸载失败原因。**切勿**留在 `uninstalling`（界面卸载按钮会禁用，用户被卡住直至 stale 超时）。
4. 回报用户。

### mcp / http-api 服务安装流程

**mcp 服务**（manifest.type=`mcp`，条目含 `install` 与 `connection` 字段）：

1. **解析意图 + 确认**：确定 `entryId`、目标设备（mcp 通常装到本机）。高风险确认。界面已乐观写 `installing`/`reinstalling`。
2. **读条目**：`read` manifest.json 拿 `install`（`method` npx/pip/uvx/docker/binary、`packageName`、`command`、`args`、`postInstall`）与 `connection`（transport/command/args/url/headers）。
3. **执行安装**（优先走 API，逐条跑 `postInstall` 命令 + 可选连接测试）：
   ```yaml
   tool: HttpRequest
   parameters:
     url: http://127.0.0.1:<agent-service-port>/api/mcp/install
     method: POST
     body:
       install: <manifest.install 原样>
       connection: <manifest.connection 原样>   # 传入则安装后自动测连接
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
   ```
   端点锁内 read-modify-write 写入 agent.json 的 `mcp_servers`——**勿手工编辑 agent.json**（绕锁会丢并发更新）。
5. **连接校验（先校验后回写，强制）**：看第 3 步返回的 `connectionTest.success`，或单独 `POST /api/mcp/test-connection`（body `{connection}`）确认能连通、能列出工具。**只有校验通过才算安装成功**——不要仅凭 postInstall 命令退出码 0 就回写 `installed`（装了包不等于连得上）。
6. **回写安装记录**（按「回写安装记录的统一方式」）：连接校验通过 → PATCH `status: installed`；校验失败 → `status: failed`（重装失败但旧配置仍可用 → 回 `installed`）。
7. **回报用户**：总结安装结果 + 发现的工具数（成功）或失败原因摘要（失败）。

**http-api 服务**（manifest.type=`http-api`，无 `install` 字段、界面也无自动化安装动作）：按「回写安装记录的统一方式」维护回写（`installing`→`installed`、`uninstalling`→`uninstalled`/失败回 `installed`），明确告知用户该类服务无本地部署步骤、只是登记可达性。

### mcp / http-api 服务卸载流程

1. 确认（高风险）。界面已置 `uninstalling`。
2. **执行卸载**（mcp）：从 Agent 移除 MCP server 配置：
   ```yaml
   tool: HttpRequest
   parameters:
     url: http://127.0.0.1:<agent-service-port>/api/agents/desirecore/mcp-servers/<serverId>
     method: DELETE
   ```
   端点幂等（`serverId` 不存在也返回成功）。如安装时全局装了包，按需 `bash` 卸载（可选，多为无害保留）。http-api 服务无需执行动作，直接进第 3 步。
   - **旧客户端降级**：该 DELETE 端点是较新客户端才有的能力。若返回 **404 / Not Found / 路由不存在**，说明当前客户端版本尚未包含 mcp 卸载端点——**不要**当作卸载成功。此时回写安装记录为 `installed`（保持"仍在用"），并一句话告知用户"当前客户端版本不支持 mcp 服务卸载，请升级客户端后重试"。切勿手工编辑 agent.json 绕过（绕锁会丢并发更新）。
3. **回写安装记录**（按「回写安装记录的统一方式」）：成功 → PATCH `status: uninstalled`；**失败（含 DELETE mcp-servers 端点 404 降级）→ PATCH `status: installed`** 并说明原因（勿留在 `uninstalling`）。
4. 回报用户。

### 启动 / 停止 / 重启

收到"启动/停止/重启 {应用}"（docker-app）：定位应用工作目录，`bash` 执行 `docker compose start|stop|restart`（或 `docker start|stop|restart <容器>`），回报结果。这类运行态切换不改变安装记录的 install 状态。

### 失败处理

| 场景 | 处理 |
|------|------|
| docker 未运行 | 提示用户启动 Docker，安装记录回写 `failed` 或保留中间态并说明 |
| 端口被占用 | 列出占用进程，建议换端口或停占用，征求用户意见 |
| compose 启动失败 | `docker compose logs` 取错误，回写 `failed`，附日志摘要 |
| 健康校验超时 | 提示"可能仍在启动"，给出查看日志的命令；如确认失败回写 `failed` |
| **卸载失败**（容器/配置未能移除，应用仍可用） | 回写 **`installed`**（不是 `failed`、不留 `uninstalling`），向用户说明卸载失败原因与排查建议 |
| **重装失败** | 旧版本仍在运行→回写 **`installed`** 并说明重装失败；旧版本已损坏不可用→`failed` |
| **mcp postInstall 失败** | 回写 `failed`，附失败命令的 stderr/exitCode 摘要；不注册到 Agent |
| **mcp 卸载端点 404**（旧客户端无 DELETE mcp-servers 能力） | 回写 `installed`（不是 `uninstalled`），告知用户升级客户端后重试 mcp 卸载；不手工改 agent.json |

### 边界与安全

- 只装 registry 目录中存在的应用/服务；找不到 entryId 就明确告知，不要臆造安装命令。
- 所有破坏性 docker 操作与 Agent 配置写入前必须有用户确认（risk_level: high）。
- 回写状态优先用 PATCH 端点（自带 status 枚举校验与原子写）；仅端点不可用时降级 file-write，此时须自行保证结构合法（status 仅限六枚举值），否则界面加载会过滤掉脏条目。
- **先校验后回写**：docker-app 必须健康校验通过、mcp 必须连接校验通过，才回写 `installed`——installed-entries 是「你校验过的事实」，不是「执行过命令」。
- **中间态是过渡态，你必须回写终态或（卸载/重装失败时）回 `installed`**——绝不把记录停在 `installing`/`reinstalling`/`uninstalling`，否则界面对应操作按钮会禁用、用户被卡住。

## 与其他技能/系统的协作

- **后端 installed-entries watcher**：消费你回写的 status，只在 `installed` 派生 docker-app 服务、中间态保留派生、终态清理，无需你手动调派生接口。
- **installed-entries 回写端点**：`PATCH /api/installed-entries/:entryId/:deviceId`（结构化回写状态，原子写 + 自动广播刷新前端；旧客户端 404 时降级 file-write）。
- **agent-service mcp API**：`POST /api/mcp/install`（执行 postInstall + 连接测试）、`POST /api/agents/desirecore/mcp-servers`（注册）、`DELETE /api/agents/desirecore/mcp-servers/:serverId`（卸载）、`POST /api/mcp/test-connection`（验证）。
- **task-management**：长安装可登记为任务跟踪进度。
- **service-health**：派生出的服务由后端周期探活，你无需自行维护其健康。
