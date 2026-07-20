# FocusLink v0.12.18

> 发布日期：2026-07-20
>
> 对应源码：`6d5f10e`
>
> 发布类型：本地候选版（GitHub 暂缓）
>
> 验证状态：已通过本地门禁

## 本次更新

- 撤销 0.12.17 基于 `nsProcess` 的全局进程扫描，避免其他 Windows 账户、Codex 或 CI 的 FocusLink 测试进程阻塞当前用户安装。
- 安装器不再枚举全机同名进程，只关闭当前 Windows 用户的 FocusLink 安装版与便携版内层进程；其他账户不再触发误判。
- 兼容 0.12.17 旧卸载器：升级期间仅在安装器进程树内临时绕过旧版全局扫描，安装结束后不留下环境变量。
- 隔离安装 smoke 仍可通过仅限父进程继承的 `FOCUSLINK_INSTALLER_SKIP_CLOSE=1` 绕过运行检查，不会写入系统环境。
- 新增安装策略回归测试，禁止再次引入 `nsProcess` / `tasklist` 全局扫描、无用户名过滤的终止命令、`customInit` 或预安装强杀钩子。
- Windows、Web/PWA 与 Android 统一升级到 0.12.18；Android `versionCode` 为 1218。

## 升级提示

- SQLite 账本、用户设置和跨设备连接配置无需迁移。
- 安装器只会处理当前 Windows 用户启动的 FocusLink；其他账户和隔离测试会话不再影响安装。
- GitHub 推送、tag 与 GitHub Release 按用户要求暂缓。

## 已知限制

- `FocusLink/cloud/` 仍是 loopback-first 测试后端，不应公开部署。
- 滴答清单与番茄 To-do 的真实投递仍只由桌面端执行。

## 验证

- format、TypeScript、ESLint、46 个测试文件共 354 项测试、audit 0 漏洞、build、dist 与 Electron 回归全部通过。
- 真实执行“安装 0.12.17 → 启动旧版 4 个进程 → 运行 0.12.18 覆盖安装”：两次安装退出码均为 0，旧进程归零，注册版本更新为 0.12.18。
- 安装版、解包版和便携版均回读 `0.12.18 / 6d5f10e`，主工作台结构与暂停色令牌正确。
- Android unit/lint/assemble 通过；华为 Android 12 与小米 Android 15 各通过 3/3 instrumentation，并安装回读 `0.12.18 / versionCode 1218`。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.18-x64.exe` | `50BC011D8432F471140E016A80D2823B8A4C160654F16E61433C2F8DD3743677` |
| `FocusLink-0.12.18-x64-portable.exe` | `63E3CD89754D1BEF93AF560A125B828E4C13BC61201BFE130202DC62A0FC7BED` |

同时提供 `SHA256SUMS.txt`。
