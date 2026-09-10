# Security

目标：按本轮 change surface 检查新增或改变的信任边界。

至少判断：认证、资源级授权、用户/租户隔离、输入注入、路径穿越、恶意文件、异常大输入、Secrets、日志/错误泄露、新依赖、开放端口、配置权限和高风险操作审计。

- Architecture 标出信任边界和权限决策点。
- Specification 加入未认证、越权、跨租户和非法输入等负向场景。
- Implementation 验证适用的失败路径。
- Verification 记录安全测试、检查证据和剩余风险。

涉及认证、授权、Secrets、上传、外部回调或租户隔离时不能只写 N/A。
