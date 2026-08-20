# Cloud MCP migration

本目录于 2026-08-20 从 `666poyi666-collab/foxlink-cloud-mcp` 迁入。旧仓库在兼容观察期内保留，只作为迁移来源，不再作为产品身份。

迁入时排除了 `.poyi/`、`build/` 和临时数据库。云端运行资源、D1 标识、OAuth audience 和 Worker 名称保持不变。

协议实现已升级到 Cloudflare Agents 0.20 的 `createMcpHandler` 和 `@modelcontextprotocol/server` 2.0；MCP 会话 Durable Object 已通过 v3 删除迁移移除，业务 `FocuslinkFeedSync` Durable Object 保留。
