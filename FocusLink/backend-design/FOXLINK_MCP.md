# Foxlink 独立 MCP

## 边界

```text
ChatGPT -> foxlink-tunnel -> 127.0.0.1:8770/mcp
        -> Foxlink API 127.0.0.1:18770 -> Electron 业务服务 -> focuslink.db
```

Foxlink 不向 PersonalMcpGateway 注册工具。MCP 进程只调用 Electron 回环 API，不直接打开
SQLite；计时状态转换和账本读取仍由 Electron 主进程负责。

## 契约

- MCP：`127.0.0.1:8770/mcp`；健康、就绪、指标为 `/healthz`、`/readyz`、`/metrics`。
- 业务 API：`127.0.0.1:18770/v1`；发现端点为 `/v1/health`、`/v1/status`、
  `/v1/capabilities`。
- 工具：`foxlink_get_status`、`foxlink_get_current_session`、`foxlink_list_sessions`、
  `foxlink_get_session`、`foxlink_get_today_summary`、`foxlink_start_focus`、
  `foxlink_pause_focus`、`foxlink_resume_focus`、`foxlink_stop_focus`。
- Resources：`foxlink://sessions/recent`、`foxlink://sessions/{session_id}`、
  `foxlink://analytics/today`、`foxlink://capabilities`。

业务 API 使用 `%ProgramData%\Poyi\FoxlinkMcp\business-api-token` 中的独立随机 bearer
token；安装时生成，受 NTFS ACL 保护，不进入 Git 和日志。

所有控制写入都要求 `requestId`、`commandId`、`expectedRevision`、`expectedState` 和
`expiresAt`。成功响应持久保存到 `foxlink_api_idempotency`；进程重启后相同 ID 重放原响应，
不同载荷复用、旧 revision、错误状态和过期命令返回稳定冲突码。

## 服务

- `PoyiFoxlinkMcp`：原生 pywin32 Windows Service，Automatic delayed start，端口 8770；
  SCM 直接拥有 Python 服务进程，停止服务后不会遗留监听进程。
- `FoxlinkSecureMcpTunnel`：Automatic delayed start，仅依赖 `PoyiFoxlinkMcp`，健康端口 8878。

Tunnel 使用 Foxlink 独立服务账号 Runtime Key，DPAPI LocalMachine 加密。运行时不依赖
PersonalMcpGateway；安装阶段只复用已验证的 tunnel-client、私有 Python 部署模板和服务 ACL。
Foxlink 本地 MCP 不发行 OAuth token；公网侧身份校验由专属 Secure MCP Tunnel 承担，因此本地
`/.well-known/oauth-protected-resource/mcp` 不建立虚假 issuer 契约。

## 验收状态

- MCP SDK：initialize、tools/list、Resource 读取和 4 个控制写入均已通过；重复 `commandId` / 
  `requestId` 返回持久化结果且只生成一条 Session。
- Tunnel：`FoxlinkSecureMcpTunnel` 独立运行，`/readyz` 通过；doctor 除本地 OAuth 元数据
  （Tunnel 托管认证时不适用）外全部通过。
- ChatGPT 应用：平台资源已创建到独立 Tunnel；应用创建受 OpenAI 开发者身份验证门禁阻塞，
  身份验证完成前不得标记真实 ChatGPT 调用通过。
