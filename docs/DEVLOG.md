# Development Log

## 2026-08-20：测试凭据门禁标记统一

- 将上游错误响应测试中的确定性假令牌改为带 `wrong-test` 标记的合法格式测试值。
- 让全局秘密扫描门禁能够区分明确测试夹具与潜在真实凭据，同时不降低生产代码检查强度。

## 2026-08-20

- 从 `foxlink-cloud-mcp` 导入云端代码到 `FocusLink/cloud/mcp`，排除旧构建数据库和嵌套项目清单。
- 将已弃用的 `McpAgent` 会话 Durable Object 升级为 `createMcpHandler` + MCP SDK Server 2.0 无状态处理器。
- 保留旧客户端的无状态兼容通道，新增 MCP 2026-07-28 `server/discover` 合同测试。
- 保留业务同步 Durable Object、D1、OAuth 和现有生产 Worker 身份。
- 完整测试 103 项通过。
- 升级 Cloudflare Vitest Pool 以移除旧 Wrangler/Miniflare/undici 安全风险，需重新执行完整测试确认兼容。
