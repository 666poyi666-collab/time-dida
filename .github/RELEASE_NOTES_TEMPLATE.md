# FocusLink v0.12.17

> 发布日期：2026-07-20
>
> 对应源码：`5743a77`
>
> 发布类型：本地候选版（GitHub 暂缓）
>
> 验证状态：已通过本地门禁

## 本次更新

- 安装器改用 NSIS `nsProcess` 精确关闭 FocusLink：先优雅退出并等待持久化，托盘模式未退出时再强制结束，最后复查文件占用。
- 移除旧关闭脚本与 Electron Builder 默认运行检查之间的竞态；正常从 0.12.15/0.12.16 升级时不再反复弹出“FocusLink 无法关闭”。
- Windows、Web/PWA 与 Android 统一升级到 0.12.17；Android `versionCode` 为 1217。
- 完整继承 0.12.16 的跨设备实时专注、统一 F/L 图标、时间织带、小窗和多端构建身份。

## 升级提示

- SQLite 账本、用户设置和跨设备连接配置无需迁移。
- 安装器会自动关闭旧版后台进程；正在进行的专注会先由既有崩溃恢复/持久化链路保存。
- GitHub 推送、tag 与 GitHub Release 按用户要求暂缓。

## 已知限制

- `FocusLink/cloud/` 仍是 loopback-first 测试后端，不应公开部署。
- 滴答清单与番茄 To-do 的真实投递仍只由桌面端执行。

## 验证

- format、TypeScript、ESLint、单元测试、build 与 dist。
- 隔离启动旧版 `FocusLink.exe` 后，新 NSIS 链路约 4 秒内自动结束全部旧进程，退出码 0，且未触碰卸载注册项。
- Electron 主窗与小窗完整 smoke；便携版回读 `0.12.17 / 5743a77`。
- 华为与小米各通过 3/3 instrumentation，并安装回读 `0.12.17 / versionCode 1217`。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.17-x64.exe` | `F1EC5531EFCCD58CCF880569230272582037DF5E14EF125691EA0A6E3644DE63` |
| `FocusLink-0.12.17-x64-portable.exe` | `703DE31D304B2E9BFD82F053A4424256AA16941E52631F839883AA8203B61458` |

同时提供 `SHA256SUMS.txt`。
