# FocusLink v0.12.53

> 发布日期：2026-07-26
>
> 对应提交：`a5a86d2-dirty`（本地验收版本）
>
> 发布类型：本地验收版本
>
> 验证状态：自动化、公网协议、Docker、三端真机与 Windows 覆盖安装已完成

## 本版内容

- 修复 Windows NSIS 覆盖安装：旧卸载器重试耗尽后，在当前用户进程已关闭的前提下，由新安装器原位覆盖注册表来源的同一安装目录，不删除用户目录。
- 新增 Cloudflare Worker 与账号级 SQLite Durable Object，兼容现有账本、任务和实时控制接口；Node/Docker 后端继续保留。
- Windows、小米和华为统一连接 `https://focuslink-sync.pyzzgk.dpdns.org`；移动端在电脑停止时仍可独立开始、暂停、继续、结束并最终入账。
- Android 悬浮条支持点按显示关闭按钮、3 秒收起、持久关闭与逐帧拖动；标准通知、小米和华为系统表面适配器保持隔离。

## 验证

- format、typecheck、ESLint、68 个 Vitest 文件/475 项测试、Android unit/lint/assemble、Windows build/dist 均通过。
- Cloudflare 公网通过 `opId`/`commandId` 幂等、旧 revision 冲突、cursor 增量、任务快照、实时生命周期和重新部署后持久性验证；Docker 隔离个人云通过。
- Windows 进程停止时，小米与华为分别完成一轮开始、暂停、继续、结束；两份会话均为 2 段/1 暂停，Windows 恢复后各导入一次且无冲突或拒绝。
- 小米悬浮条 janky frames 为 3.54%（基线 14.04%），华为为 3.43%（基线 15.52%）；两机均无超过 100 ms 帧。
- Windows 从 v0.12.47 覆盖安装到 v0.12.53 后，数据库、设置、凭据和设备身份保留；v0.12.53 同版本静默重装也成功。

## 小米超级岛结论

指定小米 `22041216C / HyperOS OS3.0.1.0.VLHCNXM / SystemUI 20240808.0` 已解析协议 3 载荷并记录 `onInflateSuccess/onInflateFinish`，随后以 `onAuthFailed ... app.focuslink.mobile` 拒绝 OEM Focus 授权。桌面与锁屏截图均无真实超级岛，因此该 ROM/包签名组合明确判定为视觉不兼容，不标记 `visually-verified`；标准常驻通知和 FocusLink 悬浮条正常工作。

## 交付边界

- 按本轮要求，本版不推送 `main`，不创建 tag 或 GitHub Release。
- Android 使用既有调试签名；Cloudflare 当前为单账号个人同步服务，不提供通用生产身份系统、设备撤销或托管备份。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.53-x64.exe` | `5654820a4dfe449816c6e8111d1bae34aa62aea13af799ad57545e5134a091c7` |
| `FocusLink-0.12.53-x64-portable.exe` | `459fb6809de64d7cc4180e100f2c9ad88dcaf5c6fd7f9225738c62e5fe48ebbf` |
| `FocusLink-0.12.53-android.apk`（`.tmp` 备份） | `e637fa54adddf6a57aff1529ab665b250a437da632407f44215700fb7e0c0135` |
