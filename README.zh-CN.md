# DesireCore 核心智能体

本仓库仅管理 DesireCore 核心智能体定义、人格、原则和技能。[English](./README.md)。

核心智能体通过 `ui.chat_bubble_mode: "classic"` 使用气泡式对话。该配置仅作用于此智能体，平台默认及其他智能体保持不变。支持智能体级消息样式的客户端读取此可选字段；删除后恢复跟随平台偏好。

求解器验证书 Web 由 **desirecore-agent 组织**下的 [desirecore-agent/solver-report-web](https://github.com/desirecore-agent/solver-report-web) 独立管理。Web 源码、构建工具、依赖和报告证据不属于本智能体仓库或其 bootstrap 压缩包。原 Web 专属历史保留在新仓库的 `archive/web-history` 分支。
