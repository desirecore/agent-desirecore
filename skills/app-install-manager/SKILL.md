---
name: 应用安装管理
description: 从应用与服务目录安装/卸载/启停 docker-app（读 install.md → 跑 docker compose → 健康校验 → 回写安装状态）。Use when 用户要求"安装 Dify/n8n 等应用"、"卸载某应用"、"启动/停止/重启某应用"，或安装请求以"请安装 {应用} 到 {设备}"形式到达。
version: "1.0.0"
type: procedural
risk_level: high
status: enabled
disable-model-invocation: true
tags: [installation, docker, registry, app-management]
metadata:
  author: desirecore
  updated_at: "2026-06-16"
---

# app-install-manager 技能

## L0：一句话摘要

应用生命周期执行者：把目录里的 docker-app 真正装起来/卸下去，并把真实结果回写到安装记录，让"应用与服务"界面反映真实状态。

## L1：概述与使用场景

DesireCore 的应用安装是**委派式**的——界面只发出"请安装 {应用} 到 {设备}"这类自然语言指令并乐观记下一条 `installing` 状态；**真正的 docker 执行与状态回写由本技能（你）完成**。后端会监听安装记录文件，在状态变为 `installed` 后自动派生该应用暴露的服务。

使用场景：
- 用户说"安装 Dify""把 n8n 装到本机"
- 用户说"卸载 RagFlow""停止/启动/重启 Open WebUI"
- 收到形如"请安装 {name} 到{device}"的指令

## L2：详细规范（SOP）

### 关键路径与数据

- 应用元数据：`<DesireCore根目录>/registry/official/entries/<appId>/manifest.json`
- 安装指南：`<同目录>/install.md`（含端口、docker compose 步骤、验证地址）
- 安装记录：`<DesireCore根目录>/config/installed-entries.json`
  （`<根目录>` 为你的 AgentFS 根，生产为 `~/.desirecore`，开发隔离为 `~/.desirecore-dev`，以自我感知里的实际根目录为准）

安装记录条目结构（写回时必须完整保留全部字段）：

```json
{
  "entryId": "dify",
  "type": "docker-app",
  "deviceId": "<设备ID>",
  "deviceName": "<设备名>",
  "version": "<版本>",
  "installedAt": 1730000000000,
  "installedBy": "agent",
  "status": "installing | installed | failed | uninstalled",
  "conversationId": "<对话ID>",
  "messageId": "<消息ID>"
}
```

`status` 含义：`installing`=界面乐观态（待你回写）；`installed`=已装好且容器在跑；`failed`=安装失败；`uninstalled`=已卸载。**后端只在 `installed` 时派生服务、在非 installed 时清理派生**——所以你回写的状态直接决定目录是否出现该应用的派生服务。

### 安装流程

1. **解析意图**：从指令提取 `action`（install/uninstall/start/stop/restart）、应用名 → 映射到 `appId`（查 registry entries 目录名 / manifest.id），以及目标设备（缺省=本机）。
2. **读目录数据**：`read` manifest.json 拿到 `install.requirements`（docker/内存/磁盘/ports）与 `exposes`；`read` install.md 拿到部署步骤与验证地址。
3. **环境校验**（`bash`）：`docker version` / `docker compose version` 确认 docker 就绪；用 manifest.ports 检查端口占用（`lsof -i :<port>` 或 `docker ps`）；磁盘空间。任一不满足→停下，向用户说明并给出修复建议，**不要**继续。
4. **高风险确认**：安装/卸载会改动本机容器，属高风险。执行前用一句话向用户确认（应用名 + 目标设备 + 端口）。用户取消则中止。
5. **执行**（`bash`，严格按 install.md）：
   - docker-compose 类：在应用工作目录 `docker compose up -d`；docker 类：`docker run ...`。
   - 失败立即捕获输出，进入"失败处理"。
6. **健康校验**：按 install.md 的验证地址或 manifest.exposes 的 `http://localhost:<port><path>`，`bash` 用 `curl` 轮询（最多 ~2 分钟）确认服务可达。
7. **回写安装记录**（**本技能的核心职责**）：
   - 读 `installed-entries.json` → 按 `entryId`+`deviceId` 定位那条 `installing` 记录 → 把 `status` 改为 `installed`（成功）或 `failed`（失败）→ 写回整个文件。
   - **read-modify-write，只改目标条目的 status，保留其余所有字段与其它条目**（界面也会写此文件，勿覆盖丢失）。
   - 成功后无需手动派生服务——后端文件 watcher 会在检测到 `installed` 后自动派生。
8. **回报用户**：一句话总结结果 + 访问地址（成功）或失败原因 + 排查建议（失败）。

### 卸载流程

1. 确认（高风险）。
2. `bash`：进应用工作目录 `docker compose down -v`（或 `docker rm -f <容器>`），按需清理卷/镜像。
3. 回写安装记录：把该条目 `status` 改为 `uninstalled`（或移除该条目）。后端 watcher 会据此自动清理派生服务与 per-service Skill。
4. 回报用户。

### 启动 / 停止 / 重启

收到"启动/停止/重启 {应用}"：定位应用工作目录，`bash` 执行 `docker compose start|stop|restart`（或 `docker start|stop|restart <容器>`），回报结果。这类运行态切换不改变安装记录的 install 状态。

### 失败处理

| 场景 | 处理 |
|------|------|
| docker 未运行 | 提示用户启动 Docker，安装记录回写 `failed` 或保留 `installing` 并说明 |
| 端口被占用 | 列出占用进程，建议换端口或停占用，征求用户意见 |
| compose 启动失败 | `docker compose logs` 取错误，回写 `failed`，附日志摘要 |
| 健康校验超时 | 提示"可能仍在启动"，给出查看日志的命令；如确认失败回写 `failed` |

### 边界与安全

- 只装 registry 目录中存在的应用；找不到 appId 就明确告知，不要臆造安装命令。
- 所有破坏性 docker 操作前必须有用户确认（risk_level: high）。
- 写 installed-entries.json 必须保结构合法（status 仅限四枚举值），否则界面加载会过滤掉脏条目。

## 与其他技能/系统的协作

- **后端 installed-entries watcher**：消费你回写的 status，自动派生/清理服务，无需你手动调派生接口。
- **task-management**：长安装可登记为任务跟踪进度。
- **service-health**：派生出的服务由后端周期探活，你无需自行维护其健康。
