# FocusLink v0.12.45

> 发布日期：2026-07-25
>
> 对应提交：`44b83052e95df052a6017b105dde60d5b809c344`
>
> 发布类型：正式版
>
> 验证状态：已通过

## 前端体验

- Windows 保留 `184x44` 收起态和 `256x70` 展开态两态小窗；华为保留 `layout11` 胶囊，小米保留超级岛，两端均保留标准通知兜底。
- 手机、平板与 Web 控制台使用与桌面一致的实时状态、任务快照和已结束账本。

## 同步与发布改进

- Windows 以单一串行协调流程维护每台在线 Android 设备的 `tcp:18787` reverse，并在晚连接、断开重连、系统恢复或令牌轮换后独立补配对和立即同步。
- 同一设备和凭据代次只自动配对一次；单台失败不阻断另一台，日志不记录令牌或 nonce。
- 桌面 idle 回退测试等待已确认状态；便携版 CDP 启动门禁使用最长 60 秒的有界等待，并在 Electron 提前退出时报告退出码。
- 从本版起，仅补丁尾号为 `0` 或 `5` 的版本上传 GitHub；中间版本保留本地日志、三端验收、四文件目录和 APK 备份，下一上传节点为 `0.12.50`。

## 验证

- format、TypeScript、ESLint、依赖审计、467 项 Vitest、Electron、Windows/Web/云构建均通过。
- Android sync、JVM unit、lint 和 assemble 通过；华为 `192.168.1.61:5555` 与小米 `192.168.1.84:5555` 均回读 `versionName=0.12.45`、`versionCode=1245`，并保有 `tcp:18787` reverse。
- Windows 安装版回读 `0.12.45`；实时回退、便携版主窗口和两态小窗 smoke 均通过，三端构建身份对应 `44b8305`。

## 升级提示

- Windows 可使用安装版覆盖升级，也可直接运行便携版。
- Android 端可覆盖安装同一个 APK 并保留应用数据；华为平板与小米手机共用该 APK。

## 已知限制

- Android 附件使用与既有设备一致的调试签名，尚未配置独立的 Android release signing。
- 内置同步服务只监听电脑回环地址；跨网络使用仍需要 HTTPS 个人云。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.45-x64.exe` | `bd717721a17cde24ea2103a467cb0a4a3bd35f3c0e0320ab1808ca898df5a31b` |
| `FocusLink-0.12.45-x64-portable.exe` | `1eabccd94dd9ea94b3ee2e11527593b4b03eeded2d880e8c9dbb3336d6fb7675` |
| `FocusLink-0.12.45-android.apk` | `38554008a2315f59096aa8a264eb9fc98eb024788446b304470fe8138e6af546` |

`SHA256SUMS.txt` 收录 Windows 两包校验值；Android APK 以本页记录的校验值核对。
