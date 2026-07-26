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
- Windows：`PoyiFoxlinkMcp` 已安装为 Automatic delayed start 的原生 pywin32 服务；管理员安装后
  SCM 状态为 `Running`，`/healthz` 返回 `alive`，`/readyz` 回读 FocusLink `0.12.60`。服务线程
  固定使用 `SelectorEventLoop`，并禁止 Uvicorn 在工作线程安装进程信号处理器。
- Tunnel：`FoxlinkSecureMcpTunnel` 独立运行，`/readyz` 通过；专属 Tunnel ID 为
  `tunnel_6a656760fdf48191bf15b213f127e3c0`。doctor 除本地 OAuth 元数据（Tunnel 托管认证时
  不适用）外全部通过；PersonalMcpGateway、Journal 和其他项目不参与 Foxlink 请求路径。
- ChatGPT 私有连接：2026-07-26 在 ChatGPT Plus 网页 Developer Mode 创建并连接 Foxlink，应用
  ID 为 `asdk_app_6a6585f2d3a881918a6a2781a3d124a4`，使用 `通道 + 未授权`，不进行开发者
  身份验证或公开 App 发布。真实只读调用返回版本 `0.12.60`、revision `22`、状态 `paused`。
- ChatGPT 写入：`foxlink_resume_focus` 将 revision `22 -> 23`、状态改为 `running`，随后
  `foxlink_pause_focus` 将 revision `23 -> 24`、状态恢复为 `paused`。逐字复用第二次调用的
  `requestId/commandId/expectedRevision` 后仍返回 revision `24 / paused`，证明服务端重放原结果，
  没有重复执行。
- Python 制品：`mcp/dist/foxlink_mcp-0.1.0-py3-none-any.whl` 的 SHA256 为
  `74CB66BA84958466C877733056B6453C71488ECE61D51DB08570340962DB296E`；源码包 SHA256 为
  `BB3C0DBCF9928597E47F4815B1CF1CBA0E2C335F5975C6B468E0ECBA6A5D6AE1`。
