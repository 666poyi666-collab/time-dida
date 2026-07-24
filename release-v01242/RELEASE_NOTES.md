# FocusLink v0.12.42

> 发布日期：2026-07-24
>
> 对应源码：`178fa87025cc63d4b1f90947a633115ce191b192`
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

## 验证

- format、TypeScript、ESLint、依赖审计、467 项 Vitest、Electron 回归、Windows/Web/云构建和隔离个人云容器集成均通过。
- Android sync、JVM unit、lint、assemble 和设备 instrumentation 通过；华为与小米均回读 `versionName=0.12.42`、`versionCode=1242`。
- 正式 Windows 包的主窗口、实时降级和两态小窗 smoke 通过，包内构建身份为 `0.12.42 / 178fa87`。
- 三端开始、暂停、继续、结束及临时已结束账本写入/删除均收敛，测试数据已清理。

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
| `FocusLink-0.12.42-x64.exe` | `1a057bd38aca02d19b89b41e87a9d6fb6168b6baa949b8800419575f490573a9` |
| `FocusLink-0.12.42-x64-portable.exe` | `269dd48966092778610a425615c1ad4fe1cd2442358de7d756623e03d36787bd` |
| `FocusLink-0.12.42-android.apk` | `7b0fb51065d83e64aefd244edef9c9d78bbd117d1f95ab18ef261f53a249957d` |

`SHA256SUMS.txt` 收录仓库发布目录中的 Windows 安装版与便携版校验值；Android APK 以本页记录的校验值核对。
