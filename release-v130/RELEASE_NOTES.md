# FocusLink v1.3.0

> 发布日期：2026-08-31
>
> 对应产品源码提交：`178959d`
>
> 发布类型：本地候选
>
> 验证状态：源码、Windows、Android 构建与三设备同版安装门禁已通过；本轮不创建公开 Release

## 主要变化

- 移动 Dashboard 支持今天、昨天、本/上 7 天、本/上 30 天与自定义范围，24 小时时间段可查看精确起止和任务状态。
- 主题改为三段选择，八套字体直接显示真实字形；计时仪表与桌面共用时间支架语义。
- 清单创建后自动进入目标清单，任务可完成/恢复；设置、设备连接和权限状态显示真实同步事实。
- Android root 权限逐项执行并回读，不把打开设置页冒充授权成功。
- 修复覆盖安装后 Keystore 凭据仍在但界面显示未配对：原生桥迟注入时自动恢复，显式登录/配对/退出始终优先。
- 修复手机顶部同步状态按钮触控区域不足 44px，真实小米手机回读 `116.46×44px`。

## 验证

- Node `22.22.2`：format、typecheck、lint、根 Vitest `129 files / 1016 tests` 全部通过；cross-device `6 files / 71 tests` 通过。
- Android：JVM、lint、assemble 通过；正式 `app.focuslink.mobile` APK 为 `1.3.0/1306`，SHA256 `0855A028F04534AF1493F27A7EED38DDE36632607943E50E1732D3C66BAD2A85`。
- Windows：unpacked UI、mini、live fallback、portable startup 与完整 UI smoke 均回读 `1.3.0 / 178959d` 并通过。
- Windows 安装：`/S` exit 0，卸载项回读 `1.3.0`，EXE 回读 `1.3.0/1.3.0.0`，SQLite 与设备凭据保留，应用已重启。
- 小米手机：因历史正式包签名不匹配，使用同源码同签名 `app.focuslink.mobile.v012104` 原位 `adb install -r`，回读 `1.3.0/1306`；Keystore 自动恢复、权限、Dashboard、任务/清单、短专注、主题/字体、四页布局和 44px 同步按钮均验收通过。APK SHA256 `1CBB071368EF68D08515370516820E439B87E22E550D9BBA7DEC5020E757FE79`。
- 华为平板：正式 `app.focuslink.mobile` 原位 `adb install -r` 并回读 `1.3.0/1306`；按用户要求只执行安装回读，不跑功能 smoke。
- 发布目录复核：仅保留 installer、portable、`SHA256SUMS.txt`、`RELEASE_NOTES.md` 四个文件；构建中间物已清理，`.git/lfs/tmp` 为 0。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- 小米保留配对数据的实例使用 `app.focuslink.mobile.v012104` 同签名包；禁止卸载、降级或清数据换取安装通过。华为使用正式 `app.focuslink.mobile` 包。
- 既有合法 `fl2` 凭据原位升级；连接恢复前不要清 Web Storage、IndexedDB、应用数据或 Keystore，也不要重新配对。

## 已知限制

- 小米正式旧 applicationId 因历史签名不同无法覆盖，本候选保留明确的同源码并行 applicationId；该事实不影响三设备同版安装与本轮功能验收。
- 未经用户明确要求，本轮不创建 tag 或 GitHub Release。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.3.0-x64.exe` | `0EF29B9DDEF0E31D156E9EC20D678713283F121779F19796FAA55FCF79263DB3` |
| `FocusLink-1.3.0-x64-portable.exe` | `B1250D3C4763C433213780695F18FD980546E79A1DEB4C3FBF74FE21198DF5F9` |

同时提供 `SHA256SUMS.txt`。
