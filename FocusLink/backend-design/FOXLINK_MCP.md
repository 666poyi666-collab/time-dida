# Foxlink 独立 MCP

## 边界

```text
ChatGPT -> foxlink-tunnel -> 127.0.0.1:8770/mcp
        -> Foxlink API 127.0.0.1:18770 -> Electron 业务服务 -> focuslink.db
```

Foxlink 不向 PersonalMcpGateway 注册工具。MCP 进程只调用 Electron 回环 API，不直接打开
SQLite；计时状态转换和账本读取仍由 Electron 主进程负责。

FocusLink 的公网 `foxlink-cloud-mcp` 是另一条明确隔离的 Cloudflare MCP 入口：它通过专属
service binding 调用同一 Account DO 的 `task_state`，不使用本地 Foxlink 服务或 D1 另存任务。
该入口提供 `focuslink_list_projects`、`focuslink_list_tasks`、`focuslink_get_task` 以及清单/任务
创建、更新、完成、恢复、删除、移动工具。每次写入都需要 `operationId` + `expectedRevision`，
Account DO 以同一事务执行 CAS 与幂等重放；清单删除只把任务迁入收件箱，任务删除才永久删除
子树，响应只返回 revision、稳定 ID 和计数等脱敏确认。MCP 2026-07-28 discovery 保持不变，
写工具需要 `focuslink:read focuslink:write`。

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

Tunnel 的 `%ProgramData%\Poyi\FoxlinkMcp` 数据树必须显式保留 `SYSTEM` 与本机管理员完全控制，
桌面安装用户只读。该 ACL 同时保护 DPAPI 密文，并允许 LocalSystem 托管的 WinSW 在重启后继续
滚动 stdout/stderr。若外部工具改写了文件级 ACL，使用提升权限的
`mcp/tunnel/repair-acl.ps1` 原地修复并复验 8878；该操作不轮换 Runtime Key、不更换 Tunnel ID。

## 验收状态

- MCP SDK：initialize、tools/list、Resource 读取和 4 个控制写入均已通过；重复 `commandId` / 
  `requestId` 返回持久化结果且只生成一条 Session。
- Windows：`PoyiFoxlinkMcp` 已安装为 Automatic delayed start 的原生 pywin32 服务；管理员安装后
  SCM 状态为 `Running`，`/healthz` 返回 `alive`，v0.12.61 正式安装包启动后 `/readyz` 回读
  FocusLink `0.12.61`。服务线程
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
- 正式包复验：Windows v0.12.61 覆盖安装后，ChatGPT 再次经专属 Tunnel 调用两个只读工具，
  返回版本 `0.12.61`、revision `28`、状态 `idle`，证明调用链不再依赖开发态业务进程。
- 服务重启复验：独立 MCP/Tunnel 停止后 8770/8878 均消失且 PersonalMcpGateway 保持运行；
  ACL 修复后 SCM 进程树为 WinSW → PowerShell → tunnel-client，8878 监听归属该子进程，持续观察
  服务仍为 `Running`，doctor 通过且修复后没有新的 WinSW 崩溃事件。
- Python 制品：`mcp/dist/foxlink_mcp-0.1.0-py3-none-any.whl` 的 SHA256 为
  `74CB66BA84958466C877733056B6453C71488ECE61D51DB08570340962DB296E`；源码包 SHA256 为
  `BB3C0DBCF9928597E47F4815B1CF1CBA0E2C335F5975C6B468E0ECBA6A5D6AE1`。
