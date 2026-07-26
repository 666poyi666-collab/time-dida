# FocusLink v0.12.61

> 发布日期：2026-07-26
>
> 发布类型：本地中间版本
>
> 验证状态：Foxlink 独立 MCP 打包与三端版本门禁通过

## 本版内容

- Foxlink MCP 以独立 `PoyiFoxlinkMcp` Windows 服务监听 `127.0.0.1:8770/mcp`。
- `FoxlinkSecureMcpTunnel` 使用专属 Tunnel，运行时不依赖 PersonalMcpGateway。
- Tunnel 安装器会固化 LocalSystem/管理员/桌面用户 ACL；`repair-acl.ps1` 可在不更换 Tunnel ID 或 Runtime Key 的情况下清理孤儿进程并修复 WinSW 日志权限。
- Windows 正式安装包现在包含 Foxlink 业务 API，FocusLink 启动后在 `127.0.0.1:18770` 提供版本化接口；MCP 不直接读取 SQLite。
- ChatGPT 网页 Developer Mode 私有 Foxlink 应用已完成真实只读、恢复、暂停和幂等结果重放调用。
- Windows、小米和华为统一回读 `0.12.61 / 1261`；移动端业务逻辑相对 0.12.60 不变。

## 验证

- Prettier、TypeScript、Cloudflare TypeScript、ESLint、生产构建通过。
- Vitest：72 个文件、488 项测试全部通过。
- Python MCP：Ruff、Pyright、pytest 4 项和 wheel/sdist 构建通过。
- Windows：覆盖安装后 `FocusLink.exe` 回读 `0.12.61.0`；正式进程监听 18770，MCP `/readyz` 回读 Foxlink `0.12.61`，Tunnel `/readyz` 为 ready。
- Windows 服务隔离复验：停止 Foxlink MCP/Tunnel 后 8770/8878 均消失且 PersonalMcpGateway 保持运行；修复 ACL 后 SCM 服务持续 `Running`，进程树和 8878 监听一致，doctor 通过且修复后崩溃数为 0。
- 小米 `22041216C`：网络 ADB 覆盖安装成功，回读 `versionName=0.12.61 / versionCode=1261`。
- 华为 `DBY-W09`：网络 ADB 覆盖安装成功，当前包回读 `versionName=0.12.61 / versionCode=1261`。

## ChatGPT 私有调用

- 只读调用返回服务版本 `0.12.60`、revision `22`、状态 `paused`。
- 恢复后返回 `revision 23 / running`，暂停后返回 `revision 24 / paused`。
- 逐字复用 pause 的 `requestId`、`commandId` 和旧 `expectedRevision` 后仍返回 `revision 24 / paused`，没有再次执行。
- v0.12.61 正式 Windows 进程启动后再次只读调用，返回 `0.12.61 / revision 28 / idle`，证明不依赖开发态进程。
- 本版不进行 OpenAI 开发者身份验证，不走公开 App 发布流程。

## 已知外部限制

- 小米超级岛仍受 OEM Focus 签名/白名单拒绝；标准常驻通知与 Foxlink 悬浮条保持可用。
- 厂商推送凭据与 Cloudflare R2 账户能力仍按 0.12.60 的外部依赖状态记录。

## 本地交付规则

- 本版不推送 `main`，不创建 tag 或 GitHub Release。
- `SHA256SUMS.txt` 是本目录制品校验的唯一来源。
