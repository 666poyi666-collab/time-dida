# FocusLink v0.12.25

> 发布日期：2026-07-22
>
> 对应源码：`9b0c764`
>
> 发布类型：本地迭代包
>
> 验证状态：设备与本地包已通过；正式发布未执行

## 前端体验

- 桌面专注时间之带使用完整、连续但非实心的绿色粒子材料；暂停段保留完整红色残迹并持续剥离、漂移和消散。
- 手机、平板与 Web 控制台保留真实专注段和暂停段，使用与桌面一致的时间语义和响应式粒子时间带。
- 实时控制与已结束账本分别显示状态；Android 回环地址给出 ADB reverse 诊断，局域网或异地连接要求 HTTPS。
- 手机和平板共用同一 Android APK，并分别通过网络 ADB 覆盖安装与版本核验。

## 验证

- format、TypeScript、ESLint、60 个测试文件 426 项测试、Electron 回归及打包已通过。
- Web/PWA、Cloud、Android 单元/Lint/构建及隔离容器集成已通过。
- 华为平板与小米手机均通过网络 ADB 覆盖安装，读回 `0.12.25 / versionCode 1225`；真机通用 instrumentation 通过，需临时云参数的三项用例按设计跳过。
- Windows 便携版主窗、小窗和本机离线回落 smoke 已通过；遵照用户要求未代装桌面安装版。
- 安装版和便携版 SHA256 与 `SHA256SUMS.txt` 一致。

## 升级提示

- Windows 端关闭正在运行的 FocusLink 后运行安装版；本轮不会代替用户安装电脑端。
- Android 端可直接覆盖旧版并保留应用数据；使用电脑本机同步服务时，每台网络 ADB 设备都需要独立建立 `tcp:18787` reverse。

## 已知限制

- 手机与平板共用同一响应式 Android APK；当前交付包使用与既有设备一致的调试签名，尚未配置独立的 Android release signing。
- 内置同步服务只监听电脑回环地址；ADB reverse 适合本地调试与个人设备，跨网络使用仍需要 HTTPS 个人云。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.25-x64.exe` | `2e8a2857e49279e2dc7c277e6a54dc8cd8d2e4ec8c7c05c5ac8139f811c54d37` |
| `FocusLink-0.12.25-x64-portable.exe` | `dff08c5425d1e9a2c8f4a836e25c102c66e2b3824b00f77d1a52ac43d4891e1e` |

同时提供 `SHA256SUMS.txt`。
