# FocusLink v0.12.76

> 发布日期：2026-08-03
>
> 对应提交：`af4dfd7`
>
> 发布类型：作废候选（由 v0.12.77 替代）
>
> 验证状态：四设备门禁失败；OPPO OWW221 未安装，候选后继续修改跨端行为

> 本候选未推送到 GitHub `main`，未创建 tag 或 GitHub Release，不得作为正式交付使用。

## 主要变化

- **移动端界面统一重做**：手机、平板与移动 Web 采用同一套 Apple HIG 启发的系统化层级、系统字体、grouped surface、发丝分隔与 44px 触控区；清理旧的卡片墙、扫光和不一致材质，亮暗主题与减少透明度/动效均保留完整可读层级。Windows 产品 UI、两态 mini、华为 capsule、小米系统表面与 OPPO 手表专用 renderer 保持原路径。
- **云端任务树取代旧选择行**：主界面的原生 `<select>` 与横向“浏览任务树”组合改为单一「从云端任务清单选择」disclosure；任务页使用电脑最后一次成功发布到云端的滴答快照，支持项目分组、父子折叠、搜索、完整路径、选择与「关联并开始专注」，手机和平板不接触滴答凭据。
- **远端会话自动回写**：Windows 导入手机/平板完成的 Sync v2 会话时，在同一 SQLite 事务内只登记滴答与番茄 To-Do 的独立持久意图；提交后由原子 claim/lease coordinator 复用既有 durable provider 队列，分别确认成功、失败保留并指数退避，重复导入与重启恢复不会重复投递。后台重试不会强制启动番茄 To-Do。
- **版本与交付**：Windows、Web/PWA 与 Android 统一升级为 `0.12.76/1276`。

## 候选验证记录

- format、typecheck、lint、104 个 Vitest 文件/709 项全部通过；electron-builder dist 成功。
- Android `:app:testDebugUnitTest`、`:app:lintDebug`、`:app:assembleDebug` 通过；APK 回读 `versionCode=1276 / versionName=0.12.76`。
- Windows installer/portable 启动验证通过；win-unpacked `FocusLink.exe` 文件版本 `0.12.76`；打包内 commit 为干净的 `af4dfd7`。
- Windows、小米、华为曾逐台实装并回读 `0.12.76/1276`；OPPO OWW221 未在线，按项目硬规则整轮门禁失败。
- 候选后又修复 provider 跨凭据作用域、旧会话回填与移动设置页 44px 目标，因此版本不可复用，由 0.12.77 重新完成测试、打包和四设备安装。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并逐台回读 `versionName/versionCode`。

## 已知限制

- 手机、平板共用同一响应式 Android APK；当前仍使用与既有设备一致的调试签名。
- OPPO 手表 OWW221 未纳入本轮安装矩阵（设备未在线）。
- 华为等无代理设备在 `workers.dev` 域名 DNS 污染的网络下无法访问云端，需开启代理或连接可达网络（详见 `backend-design/IMPLEMENTATION_LOG.md`）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.76-x64.exe` | `392df75b9b2e25389809e1fbb36609b9a727584a4b0d986fcb309ffe4116f23f` |
| `FocusLink-0.12.76-x64-portable.exe` | `1bb571ca196460ed810d93736f353d5055b70bb7816adc9184be5dd67c4c5dbe` |

同时提供 `SHA256SUMS.txt`。
