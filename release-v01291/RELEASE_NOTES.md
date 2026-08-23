# FocusLink v0.12.91

> 发布日期：2026-08-23
>
> 对应提交：`f1361e9`
>
> 发布类型：本地验收版
>
> 验证状态：PC 已安装；手机和平板待设备在线

## 主要变化

- FocusLink 自有任务库取代滴答清单主数据源，滴答清单保留为迁移入口。
- PC、手机和平板均可创建 FocusLink 清单与任务；移动端可完成/恢复任务。
- PC 刷新时合并账号云端任务，防止覆盖其他设备新增内容。
- 手机/平板自动适配布局，移动端首屏和 Android 品牌启动图重做。
- 旧 loopback 凭据自动退出并切换到官方账号登录入口。

## 验证

- 完整 Vitest：117 个文件、857 项测试通过。
- PC build、Cloudflare typecheck、Android assembleDebug 通过。
- Windows 注册表、EXE 文件版本与运行日志均回读 `0.12.91 / f1361e9`。
- 官方账号 bootstrap 为 `deployed-login-required`，两个云端健康检查 HTTP 200。

## 安装矩阵

- Windows：已静默覆盖安装并启动 `0.12.91`。
- 小米手机：APK 已生成，设备当前未在线。
- 华为平板：APK 已生成，设备当前未在线。

## 校验

- `FocusLink-0.12.91-x64.exe`: `20D8354ACE24EB52F256ACE5E5B7CCBFA04078FEEBC2282012859503E064C922`
- `FocusLink-0.12.91-x64-portable.exe`: `EEC148D7C56D5375F82436A5EB083ACCED862148CB17437BF4386811B7731ED7`
- `FocusLink-0.12.91-1291-debug.apk`: `E35D61F010FC5E516401BE97745BC845BFDB9B5E6CA3D753C3E80188BBBC7B04`
