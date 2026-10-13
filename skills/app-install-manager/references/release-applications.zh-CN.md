# 固定应用release安装与维护

appRelease/web-bundle是应用材料扩展，实际操作仍使用当前ApplicationManagement-v2解析、占用、身份和唯一安装writer。读取app-developer技能取得作者接口与分发知识；客户端版本不代替GET /api/apps/capabilities的真实app-authoring-v1握手。

来源归档SHA、release规范材料摘要、受信source物化descriptor原始字节摘要分别核验。目录release安装必须匹配精确Provider/appId和当前受审releaseDigest/获取pin，个人发布默认user-managed，不按名称自动改成目录来源。存在目录字段本身不授予安装、执行或业务数据访问。

先取得owned固定候选，按目标instance/revision CAS保存。保存失败保持旧引用；响应丢失沿原submissionId查询；未知不重复安装或启动。旧材料/current history沿已保存的原实例事实维护，目录离线/撤回不删除用户数据。新目录获取的私有源需实际认证读取，不能以缓存字节假证ACL仍有效。

静态包按release映射承载；带服务应用沿原执行owner和真实代际握手。historical observation、任意PID、端口200都不是当前直开资格。更新先核读数据格式兼容，迁移中断先观察；程序回退与数据恢复分别处理。卸载默认保留业务数据和源码，额外删除另行明确授权。

Docker 固定版本先沿 runtime/docker/enrollments/prepare 给出的实际命令，在原审批 TaskHost 中执行后按真实 terminalId 登记。容器身份必须包括真实 daemon/CID、固定 RepoDigest、挂载/端口与 StartedAt；Docker CLI 退出不是容器停止或启动成功。候选数据、正式 data root 与 preview 数据分别归属，unknown 先重读原 CID 不重复 create。原开发服务器合同仅用于 live 预览，不登记为正式 startup；升级和回退均重新取真实运行代际与当前审批。
