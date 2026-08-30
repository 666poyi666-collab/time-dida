# FocusLink v0.12.105

> 发布日期：2026-08-30
>
> 对应打包提交：`edf0915`
>
> 发布类型：本地候选，未创建 tag 或 GitHub Release
>
> 验证状态：源码、Worker、Windows、华为平板、小米安装与 packaged smoke 已完成；ChatGPT Web 工具定义已刷新，OAuth 写权限重新连接等待用户确认

## 主要变化

- Dashboard 的 24 小时时间地图增加五时段、25 个整点刻度、专注/暂停/空档三轨累计和当前时刻；平板完整展示 00–24。
- 设置页压缩导航与间距；跨设备明确区分当前实时连接、账本新鲜度、最后成功与历史诊断，设备行显示真实最近活动时间。
- 番茄 To-do 将可上传队列与 7 天窗口外历史分开。真实数据为 0 条可上传、223 条过期历史；历史保留本机、停止重试、不改日期、不伪报同步。
- 平板字体控件改为选择器与真实样张双列，九种仪表保持三列；标准等宽和制图描线预览不再裁切。
- 360px 手机的六种仪表预览改为真正居中缩放；标准仪表从右侧溢出 65.5px 收敛为左右各保留 0.9px，并为八字体/九仪表增加父子几何门禁。
- 移动任务页新增“待办/已完成”分段视图，已完成任务可恢复；后台刷新与创建、移动、完成/恢复共享同账号已确认快照，首次操作不再被 5 秒刷新取消。
- FocusLink 任务支持开始时间和结构化循环：日/周/月/年、间隔、星期/月日、结束时间、总次数与顺延方式；完成次数由 Account DO 原子推进。
- MCP/CLI 完整支持当前时间、清单/任务 CRUD、优先级、开始/截止日期、标签、父子任务和循环。写入继续使用 `operationId + expectedRevision`；响应体断流也会以相同正文有限重试。
- MCP 测试逐个调用 9 个写工具并核对 Account DO mutation；CLI 门禁覆盖清单/任务 list/get/update/filter、redirect、超大/非法响应和完整帮助参数。
- 账号切换建立 task/live/ledger transition barrier，旧账号请求不能在异步清缓存期间回写新账号 UI 或 IndexedDB。

## 验证

- Node 22.22.2 / npm 10.9.7：format/typecheck/lint 通过；根 Vitest `127 files / 987 tests`，cloud/mcp `11 files / 117 tests`，cross-device `6 files / 63 tests`。
- Cloudflare 两阶段协议通过；private/public dry-run 通过。private `focuslink-sync` 已部署 `5c413507-a033-46ed-9ed2-b541f5190947`，public `foxlink-mcp` 已部署 `3592ccde-efdf-4ce0-8f1a-34a1b9fb697b`，远端 probe `19/19`。
- unpacked UI、固定两态 mini、live fallback、portable startup 与完整 portable UI 通过。portable 冷启动首次超过旧 15 秒等待，UI 首轮实际已暂停但过渡节点仍保留旧按钮；门禁改为 60 秒并读取最新主按钮后，同一包复跑通过。包内身份 `0.12.105 / edf0915`。
- Windows installer `/S` exit 0；卸载项、FileVersion、ProductVersion 回读 `0.12.105 / 0.12.105 / 0.12.105.0`，安装版日志回读构建 `edf0915`。SQLite `quick_check=ok`，安装前后保持 111 sessions / 250 segments / 193 pauses，设备凭据文件保留。
- 番茄 To-do bridge ensure 启动标准客户端并回读 `connected=true`；设置页真实显示“当前无可上传记录 / 223 条过期历史已停止重试 / 连接已确认”，没有无效上传按钮。
- 华为 DBY-W09 正式包覆盖并回读 `0.12.105/1305`，WebView 构建 `edf0915`、实时连接在线、账本新鲜、无横向溢出，九仪表真机几何 `9/9` 完整。隔离 terminal `4/4` 与非手工系统合同 `13/13`（含 PiP）通过；`.test` 包已卸载。
- 平板与 Windows 真实配对后，任务创建/移动/完成/恢复双向收敛；实时链完成“平板开始 → PC 暂停 → 平板继续/结束”；PC 回读账本 `2 segments + 1 pause`。所有临时任务、清单和会话最终精确匹配为 0。
- 小米 `192.168.1.4:5555` 旧正式包因历史签名不能覆盖，未卸载、未清数据；同源码并行包 `app.focuslink.mobile.v012105` 已覆盖、启动并回读 `0.12.105/1305`。
- 正式 Android APK `app.focuslink.mobile` SHA256：`8334405326DFEA483596B4B035ACD683AFBA9AA026314FEBC5A61C93C425442A`。
- `.git/lfs/tmp` 打包前后均为 0 文件 / 0 B。

## 已知限制

- ChatGPT Web 已刷新 FocusLink 插件定义，当前时间、清单/任务读写与 `focuslink:write` 都已出现。现有连接仍需在“重新连接”中扩展 OAuth 权限；页面停在该动作前，等待用户动作时确认，生产可逆写入尚未执行。
- 小米正式包保留旧签名的 `0.12.87` 用户数据；本轮使用并行包验证安装，不通过卸载旧包换取覆盖成功。
- 番茄 To-do 当前没有手机端专注记录独立回读；“上传已确认”仍不能代替手机显示确认。223 条超窗历史不会自动重排日期。
- 全量 Android instrumentation 的 25 项中，4 项因真实云参数/设备型号不满足而条件跳过，3 个仅用于人工截图保持的通知/悬浮窗用例因系统权限未开启失败；上述 `4/4 + 13/13` 隔离发布合同单独通过。
- OPPO 手表已退役，不参与本版本开发或验证。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.105-x64.exe` | `55EB71F7FCA041B3577D5F3FD72F8B1CEE6814AE830FEAAB23C106118EED43F4` |
| `FocusLink-0.12.105-x64-portable.exe` | `B5714CF493130EA9C2951BBCC747A588E405C205E6E80DD4B8516E4B5838628D` |

同时提供 `SHA256SUMS.txt`。
