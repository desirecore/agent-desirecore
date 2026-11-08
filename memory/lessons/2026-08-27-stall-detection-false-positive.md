---
id: mem_stall_detection_20260827
type: lesson
pinned: true
created_at: 2026-08-27T20:55:00+08:00
topics: [monitoring, stall-detection, evidence, numeric-discipline]
---

## L0

判停滞三条件须同时成立（源码+产物+run 三 mtime）；编排被 100 次上限打断 ≠ 项目停滞；数值必须出自当次跑通的输出。

## L1

### 判停滞口径（缺一不许报停滞）
1. 源码 mtime 停滞（stat 实测）
2. 构建产物 dist mtime 停滞
3. 相关成员 run 的 `pending.json` mtime 无写入

成员显示 idle 不等于停滞（交完一轮才 idle），须结合产出量变化。
"编排层被打断 + 代码在涨" = 假性健康：被打断的是编排动作（下一批没人派发），开发侧在写——
正确处置是恢复编排，不是按停滞上报。

### 数值纪律（防"半截输出+印象补全"事故）
1. 数值必须出自**当次完整跑通**的输出（exit 0、产物已更新、mtime 佐证）；禁止复述上一轮数值冒充实测
2. 消费大输出**先落盘再解析**：脚本内 `print(json) > file` 后单独一次读文件；
   禁止 `| head` / `| tail` 截管道——子进程 `BrokenPipeError` 打在 stderr，
   解析端拿到的是旧文件或不存在，极易用印象补全表格
3. 未测得的格子写"未测得"；表中有未测得格须整体标注"部分未测得"
4. 解释自身错误的机制性断言同样需要实测支撑；解释不了写"原因未查明"，
   不用听起来合理的技术叙事填空（虚构的日志文件名曾被写进长期记忆）
5. 被反驳时用数据回证；对方成立就收回判断

### 正确的巡检命令口径
```bash
find <proj>/frontend/src -name "*.ts*" | grep -v node_modules | xargs wc -l | tail -1
find <proj>/frontend/src -name "*.ts*" -exec stat -f "%Sm %N" -t "%H:%M:%S" {} \; | sort -r | head -3
stat -f "%Sm" runs/<runId>/pending.json   # run 活跃性直接证据
```
