# FocusLink v0.12.73

- 发布类型：本地正式候选
- 验证状态：待完整门禁与四端同版安装回填
- 对应源码：`<SOURCE_COMMIT>`

## 主要变化

- 保持“登录一个 FocusLink 管理员账号即可同步”，普通界面没有服务地址、访问令牌、配对码或“编辑连接”；旧设备 `fl2` 原位升级继续使用。
- 新设备 bootstrap 使用严格 start/poll、短期独立 poll credential、canonical owner 登录 URL 与脱敏诊断；未完成 owner 登录时不接受设备凭据。
- 手机和平板在前台每 15 秒自动刷新任务快照，强制绕过 HTTP cache，旧 revision 不回退、同 revision 异文不覆盖。
- PC 只有在云端回读同一设备与同一任务快照正文后才确认发布，失败时保留耐久 pending 供下轮自动重试。
- Windows Dashboard 增加共享 07:00–22:00 有效日、focus/pause/gap 甜甜圈、24h 轴与精确空档；旧记录缺边界时明确标为 estimated。

## 保留能力

- Windows mini 仍只有 `184×44 / 256×70` 两态。
- 华为 `huawei-live-capsule`、小米系统通知路径和 OPPO 手表 renderer 保持。
- 云端实时控制、离线本机会话、任务快照与已结束账本继续使用同一 Account DO authority。

## 验证摘要

- `<GATE_RESULTS>`
- `<INSTALL_MATRIX>`

## 已知限制

- canonical 新设备登录网关当前探测为 `not-deployed`；旧凭据同步可用，但全新安装尚不能冒充已经完成公网登录。
- OPPO 手表“从手机登录”的 companion authorization 仍需外部 gateway/OMS 通道。
- Android 当前使用既有调试签名；手机、平板和手表共用同一 APK。

## SHA256

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.73-x64.exe` | `<SHA256>` |
| `FocusLink-0.12.73-x64-portable.exe` | `<SHA256>` |

同时提供 `SHA256SUMS.txt`；Android APK 备份保存在忽略目录并单独记录哈希。
