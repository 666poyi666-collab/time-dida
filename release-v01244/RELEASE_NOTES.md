# FocusLink v0.12.44

> 发布日期：2026-07-25
>
> 对应提交：`59a71bc67dc232f2bbb90b69d0dd35753cb581d9`
>
> 发布类型：正式版
>
> 验证状态：已通过

## 前端体验

- Windows 保留 `184x44` 收起态和 `256x70` 展开态两态小窗，四边吸附后自动收起，展开时完整显示任务、三项累计与控制。
- 华为平板保留 `layout11` 胶囊覆盖层和标准通知兜底；小米手机保留超级岛投影和标准通知兜底。
- 手机、平板与 Web 控制台使用与桌面一致的实时状态、任务快照和已结束账本。

## 同步改进

- Windows 使用单一串行协调流程维护每台在线 Android 设备的 `tcp:18787` reverse。
- Android 晚连接、断开重连、电脑恢复或同步令牌轮换后，会为每台设备独立补发一次性配对并立即同步。
- 同一设备和凭据代次只自动配对一次；单台设备失败不会阻断另一台，也不会在日志中记录令牌或 nonce。
- Android 保存凭据并连接后主动拉取权威实时状态、任务快照和已结束账本。
- 桌面 idle 回退测试等待已确认的 live 状态，不再依赖固定微任务数量；产品回退逻辑保持不变。

## 验证

- format、TypeScript、ESLint、依赖审计、467 项 Vitest、Electron、Windows/Web/云构建均通过。
- Android sync、JVM unit、lint 和 assemble 通过；华为 `2e28bb17` 与小米 `192.168.1.84:5555` 均回读 `versionName=0.12.44`、`versionCode=1244`，并保有 `tcp:18787` reverse。
- Windows 安装版回读 `0.12.44`；正式安装版、便携版、主窗口、实时回退和两态小窗 smoke 均通过，包内构建身份为 `0.12.44 / 59a71bc`。
- 三端安装矩阵一致：Windows `0.12.44`、华为 `0.12.44 / 1244`、小米 `0.12.44 / 1244`。

## 升级提示

- Windows 可使用安装版覆盖升级，也可直接运行便携版。
- Android 端可覆盖安装同一个 APK 并保留应用数据；华为平板与小米手机共用该 APK。
- 使用电脑本机同步服务时，每台网络 ADB 设备需保持独立的 `tcp:18787` reverse。

## 已知限制

- Android 附件使用与既有设备一致的调试签名，尚未配置独立的 Android release signing。
- 内置同步服务只监听电脑回环地址；跨网络使用仍需要 HTTPS 个人云。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.44-x64.exe` | `47ca771343705c7bc51a65c37a72fecb3a44083ed0f3c209ee060a1b29cc5004` |
| `FocusLink-0.12.44-x64-portable.exe` | `9ae5a33398f46895555f0a16b1c6bf224a288ee27f26e6e6a94bbe8a827c9881` |
| `FocusLink-0.12.44-android.apk` | `3b9e6209298d8d4fda3a3bd5f7c7fc17e86aecd1f44657ec4a37ee6b583fbf0c` |

`SHA256SUMS.txt` 收录仓库发布目录中的 Windows 安装版与便携版校验值；Android APK 以本页记录的校验值核对。
