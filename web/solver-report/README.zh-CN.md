# 求解器验证书 Web

这里版本化管理“求解器智能体团队验证书”的 Web 源码与构建工具。

本目录负责 Web 应用、交互行为、构建契约、静态验证器和部署验证脚本。场景包、运行回执和原始截图继续作为外部构建输入，避免让 DesireCore 核心 Agent 的 bootstrap 体积增加数百 MB。

## 图片查看器

截图预览支持：

- 适应窗口与 1:1 原始像素模式；
- 有上下限的缩放按钮，以及 `+` / `-` / `0` / `1` 键盘快捷键（移动端也能达到截图的 1:1 原始像素）；
- `Ctrl`/`Command` + 滚轮或触控板捏合，以指针位置为中心缩放；
- 双击缩放、鼠标/单指拖动平移；
- 双指触控捏合缩放；
- 原图下载入口和可访问的实时缩放状态。

每次打开新图片都从“适应窗口”开始；关闭后重新打开不会保留旧的缩放或平移状态。

## 人 + Agent 场景决策树

每个场景都会从 Scenario Pack、真实 Run 和独立验证回执派生一棵结构化决策树，展示：

- 人类确认业务事实、硬规则和目标优先级；
- Agent 补问、建模以及调用兼容引擎求解或诊断；
- 独立验证者重新检查变量域、约束、目标和证据；
- 信息不足、规则未映射或校核失败时的 fail-closed 阻断分支；
- 实际运行最终到达的交付、冲突诊断、拒绝或恢复结果。

树数据遵循 [`decision-tree.schema.json`](./decision-tree.schema.json)，并绑定 Scenario Pack、消息、session、工具回执、结果 payload、OptimizationSpec 和验证报告哈希。实际路径只由已接受 Run 中的 settled summary 与受治理回执决定，oracle 仅用于发现预期不一致；求解、仅验证和恢复场景使用不同拓扑，不为未发生的建模或求解步骤造假。页面可切换“完整分支/实际路径”，也可下载当前场景的 SVG 快照；视图代码只负责通用渲染，不包含具体场景业务树。

## 构建

构建输入目录需要包含 `scenario-packs/`、`evidence/`，产物默认写到 `report-web/dist/`。Markdown、公式和图片处理依赖从 DesireCore 应用 checkout 解析。

公网构建还必须提供 `evidence/public-release-attestation.json`。它按 [Draft-07 Schema](./public-release-attestation.schema.json) 绑定全部公开消息与 174 张截图的内容根哈希，并明确记录审查方法、证据归属和公开发布结论。消息或截图发生任何变化，旧证明都会失效，构建直接失败。

站点只消费 `evidence/screenshots/public-screenshot-plan.json`。该派生计划通过每张图的 `sourceSha256` 将公开脱敏图绑定到不可变原始证据；含本地路径的原始截图绝不能直接作为公网原图。

```bash
export SOLVER_REPORT_INPUT_ROOT=/absolute/path/to/scenario-book
export DESIRECORE_APP_ROOT=/absolute/path/to/desirecore
node scripts/build-report-web.mjs
node scripts/validate-report-web.mjs
```

可选环境变量：

- `SOLVER_REPORT_OUTPUT_ROOT`：覆盖生成路径；为避免递归清理误伤，它必须位于 `<SOLVER_REPORT_INPUT_ROOT>/report-web/` 的子目录内，且不得与 Agent 源码或 DesireCore 应用目录重叠。
- `LATEST_PLATFORM_REGRESSION_FILE`：覆盖最新回归摘要路径。
- `SOLVER_REPORT_PUBLIC_RELEASE_ATTESTATION_FILE`：覆盖公开发布证明路径。
- `SOLVER_REPORT_VALIDATION_FILE`：覆盖静态验证结果路径。
- `REPORT_BASE_URL`：`validate-deployed-report.mjs` 使用的公网地址。
- `SOLVER_REPORT_DEPLOYMENT_VALIDATION_FILE`：覆盖部署验证结果路径。

源码契约测试：`node --test tests/*.test.mjs`。

签署公开发布证明前，必须以可读分辨率逐张检查全部原始截图。联系表只用于核对场景 ID、截图哈希和覆盖范围，不能替代小字凭据审查。在 macOS 上还要运行原图级 Apple Vision OCR 门禁，作为第二条独立检查路径：

```bash
export SOLVER_REPORT_SCREENSHOT_OCR_FILE=/private/tmp/solver-report-ocr.json
export SOLVER_REPORT_SCREENSHOT_OCR_VALIDATION_FILE=/private/tmp/solver-report-ocr-validation.json
npm run privacy:ocr
```

验证器要求 174 张计划内原图按顺序全部出现，重新计算每张源图哈希，并对识别文字复用 fail-closed 敏感信息策略。OCR 与全分辨率人工视觉审查必须同时通过后，才能更新公开发布证明；审查产物不会进入站点或 Agent bootstrap。

## 部署边界

构建器只允许公开 provenance 白名单字段，并会拒绝本机路径、邮箱、私有 URL、常见密钥和具名凭据。部署验证同时要求 `build.json#gates.publicReleasePrivacy=pass` 且证明哈希与 manifest 一致。

每次生成新的不可变 release，切换前逐项验证 `integrity.json`，然后原子更新服务端 `current` 软链接。禁止覆盖既有 release，也禁止把历史证据重新标记为新版平台产物。
