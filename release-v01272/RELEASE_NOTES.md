# FocusLink v0.12.72

- 发布类型：正式版
- 验证状态：构建与四端安装待完成
- 对应源码：`<SOURCE_COMMIT>`

## 主要变化

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

- format、typecheck、lint、全量 Vitest、Electron 隔离回归、Web/Cloud/跨端合同、Android unit/lint/assemble 与 emulator 18 项 instrumentation 已通过。
- Windows 主窗/mini/live fallback smoke、正式打包与四端实装结果将在最终构建后填写。

## 升级提示

- Windows 使用安装版静默覆盖安装；Android 手机、平板与手表使用同一个 `0.12.72 / 1272` APK 覆盖安装并保留应用数据。

## 已知限制

- 手机、平板和 OPPO 手表共用同一响应式 Android APK；当前仍使用与既有设备一致的调试签名。
- 移动端只控制 FocusLink 云端活动会话；滴答清单与番茄 To-do 的第三方投递仍由桌面端执行并确认。

## SHA256

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.72-x64.exe` | `<SHA256>` |
| `FocusLink-0.12.72-x64-portable.exe` | `<SHA256>` |

同时提供 `SHA256SUMS.txt`。
