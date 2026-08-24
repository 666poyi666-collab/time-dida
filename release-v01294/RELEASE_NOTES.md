# FocusLink v0.12.94

> 发布日期：2026-08-24
>
> 对应提交：`786c106`
>
> 发布类型：本地验收版
>
> 验证状态：Windows 已实装；Android 同版 staging 已实装，正式签名链待统一

## 主要变化

- FocusLink 自有任务库成为默认任务入口；新安装和升级后不再自动显示或导入滴答清单。
- 桌面任务页重做为任务导航、执行列表和详情栏；第三方任务适配器收进设置中的“外部任务导入”。
- 手机和平板统一 FocusLink 2.0 视觉层、任务语义、底部导航/宽屏侧栏和 44px 触控合同。
- 专注、统计、设置与两态小窗统一新的青绿操作色、石墨正文和明暗主题；修复深色主按钮对比度与设置仪表预览裁切。

## 验证

- 类型检查、桌面/移动生产构建通过；完整 Vitest `117 files / 860 tests` 通过。
- packaged UI、mini 与 canonical live-fallback smoke 均通过；移动 360×800、412×915、640×1024、760×1024、915×412 明暗四页面无溢出、离屏元素或低于 44px 的交互目标。
- Windows：静默覆盖安装成功，卸载项、EXE 文件版本与运行日志均回读 `0.12.94`，日志内构建标识为 `786c106`。
- 小米：`app.focuslink.mobile.staging.ui1294` 实际安装并回读 `0.12.94/1294`；WebView DOM 完整、四项导航与自有任务文案可见，滴答清单文案不可见。
- 华为：`app.focuslink.mobile.staging.test` 实际安装并回读 `0.12.94/1294`；真机截图确认单栏、底部导航和 FocusLink 自有任务 UI。

## 升级提示

- Windows 可直接运行安装器覆盖现有版本；本轮已验证用户数据库和设置原位保留。
- Android 正式 `app.focuslink.mobile` 在两台设备上使用历史签名，小米保留 `0.12.87/1287`、华为保留 `0.12.85/1285`。本轮未卸载正式包，使用并存 staging 包验收新 UI。
- 外部任务导入默认折叠；只有主动展开并选择滴答 CLI / TickTick OAuth 后，相关连接和第三方同步分区才出现。

## 已知限制

- 小米处于受凭据保护的系统锁屏，像素截图为锁屏黑层；应用 WebView DOM 已验证，解锁后的像素验收仍待补。
- Android 正式包签名链尚未统一，正式包覆盖安装未完成；staging 同版不等同于正式包签名交付。
- 全仓格式与 Lint 仍分别受未触及 `cloud/mcp` 文件的既有格式和 namespace 规则阻断；本轮文件级格式与 Lint 通过。
- 当前 Windows 会话只有单显示器；混合 DPI 的真实鼠标拖放仍未执行。
- 本地打包期间 Codex Git 观察器多次触发 LFS 临时缓存增长；每次均在确认无 Git/LFS 进程后隔离，永久 LFS 对象未动。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.94-x64.exe` | `2D1DC7BE18976B0DDD38D1A5AD48B68FD6CFAD6B1C213381B657BDD2457A23EE` |
| `FocusLink-0.12.94-x64-portable.exe` | `2DED12EEBC41C7D4933B86293681EDE333A7B32CBD5FD1C7FB20BB4ED05C1E10` |

Android 正式 debug APK 备份 SHA256：`4F8A9F6E808D7310F9BCE267620BA46B83D5E5D8DA9DC54CE64DC36FD3CA25E1`。
