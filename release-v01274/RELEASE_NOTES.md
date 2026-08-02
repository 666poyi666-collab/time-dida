# FocusLink v0.12.74

> 发布日期：2026-08-02
>
> 对应提交：`607e710`
>
> 发布类型：正式版
>
> 验证状态：门禁全部通过；设备安装矩阵见版本发布记录，逐台实装后回填

## 主要变化

- **0.12.73 候选作废**：0.12.73/1273 候选生成后又修改了跨端行为，按用户决定作废、绝不复用；本版在冻结范围内统一升为 `0.12.74/1274`，作废候选的 release-v01273 目录退役，保留 v01270/v01272/v01274 三个规范发布目录。
- **native lease 生命周期收口**：手机/手表 renderer 的 live command、任务快照与账本拉取统一走可中止 request lease（新请求即中止旧代），Android native 侧以 `connection-generation barrier` + 来源 `deviceId` 双重校验写入；每次 await 后重验连接，旧 success/catch/finally 不再污染新账号。
- **切号竞态冻结审查补漏**：冻结审查确认 Android configure/clear、Sync v2 owner/epoch CAS、旧响应丢弃与 renderer 来源校验全部成立；补上两处边界 —— 旧代 `drainPendingCommands` 进入 generation barrier（切号后旧调用按 `stale_connection` 拒绝），Sync v2 切号 reset 同时清除 legacy `cursor` 元数据，并为 `settleMobileV2Ack` 补错 lease/device/epoch 拒绝的确定性负向用例。
- **instrumentation 生产偏好隔离**：Android instrumentation 全程使用 PID 前缀隔离 SharedPreferences，绝不触碰 7 个生产偏好文件；前后 SHA-256 契约在真机证据链回填。
- **移动端批次**：MobileApp/WatchApp 账本、命令与快照在账号生命周期上统一挂载可中止 lease；accountLifecycle 串行化 Keystore 写入与补偿回滚（后继登录提交后旧 restore 直接拒绝，不可能覆盖）。
- **测试修复**：`persistCompletedOfflineFocus` 与 native completion 测试补齐 native connection lease 参数并统一格式，全量 690 项 Vitest 通过。

## 验证

- format、typecheck、lint、101 个 Vitest 文件/690 项全部通过；`npm run build` 与 electron-builder dist 成功。
- Android `:app:testDebugUnitTest`、`:app:lintDebug`、`:app:assembleDebug` 通过；APK 回读 `versionCode=1274 / versionName=0.12.74`，`FocusLinkConfigTest` 版本断言一致。
- Windows installer/portable 启动验证通过；win-unpacked `FocusLink.exe` 文件版本 `0.12.74`；打包内 commit 为干净的 `607e710`。
- 安装矩阵（Windows / 小米 / 华为 / OPPO 手表）：见版本发布记录，逐台实装后回填，缺失或版本落后即视为未通过。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并逐台回读 `versionName/versionCode`；生产连接只允许 canonical HTTPS authority，不配置 ADB reverse。
- 既有合法 `fl2` 凭据原位升级；如新设备登录 probe 返回 `not-deployed`，应保留旧设备在线并等待 canonical gateway 部署，不清除应用数据。

## 已知限制

- 手机、平板和 OPPO 手表共用同一响应式 Android APK；当前仍使用与既有设备一致的调试签名。
- 移动端只控制 FocusLink 云端活动会话；滴答清单与番茄 To-do 的第三方投递仍由桌面端执行并确认。
- 新设备“登录即同步”还需要 canonical `foxlink-cloud-mcp` 公网 bootstrap 与独立 identity secret 上线；本地候选没有部署外部仓或读取远端 secret。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.74-x64.exe` | `573ae109fa8295ed9fccf5dfe0fe0d9c43b4cc4ca4f95323e2ffad70d40a6be5` |
| `FocusLink-0.12.74-x64-portable.exe` | `5e7f9c86770d3cd228be280e89ba10572438ed25a39b25e6217bdda5ffc796e6` |

同时提供 `SHA256SUMS.txt`。
