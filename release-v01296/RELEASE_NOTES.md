# FocusLink v0.12.96

> 发布日期：2026-08-24
>
> 对应提交：`0ae54b4`
>
> 发布类型：本地安装候选（未创建 GitHub Release）
>
> 验证状态：Windows、小米、华为同版实装；自动化与打包 smoke 通过

## 主要变化

- 手机和平板移除重复标题和常驻双同步条，专注页按「主读数 → 本轮任务/标题 → 主操作 → 时间账本」顺读。
- 360/412 手机、640/760 平板和 915×412 横屏统一底部导航；只有桌面级宽屏才切换侧栏。
- 移动设置收敛为设备授权、主题、强调色、字体和关于；底层 Sync v2/HTTP 错误不再常驻普通界面。
- 移动统计与 PC Dashboard 改为结论优先；PC 零记录状态也呈现完整的 0 分钟看板。
- 设备授权明确说明当前 43 位一次性管理员授权码边界，本机任务和计时不依赖登录。
- 修复华为旧版 WebView 将 `color-mix()` 边框退化成黑色 `currentColor` 的真机兼容问题。

## 验证

- TypeScript/Cloudflare 类型检查、完整 Vitest `117 files / 861 tests`、desktop/Web/Android build 通过；Android JVM 36/36 与 lint 通过。
- 360×800、412×915、640×1024、760×1024、915×412 明暗四页面 production viewport 通过，无横向溢出，主交互不低于 44px；桌面明暗/最小窗四页面截图通过。
- packaged UI、固定两态 mini 与 live fallback smoke 均回读 `0.12.96 / 0ae54b4` 并通过。
- Windows 静默覆盖后卸载项和已安装 EXE 均回读 `0.12.96`，启动日志回读提交 `0ae54b4`；小米 xaga 与华为 DBY-W09 的并存 staging 包均 `adb install -r` 成功并回读 `0.12.96/1296`。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- Android 正式包存在历史签名差异时禁止卸载换签名；本轮以既有并存 staging 包保留正式包与用户数据。
- 既有合法 `fl2` 凭据原位升级；本机任务和计时不要求登录。新设备当前仍需 Poyi 管理员一次性授权码。

## 已知限制

- 当前身份页没有普通账号注册、找回密码或首台设备自助取码入口；本轮修正了产品说明，但没有把身份供应冒充为已闭环。
- 全仓 format/Lint 仍被未触及 `cloud/mcp` 的 26 个格式存量、1 个 namespace error 与 2 warnings 阻断；本轮文件级检查通过。
- 用户要求删除的 8 个隔离 LFS 临时目录共 109,504,409,006 字节仍在 `C:\Temp`；删除命令在进程启动前被当前执行策略拒绝，未假报为已清除。
- OPPO OWW221 已退役，不参与本轮开发或安装门禁。多显示器混合 DPI 拖拽仍只覆盖自动布局与单显示器 packaged smoke。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.96-x64.exe` | `613FA06FF2A3B918A791AC53E699D555AB5D704C93C7AEC022E0E0D08C9F9C40` |
| `FocusLink-0.12.96-x64-portable.exe` | `F76C375506C73818A5AB48B051C2A37EEAC32E53C628ED6254E14CF87FD56C5E` |

同时提供 `SHA256SUMS.txt`。
