# FocusLink v1.3.0

> 发布日期：2026-08-31
>
> 对应提交：`2aec11e`
>
> 发布类型：本地候选
>
> 验证状态：源码、Windows 与 Android 构建门禁通过；小米/华为真机安装门禁未完成

## 主要变化

- 移动 Dashboard 支持今天、昨天、本/上 7 天、本/上 30 天与自定义范围，24 小时时间段可查看精确起止和任务状态。
- 主题改为三段选择，八套字体直接显示真实字形；计时仪表与桌面共用时间支架语义。
- 清单创建后自动进入目标清单，任务可完成/恢复；设置、设备连接和权限状态显示真实同步事实。
- Android root 权限逐项执行并回读，不把打开设置页冒充授权成功。
- 修复覆盖安装后 Keystore 凭据仍在但界面显示未配对：原生桥迟注入时自动恢复，显式登录/配对/退出始终优先。

## 验证

- Node `22.22.2`：format、typecheck、lint、根 Vitest `129 files / 1016 tests` 全部通过；cross-device `6 files / 71 tests` 通过。
- Android：正式 `app.focuslink.mobile` APK 为 `1.3.0/1306`，JVM、lint、assemble 通过；SHA256 `A516333CC4F27769016BCAB42BCA2ED1AEB2B8CEF5D064F9DAF8F34571DCE400`。
- Windows：unpacked UI、mini、live fallback，portable startup 与完整 UI smoke 均回读 `1.3.0 / 2aec11e` 并通过。
- Windows 安装：静默覆盖成功，注册表/EXE 回读 `1.3.0`，SQLite 与设备凭据保留，应用已重启。
- 真机矩阵：小米历史 ADB 地址均为 offline；华为未能建立 ADB 握手。本轮未安装、未回读，也未执行小米功能验收。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- 华为使用正式 `app.focuslink.mobile` APK；小米当前保留配对数据的并行包使用同源码 `app.focuslink.mobile.v012105` APK，禁止卸载或清数据换取安装通过。
- 既有合法 `fl2` 凭据原位升级；连接恢复前不要清 Web Storage、IndexedDB、应用数据或 Keystore，也不要重新配对。

## 已知限制

- 小米和华为真机当前不可达，三设备同版安装门禁仍为阻断状态；本候选不得标记为正式发布完成。
- 未经用户明确要求，本轮不创建 tag 或 GitHub Release。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.3.0-x64.exe` | `7AE91085BEDC672564C904BB659E0CB1F6361B2F07818F0B921F69BFB8F00597` |
| `FocusLink-1.3.0-x64-portable.exe` | `75A9D78B3BBD2AC066B10CE68B585CFA5DD30889C85F696593CA9A72BFE03D7C` |

同时提供 `SHA256SUMS.txt`。
