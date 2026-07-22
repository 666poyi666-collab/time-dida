# FocusLink v0.12.26

> 发布日期：2026-07-22
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
- 手机和平板共用同一 Android APK，并分别通过网络 ADB 覆盖安装与版本核验。

## 验证

- format、TypeScript、ESLint、全量测试与 Electron 打包已通过。
- 安装版和便携版 SHA256 与 `SHA256SUMS.txt` 一致。

## 升级提示

- Windows 端关闭正在运行的 FocusLink 后运行安装版。
- Android 端可直接覆盖旧版并保留应用数据；使用电脑本机同步服务时，每台网络 ADB 设备都需要独立建立 `tcp:18787` reverse。

## 已知限制

- 手机与平板共用同一响应式 Android APK；当前交付包使用与既有设备一致的调试签名，尚未配置独立的 Android release signing。
- 内置同步服务只监听电脑回环地址；ADB reverse 适合本地调试与个人设备，跨网络使用仍需要 HTTPS 个人云。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.26-x64.exe` | `<SHA256>` |
| `FocusLink-0.12.26-x64-portable.exe` | `<SHA256>` |

同时提供 `SHA256SUMS.txt`。
