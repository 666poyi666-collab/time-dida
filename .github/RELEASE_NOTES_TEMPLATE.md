# FocusLink v<VERSION>

> 发布日期：<RELEASE_DATE>
>
> 对应提交：`<SOURCE_COMMIT>`
>
> 发布类型：正式版
>
> 验证状态：<VERIFICATION_STATUS>

## 主要变化

- <CHANGE_SUMMARY>

## 验证

- <GATE_RESULTS>
- <INSTALL_MATRIX>

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并逐台回读 `versionName/versionCode`；生产连接只允许 canonical HTTPS authority，不配置 ADB reverse。
- 既有合法 `fl2` 凭据原位升级；如新设备登录 probe 返回 `not-deployed`，应保留旧设备在线并等待 canonical gateway 部署，不清除应用数据。

## 已知限制

- <KNOWN_LIMITATIONS>

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-<VERSION>-x64.exe` | `<SHA256_INSTALLER>` |
| `FocusLink-<VERSION>-x64-portable.exe` | `<SHA256_PORTABLE>` |

同时提供 `SHA256SUMS.txt`。
