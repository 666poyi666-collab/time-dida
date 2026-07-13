# FocusLink v0.11.0

> 发布日期：2026-07-13
>
> 对应提交：`ec7fe74d4753a5f3d0da75dc63fc744fd92b5499`
>
> 发布类型：正式版
>
> 验证状态：已通过

## 本次更新

### 动态材质工作面

- 主窗口重建为低对比环境光场、轨道轮廓、稀疏粒子、状态呼吸光和强调色伴生色；专注、任务、统计与设置统一使用高不透明材质面、折射边缘和定向阴影。
- 六种强调色会同时驱动导航、主要按钮、环境层与状态细节；持续动画在“减少动态效果”下停用，全屏页面不再动画整页 blur 或滤镜。
- 默认字体改为 Manrope Variable + Noto Sans SC Variable 的“澄澈”方案，保留 Geist“精准”方案并支持即时切换与持久化。

### 任务工作台与双同步

- 任务页直接使用滴答清单，移除多余“任务来源”交互；支持搜索、强制刷新、完成/恢复、6 秒撤销，以及按最近完成、名称和截止日期排序的已完成分组。
- 滴答同步继续以任务评论为第一写入目标，使用稳定 segment marker 做幂等；普通任务完成/恢复、原生专注任务关联和真实 UI 找回链路均已验证。
- 番茄 To-do 手动同步可在客户端未运行时按需使用回环随机调试端口连接；已普通运行但没有桥接时绝不杀进程或擅自重启，后台周期也不会启动外部应用。
- 番茄 To-do 目标必须同时通过窗口标题与特征 API 指纹；上传 success 只显示为“上传已确认”，不冒充独立云端回读。

### 过渡式边缘小窗

- 小窗严格只有折叠 `184×35` 与展开 `256×92` 两种固定尺寸；折叠时间为 25px，展开时间为 31px，折叠态底部加入 3px 真实专注进度轨。
- 展开态在单一密集控制台内呈现任务、当前时间、累计专注/暂停/总历时和全部当前控制，不再嵌套卡片。
- 原生 Windows move loop 只在拖拽释放后执行“吸附 → 可见过渡 → 自动折叠”；320ms 收束期间重新拖动会取消折叠，不抢鼠标。

### 单一源码工作区

- renderer、Electron、shared、测试、脚本、设计文档和构建配置全部收进 `FocusLink/`。
- 仓库根目录只保留 GitHub/治理入口、`FocusLink/` 与最近三个 `release-v*`；前后端设计规范继续作为唯一维护文档入口。

## 修复

- 修复全屏 blur、route transform 与透明顶栏组合可能造成的 Electron 黑色合成块；底层材质改为稳定的不透明表面。
- 修复统计详情被旧 IPC 响应覆盖后无法操作的问题，并为 renderer 无响应、错误日志和托盘监听增加受控恢复与幂等保护。
- 修复字体切换误触快捷键、开机启动或同步设置副作用的问题。
- 修复小窗按住拖动时提前折叠、贴边突变、DPI 舍入和过渡中无法取消的问题。
- 修复隔离安装 smoke 被 Electron Builder 内置运行检测阻塞的问题；本机验收不会关闭用户正在运行的 FocusLink，会在结束后原样恢复卸载注册项和快捷方式。

## 升级提示

- 用户数据库、任务关联、计时记录和同步队列无需迁移。
- 旧设置缺少 `fontProfile` 时自动使用新的“澄澈”方案，可在设置 > 体验切回 Geist“精准”。
- 开发与 Web Coding 工作目录为仓库内 `FocusLink/`；正式资产位于根级 `release-v0110/`。

## 已知限制

- 无已知阻断问题。
- 番茄 To-do 当前只能确认 `cloudSyncUploadRecord` 返回 success，客户端没有 PCRecord 的独立云端回读与远端删除 API；删除验收因此只确认本地 marker 清理，`remoteDeleteSupported=false`、`remoteCleanupVerified=false`。

## 验证

- `npm run format:check`、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run regression:electron` 与 `npm run dist` 均通过；`npm test` 为 28 个测试文件 / 231 项测试，`npm audit --omit=dev` 为 0 个生产依赖漏洞。
- Electron 回归覆盖计时状态机、任务继承、running/paused 崩溃恢复、统计 request-id、renderer 恢复、日志序列化与托盘监听幂等。
- 正式 `win-unpacked` 与便携版的主窗/小窗 smoke，以及隔离安装版主窗 smoke 均通过；三种包均核对身份 `0.11.0/ec7fe74`。
- 主窗实测覆盖 idle、running、paused、任务选择器、任务、统计、设置、深浅主题、双字体和 reduced-motion；六种强调色在深浅主题下的操作文字对比度全部 `>= 4.5`，最低实测为 `4.59`。
- 小窗实测覆盖双固定尺寸、所有控制、主题/字体广播、四边吸附、可见收束、离边展开、原生 `WM_ENTERSIZEMOVE/WM_EXITSIZEMOVE` 释放门控及过渡中拖动取消。当前机器为单显示器，真实多显示器/DPI 几何由独立布局测试覆盖。
- 隔离安装版退出码为 0，原有 5 个 FocusLink 进程全部保留；0.10.0 卸载注册项和桌面/开始菜单快捷方式已原样恢复。
- 滴答真实临时任务验证了中文评论、首次 `added`、重试 `skipped`、marker 恰好一次、30 秒原生 focus 与任务关联、普通任务完成/恢复；真实 UI 验证了“完成 → 约 6 秒撤销 → 再完成 → 今天分组找回 → 恢复”，临时 focus 和任务均已清理。
- 番茄 To-do 标准安装路径的无业务写入 bridge probe 通过，确认回环 `port=0`、标题与特征 API 指纹；写入路径未改变的真实上传回归另行确认了 upload API success、marker 幂等和本地 marker 清理，未声称独立云端回读或远端删除。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.11.0-x64.exe` | `bc9d46da65c61c7de570874aea8e41198bb0165396a14ad93d6504b9b7422532` |
| `FocusLink-0.11.0-x64-portable.exe` | `72475ad421e9fe81dfdd36e3150b327b302f4f4fd7ae840ec1baa83d5f0ad4b0` |

同时提供 `SHA256SUMS.txt`。下载后可在 PowerShell 执行：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\FocusLink-0.11.0-x64.exe'
```
