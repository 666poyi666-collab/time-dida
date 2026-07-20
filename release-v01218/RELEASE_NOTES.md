# FocusLink v0.12.18

> 发布日期：2026-07-20
>
> 对应源码：`SOURCE_COMMIT`
>
> 发布类型：本地候选版（GitHub 暂缓）
>
> 验证状态：构建后填写

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

- 最终构建后填写。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.18-x64.exe` | `FINAL_SHA256` |
| `FocusLink-0.12.18-x64-portable.exe` | `FINAL_SHA256` |

同时提供 `SHA256SUMS.txt`。
