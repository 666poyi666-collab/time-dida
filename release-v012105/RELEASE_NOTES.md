# FocusLink v0.12.105

> 发布日期：2026-08-30
>
> 对应打包提交：`cdce0cf`
>
> 发布类型：本地候选，未创建 GitHub Release
>
> 验证状态：源码、Worker 部署、Windows 安装、小米安装和 packaged smoke 通过；华为平板不可达、生产 MCP 写入缺 OAuth access token，三设备发布门禁未闭合

## 主要变化

- Dashboard 的 24 小时时间地图增加深夜/上午/下午/晚间五时段、专注/暂停/空档累计和当前时刻；平板直接显示完整 00–24，手机只在地图内部横向查看。
- 设置页移除大号分区编号并压缩导航与间距；设备同步拆分当前实时连接、最近账本确认、最近尝试诊断和精确 freshness。
- 番茄 To-do 分别显示本机写入、上传队列、桌面桥接和手机显示，明确“上传已确认”不等于手机端回读。
- 界面字体从六套扩展至八套，新增思源宋体和站酷快乐体；桌面与移动端共享字体、九种计时仪表、五种强调色和 reduced-motion 语义。
- FocusLink 任务新增开始时间和结构化循环：日/周/月/年、间隔、星期/月日、结束时间、总次数和按计划/完成时间顺延；完成次数由 Account DO 原子推进，耗尽后才进入已完成。
- MCP 新增当前时间、清单详情和任务筛选，完整支持清单/任务 CRUD、优先级、开始/截止日期、标签、父子任务和循环规则。
- 新增第一方 `npm run focuslink` CLI；与 MCP 共用任务 CAS/幂等合同，但 CLI 只接受绑定设备凭据，ChatGPT Web 只使用 OAuth MCP。
- 0.12.104 旧客户端继续读取严格 v1 task shape；能力协商保护新调度字段，旧整包写入不会清空循环规则。
- 修复移动端循环任务完成绕过 CAS、响应丢失重试 operationId 变化、PC 合并旧 shape 清空调度，以及 portable 沉浸退出被 native IPC 阻塞。

## 验证

- Node 22.22.2：format/typecheck/lint 通过；根 Vitest `126 files / 957 tests`，cloud/mcp `11 files / 115 tests`；production dependency audit 0 vulnerabilities。
- Cloudflare protocol 两阶段持久化、本地 cross-device `6 files / 63 tests`、private/public Worker dry-run 通过。
- private `focuslink-sync` 已部署版本 `4fbf1576-9f9a-4d92-980a-2ba40146e32c`；public `foxlink-mcp` 最终部署版本 `77354996-ec46-452e-b694-4d4c95744fe1`；远端匿名 probe `19/19`。
- 桌面/移动明暗截图覆盖 360、412、640、760、915×412 与 980×660；无外层横向溢出，触控目标不小于 44px，八套字体均由本地资产加载。
- unpacked UI、固定两态 mini、live fallback 通过；portable startup 与完整 UI smoke 通过，包内身份 `0.12.105 / cdce0cf`。
- Android `testDebugUnitTest`、`lintDebug`、`assembleDebug` 通过；正式 APK `app.focuslink.mobile` 为 `0.12.105/1305`，SHA256 `F7A75ECFDD0878BCB5E72A478BFA4A98C3B7051B7A5CC70EA02691F6BCE33216`。
- Windows installer `/S` exit 0；已安装 EXE 回读 FileVersion `0.12.105`、ProductVersion `0.12.105.0`，应用已重启，SQLite 仍存在。
- 小米 `192.168.1.4:5555` 正式包因历史签名不同返回 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，未卸载或清数据；并行包 `app.focuslink.mobile.v012105` 已安装、启动并回读 `0.12.105/1305`。
- 华为平板旧地址 `192.168.1.7:5555` 当前 offline，mDNS/ARP 未发现新地址，因此本轮未实际安装；三设备同版门禁为 BLOCKED。
- 生产 MCP `verify:pc-off` 仍明确返回 `FOCUSLINK_MCP_ACCESS_TOKEN is missing or invalid`；未创建生产临时任务，不能宣称 ChatGPT Web 写入 E2E 已通过。
- `.git/lfs/tmp` 构建、打包、安装前后均为 0 文件 / 0 B。

## 已知限制

- 华为平板恢复 ADB 后仍需覆盖安装并回读 `0.12.105/1305`，再执行本轮平板真机 UI/循环任务 smoke。
- ChatGPT Web 需完成 OAuth 授权并提供有效 access token，才能执行生产 MCP 临时任务的创建、循环完成、恢复与清理闭环。
- OPPO 手表已退役，不参与本版本开发或验证。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.105-x64.exe` | `23220E3AA43A81423631B30C2E375A405AADABACD99C591C9AD39C7B3DC6CFC5` |
| `FocusLink-0.12.105-x64-portable.exe` | `CBB5FBEB868AF579796C8C6D071951C067240B8C949691BCCB93055D32D5A703` |

同时提供 `SHA256SUMS.txt`。
