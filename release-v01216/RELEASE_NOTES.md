# FocusLink v0.12.16

> 发布日期：2026-07-20
>
> 对应源码：安装包、便携版、Web 与 Android 均内嵌并显示同一干净 `APP_COMMIT`
>
> 发布类型：本地候选版（GitHub 暂缓）
>
> 验证状态：已通过本地多端验收

## 本次更新

### 多端版本身份统一

- PC、Web/PWA 与 Android 统一升级到 0.12.16，避免两套不同内容继续共用 0.12.15。
- Android `versionCode` 升级为 1216；移动端标题区直接显示语义版本和源码提交，能够当场判断是否仍在运行旧包。
- Windows 安装版与便携版从同一干净源码提交重新生成，不再携带 `-dirty` 构建标识。

### 全平台图标单一来源

- 桌面应用、主界面品牌标、托盘、PWA、Android launcher 与前台通知统一使用 `F / L` 双织带字标。
- 图标脚本同时生成桌面 ICO/PNG、PWA 192/512 和 Android legacy launcher，避免桌面已经换新而手机仍显示旧圆环或默认 Android 图标。
- Android adaptive icon 使用同一矢量前景；托盘继续根据系统明暗和专注/暂停状态切换前景与状态色。

### PC、Web 与 Android 实时专注

- 完整保留账号唯一实时会话、revision、幂等命令、开始/暂停/继续/结束和完整 Session/Segment/Pause 账本原子收敛。
- PC 主窗、小窗、托盘和全局快捷键统一控制同一会话；断线时不冒充云端确认。
- Web/PWA 与 Android 共用响应式控制台、离线缓存和完成账本；滴答清单与番茄 To-do 仍只由桌面端真实投递并确认。

## 修复

- 修复复用 0.12.15 导致 Windows、PWA、Android 无法明确区分新旧包的问题。
- 修复 Web/PWA、Android 仍使用旧圆环、柱状品牌标和默认 Android launcher 的视觉版本断层。
- 保留当前时间织带、小窗、计时仪表和全局强调色，不回退到跨设备开发开始前的旧界面。

## 升级提示

- SQLite 账本与现有设置无需迁移。
- 0.12.15 可直接升级到 0.12.16；Android 通过 `versionCode=1216` 覆盖安装。
- “PC 参与实时专注”仍默认关闭，需显式配置本机测试服务地址与访问令牌。

## 已知限制

- `FocusLink/cloud/` 仍是 loopback-first 自托管测试后端，不具备生产账号、备份、监控和多实例能力，不应公开部署。
- 测试服务上的实时会话进行中不能修改任务关联。
- GitHub 推送、tag 与 GitHub Release 按用户要求暂缓。

## 验证

- format、TypeScript、ESLint、45 个测试文件 / 352 项测试。
- Web/PWA 与 Cloud 生产构建。
- 浏览器真实闭环：连接、开始、暂停、继续、结束，revision 0→4，结束账本自动收敛。
- 360×800 响应式验收：无横向溢出，主操作高度 48px。
- Android sync、unit、lint、assemble；真机版本、安装和 instrumentation 在最终 APK 生成后回读。
- Electron 主窗、小窗、安装版与便携版在最终产物生成后回读。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.16-x64.exe` | 最终构建后填写 |
| `FocusLink-0.12.16-x64-portable.exe` | 最终构建后填写 |

同时提供 `SHA256SUMS.txt`。
