---
id: mem_patrol_metrics_20260827
type: lesson
pinned: false
created_at: 2026-08-27T20:50:00+08:00
topics: [软著巡检, 度量口径, 多智能体监控, 截图质检]
---

## L0

巡检看"页面数/文件类型"而非代码行数；截图检空白要用体积+md5 双指标。

## L1

### 教训 1：代码行数会掩盖"零 UI 产出"
2026-08-27 第 1 轮把 #8 知识产权记为"页面开发中（33 文件/5217 行）"，第 2 轮逐文件核实后发现
src/ 下 48 个文件**全是 .ts**（types/constants/mocks/api/utils），**0 个 .tsx、无 pages/views/components 目录**。
它在写 mock 数据层，UI 一行没有。行数在全批中游，完全掩盖了真实进度。

**规则**：多 Agent 前端项目巡检必须单列 `find src -name "*.tsx" | wc -l` 与页面目录存在性
（`ls -d src/pages src/views src/components src/app`），不能只看 `.ts`+`.tsx` 合计行数。
mock 层/类型层/工具层的增长 ≠ 产品进度。

### 教训 2：截图质检要"体积分布 + md5 去重"双查
只查体积分布会漏判。#3 金融风控 51 张截图按体积看有 20+ 种大小，像是健康；
但按采集方式拆开（`dev-`/`dist-`/`file-` 三批 × 17 路由）后：
- `file-`（file:// 直开 vite dist）整批 17 张只有 11473B/11777B 两种值，md5 只 2 个 → **全空白页**，
  根因是 file:// 下静态资源路径解析不到
- `dev-` 与 `dist-` 逐张字节相同 → **同一内容重复采集 3 遍**，51 张真正有效只有 17 张

**规则**：截图核查三步 ——
1. `stat -f "%z %N"` 看体积分布（只出现 1~2 种数值 = 废片）
2. `md5` 去重（同 hash 多张 = 重复采集）
3. 按文件名前缀/来源分桶（同一页面被多种方式截，会稀释问题信号）
历史同类事故：上一批"截图全是 48.3KB 登录页"。**认证注入失效 → 统一体积的空白/登录页**是稳定特征。

### 教训 3：run 的"1 条消息 + 长 running"不等于卡死
TL 的 run 长时间只显示 1 条消息（委派 prompt），容易误判为卡住。真实信号看
`runs/<runId>/pending.json` 的 mtime —— 它在长轮次内随 LLM 流式输出持续更新。
但注意：**pending 陈旧也不能判停滞**（TD6 pending 79 分钟未更新，而磁盘写入 <1 分钟）——
TL 派完活在同步等子任务回报时不产生 token。判"停滞"必须 pending 陈旧 **且** 磁盘无写入 **且** 相关开发全 idle。

### 教训 4：软著项目磁盘路径口径（本环境）
- 私有项目在 `users/<uid>/agents/<TL>/workspace/<project>/`，
  **不是** `agents/<TL>/workspace/`（后者为空，据此判"没产出"是误报）
- TL 工作区里会混着**上一批项目的目录**（如 `legal-search-system-3`、`opc-contract-system`）
  和它们的 `软著说明书.md`/`源代码文档.md` —— 判交付前必须确认文件在**本项目目录内**
- 个别项目（#7）落在团队共享目录 `teams/<teamId>/workspace/`，两处都要查
