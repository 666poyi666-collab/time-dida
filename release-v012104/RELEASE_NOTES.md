# FocusLink v0.12.104

> 发布日期：2026-08-28
>
> 对应提交：`0e031fd`（便携版沉浸退出修复；自有任务/清单与云 MCP 任务能力提交：`cdc5d4d`；设备列表降噪功能提交：`bf98e8c`）
>
> 发布类型：本地候选，未创建 GitHub Release
>
> 验证状态：源码、Cloudflare dry-run/远端探针、Windows 安装、Android 构建与华为安装通过；完整 packaged UI smoke 与生产 MCP 任务写入仍受阻，不宣称正式发布

## 主要变化

- 每台电脑、手机和平板都可显示自己的 8 位本机配对码。
- 任意一台设备输入另一台的码，两台直接进入同一同步空间并开始同步。
- 不要求先登录、管理员码或设备顺序；相同设备重复输入同一码幂等成功。
- 新配对设备可查看并删除已配对设备；删除只撤销同步凭据，不删除业务记录。
- 正常配对入口只保留 8 位本机码，不再打开管理员授权网页。
- 移动端可不填标题直接开始“自由专注”，并与 PC 共用九种计时仪表、字体和强调色；设置页提供实时预览。
- 修复任务/清单首次写入竞态、PC 清单颜色级联覆盖和跨端任务快照确认；移动端任务写入失败显示明确状态并自动刷新。
- 已配对设备按“当前设备 / 其他设备 / 无效与测试设备”分层；测试、staging、smoke、久未同步和已撤销设备默认折叠，不再铺满页面。
- 普通清单现在可在 PC、手机和平板确认后删除；其中任务及子任务安全迁入收件箱，收件箱本身不可删除，删除发布未确认时保留错误并恢复本地状态。
- 云端 MCP 新增 FocusLink 自有清单/任务读取与管理工具，支持任务创建、更新、完成、恢复、删除、移动及截止时间、优先级、标签、父子任务；写入使用 `operationId` + `expectedRevision`，冲突不覆盖并返回脱敏确认。
- 修复便携版退出沉浸模式时 native 全屏确认迟到导致覆盖层不消失的问题；退出现在有界收束并保持计时状态。

## 验证

- format/typecheck/lint、根 Vitest `122 files / 915 tests`、cloud/mcp `113 tests`、Cloudflare 本地真实配对闭环均通过。
- 桌面 packaged UI、固定两态 mini、live fallback smoke 通过；移动 360/412/640/760/915 横竖屏明暗门禁通过。
- Windows 静默覆盖回读 `0.12.104 / 0.12.104.0`，应用已重启且 SQLite/credential 保留；Huawei `192.168.1.7:5555` 正式包回读 `0.12.104/1304`，小米正式包因历史签名不一致保留旧包且未清数据，并行包 `app.focuslink.mobile.v012104` 回读 `0.12.104/1304` 并启动；旧 Xiaomi 地址 `192.168.1.4:5555` offline。
- 公网新路由的 credential-boundary 与无次数限流回归通过；本地真实 Durable Object 已验证两台无登录设备直连、幂等重试和任务/live/账本读取。
- 本地 MCP/Cloudflare 合同回归覆盖任务 CAS、幂等重放、旧 revision 冲突、父子子树和清单安全删除；private/public Worker 与 Poyi OAuth scope migration 已部署，但生产 MCP 任务写入仍缺 OAuth access token，未创建临时数据。
- 生产环境两个无登录临时设备直连成功，双方任务 revision 33、live revision 101、账本接口 200；exchange/claim 重试幂等。
- 设备删除 canonical 路由已实修并复验：8 台临时 smoke 设备全部撤销成功，撤销后凭据均返回 401。
- 本轮部署版本：`focuslink-sync` `8b19926e-b7f4-46f7-90cc-4b2d96065770`、`foxlink-mcp` `b961c9d3-f9da-4079-b135-c8088fb06eb4`、Poyi OAuth `2b1f9e76-76ce-4af2-811a-b1d8048a0b71`；远端匿名 probe 19/19 通过。
- Android `assembleDebug`、单元测试、lint 与隔离 instrumentation（Huawei terminal lifecycle 4/4 + app context 1/1）通过；正式 APK `versionName=0.12.104/versionCode=1304`，备份 SHA256：`D3834D6C6DD3CEBF6EB38B8D833176BB52EDE4144852970E28F8F37C6946309D`。
- 新候选的 unpacked/portable `smoke:ui` 均出现状态收敛断言失败（unpacked toggle/flip-history，portable paused）；`verify-startup` portable 通过，不能把该启动证据扩大为完整 UI smoke 通过。

## 已知限制

- OPPO 手表已退役，不参与本版本开发和验证。

## 下载与校验

| `FocusLink-0.12.104-x64.exe` | `E8B35A8B958784879D994AB4E6BD353A1DE6C6AA12A8812E873F647709A5CE9F` |
| `FocusLink-0.12.104-x64-portable.exe` | `63FC4211E90573F91833BFE9006A14B61BF9EE41D9C03D36CEECA731AD51F0D8` |
