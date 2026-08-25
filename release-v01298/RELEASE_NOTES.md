# FocusLink v0.12.98

> 发布日期：2026-08-25
>
> 对应提交：`284b82f`
>
> 发布类型：本地安装候选（未创建 GitHub Release）
>
> 验证状态：Windows、小米、华为同版实装；自动化、安全、视觉和打包 smoke 通过；首台可信设备尚未授权，公网真实双设备兑换待完成

## 主要变化

- 已加入同步的 Windows、手机或平板可生成 8 位数字配对码；新设备输入后获得独立 `fl2` 凭据。
- 兑换成功后自动启动 FocusLink 任务快照、实时专注状态和已结束账本同步。
- 配对码 10 分钟/一次有效；服务端只落盘域分离 HMAC，凭据权限固定为 sync/live 四项。
- 移动生成码仅允许 FocusLink canonical/failover origin，禁止 redirect、cookie 和 referrer；WebView CORS 预检允许 `Authorization`。
- 修复桌面快速新建任务漏传 `parentId` 导致的 SQLite 命名参数异常。
- 将 NSIS 旧卸载器恢复补丁改为每次 dist 前必定执行；0.12.97 实装失败后不复用版本号，最终候选为 0.12.98/1298。

## 验证

- 全仓 Prettier、ESLint、TypeScript/Cloudflare 与独立 MCP 类型检查通过；根 Vitest `117 files / 874 tests`、cross-device `55/55`、cloud/mcp `10 files / 105 tests` 通过。
- private Worker 本地真实 DO gate 通过“生成 8 位码 → 兑换 → 新 token status → 重放 410”；过期/已用/跨账号、绑定不符、碰撞重试上限、哈希限流和日志脱敏负测通过。
- private Worker `0a531590-475f-4c98-9318-006aeae78f81` 与 public gateway `d690dbc1-2818-4a1f-98cc-3fdb374be525` 已真实部署；公网 OPTIONS 回读 `authorization, content-type`，无凭据 offer 返回 403。
- 360/412 手机、640/760 平板、915×412 横屏明暗四页面视觉门禁通过；华为真机截图确认 8 位码 sheet 、底部导航和实色兼容边框。
- packaged UI、固定两态 mini 和 live fallback 均回读 `0.12.98 / 284b82f` 并通过；Android JVM 36/36 与 lint 通过。
- Windows 静默覆盖 exit 0，注册表与 EXE 回读 `0.12.98 / 0.12.98.0`，启动日志回读 `284b82f`；小米 xaga 和华为 DBY-W09 staging 均 `adb install -r` 成功并回读 `0.12.98/1298`。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并逐台回读 `versionName/versionCode`；正式包有历史签名差异时继续使用已有 staging 包，不卸载换签名。
- 已有合法 `fl2` 凭据的设备原位升级；在“多端同步”点“添加设备”生成码，新设备输入。首台设备仍需“首台设备或账号恢复”管理员授权。

## 已知限制

- 当前 Windows 和华为真机都回读为本机模式，Windows 安全凭据文件不存在；没有一台已授权的可信首设备，因此本轮不伪造公网真实配对成功。首台设备完成管理员授权后即可生成 8 位码。
- 小米安装/版本回读成功，但截图时用户正在游戏前台；未强制打断游戏做像素验收。
- 用户要求删除的 8 个隔离 LFS 临时目录共 `109,504,409,006 B` 仍在 `C:\Temp`；即使已明确授权，当前执行策略仍在命令启动前拒绝自动删除，未假报成功。
- OPPO OWW221 已退役，不参与本轮开发或安装门禁。多显示器混合 DPI 拖拽仍只覆盖自动布局与单显示器 packaged smoke。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.98-x64.exe` | `5DBF44CDE13E2AA2B8CE68AC26436C943F8BBF0C8EF99F5E46D0BC6E6B7257BA` |
| `FocusLink-0.12.98-x64-portable.exe` | `9805B9B453D81BD17FCE7B13AD4417002EFA6CAAEADEEC65D665AD651946C2FD` |

同时提供 `SHA256SUMS.txt`。
