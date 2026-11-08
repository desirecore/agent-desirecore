---
id: mem_2026-11-08-git-status-clean-not-tracked
type: lesson
pinned: false
created_at: 2026-11-08T11:05:00+08:00
topics: [git, 分发审计, 回执核验, schedules, inbox]
---

## L0
"git status 干净"≠"文件已入库"——被 .git/info/exclude 忽略的文件不显示；断言已提交必须 git ls-files 验证。

## L1
### 事件（2026-11-07→08）
我说"调度文件已被后端自动提交进 git（git status 干净）"——**错**。
实测：`agents/desirecore/schedules/` 被 `.git/info/exclude: /schedules/` 排除，
头像自动化修复文件**从未入库**。git status 干净只是"无追踪变更+无未跟踪提示"
（被 ignore 的文件两样都不显示）。照现状推送，GitHub 仓库里根本没有修复。

### 规则
1. 断言"某文件已提交/已入库"前，必须 `git ls-files --error-unmatch <file>` 或
   `git ls-files <dir>` 验证——status 干净、文件在目录里，都不证明它在库里。
2. **分发审计双查**（推送/打包/交付前逐项核）：
   - 要发的文件必须在 `git ls-tree` 里命中（本例 schedules 修复缺席）
   - 不该发的文件必须不在（本例 inbox/ 42 个收件箱被 auto-commit 入库，含
     用户 UUID 路径与项目名，公开仓库必须剔除）
3. 平台运行时目录可能被 `.git/info/exclude` 本地排除（如 /schedules/）——
   需要随仓库分发的资产要 `git add -f` 显式入库，并回读 git ls-tree 验证。
4. 同族教训再加一条：回报说了≠磁盘有了；**status 干净≠已入库**。
