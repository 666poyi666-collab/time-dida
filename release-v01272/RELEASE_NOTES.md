# FocusLink v0.12.72

- 发布类型：正式版
- 验证状态：本地候选构建、smoke 与四端同版安装完成；公网新设备登录网关待独立部署
- 对应源码：`cf779db`

## 主要变化

- Windows、手机和平板改为登录同一个 FocusLink 账号后自动同步；普通界面不再显示服务地址、访问令牌、配对码或“编辑连接”。旧设备凭据会自动识别为已登录。
- OPPO 手表只显示“从手机登录”，由云端为手表签发独立设备身份，不复制手机凭据。
- Windows 实时命令、任务快照与 Sync v2 统一使用 `fl2` 凭据绑定的设备 ID，修复“开始专注”返回 HTTP 403。
- 空闲云端凭据失效或网络失败时，本地计时仍可立即开始；活动云端会话保持权威锁定，失败原因写入结构化日志。
- 设置页九种计时仪表全部适配固定预览舞台，指针表圈、游标标尺与制图描线完整显示；UI smoke 逐卡检查真实边界。
- 桌面时间之带在运行、暂停和结束展示中统一使用平直磨砂玻璃，旧毛虫状锯齿、浮尘和分节绘制路径已删除。
- 继承手机与平板“工业时间仪器”界面：手机主读数/任务/时间之带/粘底操作首屏化，华为平板 640 CSS-pixel 竖屏保持全宽计时主区。

## 保留能力

- Windows mini 仍只有 `184×44 / 256×70` 两态。
- 华为 `huawei-live-capsule`、小米系统通知路径和 OPPO 手表 renderer 保持。
- 云端实时控制、离线本机会话、任务快照与已结束账本协议保持同一 authority。

## 验证摘要

- format、typecheck、lint、93 个 Vitest 文件/605 项、Electron 隔离回归、Web/Cloud/38 项跨端合同、Android unit/lint/assemble 与 emulator instrumentation（26 项完成、8 skipped、0 failed）已通过。
- 干净提交 `cf779db` 的 Windows 主窗、两态 mini 与 live fallback smoke 通过；Windows、小米、华为和 OPPO 手表均实装并回读 `0.12.72/1272`。

## 升级提示

- Windows 使用安装版静默覆盖安装；Android 手机、平板与手表使用同一个 `0.12.72 / 1272` APK 覆盖安装并保留应用数据。

## 已知限制

- 手机、平板和 OPPO 手表共用同一响应式 Android APK；当前仍使用与既有设备一致的调试签名。
- 移动端只控制 FocusLink 云端活动会话；滴答清单与番茄 To-do 的第三方投递仍由桌面端执行并确认。
- 新设备“登录即同步”还需要 canonical `foxlink-cloud-mcp` 公网 bootstrap 与独立 identity secret 上线；本地候选没有部署外部仓或读取远端 secret。OPPO 手表的“从手机登录”还需要 companion 授权通道，当前只验收了 UI 与轮询状态机。
- Android APK 备份位于 `.tmp/android-apk-backups/FocusLink-0.12.72-1272-debug.apk`，SHA-256 为 `A269F37761B0070661836B00112CD270B79222F00C802CC61688357F7B5D91CC`。

## SHA256

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.72-x64.exe` | `4C3A681A0DB9F47DE2579AD26C9020680CBC8D610642AAA725F111FB7C3B178F` |
| `FocusLink-0.12.72-x64-portable.exe` | `1B9C7423143D29FB310AB6C42C8DB63187DC33E9383085BAF80E2AFF257184E0` |

同时提供 `SHA256SUMS.txt`。
