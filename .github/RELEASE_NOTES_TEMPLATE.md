# FocusLink v0.12.42

> 发布日期：2026-07-24
>
> 对应源码：`<SOURCE_COMMIT>`
>
> 发布类型：正式版
>
> 验证状态：已通过

## 前端体验

- 桌面专注时间之带使用完整、连续但非实心的绿色粒子材料；暂停段保留完整红色残迹并持续剥离、漂移和消散。
- 手机、平板与 Web 控制台保留真实专注段和暂停段，使用与桌面一致的时间语义和响应式粒子时间带。
- 实时控制与已结束账本分别显示状态；Android 回环地址给出 ADB reverse 诊断，局域网或异地连接要求 HTTPS。
- Windows、华为平板和小米手机安装同一 `0.12.42` 版本并分别回读核验。
- Android 晚连接、断开重连或桌面同步令牌轮换后，Windows 自动恢复 reverse 并为每台设备独立补配对；重复探测不会反复拉起应用。
- Android 系统表面按设备选择小米焦点通知、华为/荣耀 EMUI 计时胶囊、Android 16 promoted ongoing 或标准常驻通知。
- Dashboard 热力日期下钻会统一切换全部分析指标；沉浸模式只保留一套计时仪表和时间之带动画实例。

## 验证

- format、TypeScript、ESLint、全量测试与 Electron 打包已通过。
- 安装版和便携版 SHA256 与 `SHA256SUMS.txt` 一致。
- 主窗口和迷你窗口 smoke 验证五套仪表、时间之带、Dashboard、沉浸单实例与 reduced-motion 降级。

## 升级提示

- Windows 覆盖安装会先有界关闭当前用户的 FocusLink 后台实例；不再要求手动点“重试”。
- Android 端可直接覆盖旧版并保留应用数据；使用电脑本机同步服务时，每台网络 ADB 设备都需要独立建立 `tcp:18787` reverse。
- 旧 Android 默认连接 `http://127.0.0.1:8787` 会在 WebView 与原生后台连接两侧迁移到 `18787`；WebView 被系统回收不会自动删除仍用于活动通知的原生密文。

## 已知限制

- 手机与平板共用同一响应式 Android APK；当前交付包使用与既有设备一致的调试签名，尚未配置独立的 Android release signing。
- 内置同步服务只监听电脑回环地址；ADB reverse 适合本地调试与个人设备，跨网络使用仍需要 HTTPS 个人云。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.42-x64.exe` | `<SHA256>` |
| `FocusLink-0.12.42-x64-portable.exe` | `<SHA256>` |

同时提供 `SHA256SUMS.txt`。
