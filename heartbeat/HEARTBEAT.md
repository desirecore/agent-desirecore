# 通用规则
- 通知使用中文
- 输出格式：系统健康度评分（0-100）、待处理事项列表、异常状态告警
- 无变化时不打扰用户

tasks:
  - name: system-health
    interval: 20m
    prompt: "执行命令 uptime && df -h / && ps aux --sort=-%mem | head -6，汇总结果通知用户"

  - name: pending-tasks
    interval: 20m
    prompt: "执行以下命令并汇总结果，有异常则通知用户：find ~/.desirecore/runs/ -name meta.json -mmin -60 -exec grep -l '\"status\":\"failed\"' {} \;"
