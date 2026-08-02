# FocusLink v0.12.75

> 发布日期：2026-08-02
>
> 对应提交：`6b8db5e`
>
> 发布类型：正式版
>
> 验证状态：门禁全部通过；三端实装并回读 `0.12.75 / 1275`，设备授权登录真机走通

## 主要变化

- **Android 浏览器打开修复**：0.12.72–0.12.74 手机点「登录」提示「无法打开系统登录页面」。根因是 Android 11+ package visibility——`AndroidManifest.xml` 未声明 `VIEW/BROWSABLE https` 的 `<queries>`，`resolveActivity()` 找不到默认浏览器，授权页从未弹出。本版在 Manifest 增加 `<queries>` 声明；小米真机点击登录弹出「FocusLink 想要打开 Via」确认框，授权页正常打开。
- **授权页未登录重定向**：手机浏览器打开设备批准页时，未登录会自动跳转到验证码登录表单（`/owner/sign-in?bootstrap_flow=...`），登录后回到待批准设备列表（`poyi-oauth-as` 部署）。
- **登录文案纠正**：改为明确提示「已打开授权网页，请在网页中完成登录与批准，会自动继续」。
- **设备授权登录端到端打通**：云端 `/account/v1/device/bootstrap` 部署完成，owner 网页用一次性验证码批准后设备获得 `fl2` 凭据。小米真机完成全链路：登录 → 浏览器打开 → 验证码登录 → 批准 → 实时已连接 + 账本同步确认（处理 362 条变更、95 场会话、82 个缓存任务）。

## 验证

- format、typecheck、lint、101 个 Vitest 文件/690 项全部通过；electron-builder dist 成功。
- Android `:app:testDebugUnitTest`、`:app:lintDebug`、`:app:assembleDebug` 通过；APK 回读 `versionCode=1275 / versionName=0.12.75`。
- Windows installer/portable 启动验证通过；win-unpacked `FocusLink.exe` 文件版本 `0.12.75`；打包内 commit 为干净的 `6b8db5e`。
- 安装矩阵（Windows / 小米 / 华为）：逐台实装并回读 `0.12.75/1275`，见版本发布记录。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并逐台回读 `versionName/versionCode`。
- 全新设备登录：设备上点「登录」→ 系统浏览器打开授权页 → 输入管理员一次性验证码 → 批准设备 → 自动开始同步。

## 已知限制

- 手机、平板共用同一响应式 Android APK；当前仍使用与既有设备一致的调试签名。
- OPPO 手表 OWW221 未纳入本轮安装矩阵（设备未在线）。
- 设备授权批准页位于 `poyi-oauth-as` 云端，owner 无密码系统，登录依赖管理员签发的一次性验证码。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.75-x64.exe` | `2f31404f6849731875503877f7fa5623f6059db801e8da646e2ec593d4221fd6` |
| `FocusLink-0.12.75-x64-portable.exe` | `5831a93dcc0fc0bcdbf5dc35dc7f822991ecc5587f1815c47062a106853e3ed3` |

同时提供 `SHA256SUMS.txt`。
