# FocusLink v0.12.86

> 发布记录日期：2026-08-12
>
> 对应打包提交：`85c1155`
>
> 发布类型：本地候选（未创建公开 tag / GitHub Release）
>
> 验证状态：自动化、Windows/小米实装与 packaged smoke 已通过；华为同版实装未完成

## 主要变化

- 收口桌面 980×660 密度与断点、账本宽度层级及固定两态 mini（184×44 / 256×70）。
- 移动端改为连续工作面，修复 640 竖屏粘性操作区、760 双栏、IME 遮挡和系统主题实时跟随。
- 时间之带首分钟使用 90 秒最小窗口，避免过早填满；亮暗主题及所有 focus-color 变体达到文本对比度门禁。
- packaged smoke 隔离 Foxlink business API，并由 OS 分配 loopback CDP 端口，消除随机端口竞态。

## 验证

- Node 22.22.2 / npm 10.9.9：format、typecheck、lint、117 个 Vitest 文件 / 848 项、build、dist 全部通过。
- Android：unit、lint、AndroidTest 编译、assemble 通过；APK 元数据回读 `versionName=0.12.86 / versionCode=1286`。
- Packaged UI、mini、live-fallback smoke 均在提交 `85c1155` 的同一产物上 exit 0。
- Windows：安装器 `/S` exit 0；卸载注册项、已安装 EXE 文件版本均回读 `0.12.86`，应用已重新启动。
- 小米：mDNS 发现当前地址 `192.168.1.4:5555`，`adb install -r` 成功，回读 `versionName=0.12.86 / versionCode=1286` 并启动；旧 `192.168.50.250:5555` 仅为 offline 历史。
- 华为：未出现在 `adb devices`/mDNS，历史 `192.168.1.7:5555` 与当前已发现邻居端口均不可达；未执行安装，三设备同版门禁未闭合。

## 已知限制

- 当前候选不能宣称跨设备交付完成；必须在指定华为平板重新在线后安装同一 APK，并回读 `0.12.86/1286`。
- OPPO OWW221 已退役，不属于新版本开发或安装门禁。
- 未执行公开 tag、资产上传或 GitHub Release。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.86-x64.exe` | `32EE1325CF5C4C4B1529A9E89C62918B125D5691413AC7EF0209F7B803A7B6D4` |
| `FocusLink-0.12.86-x64-portable.exe` | `1D1DEE31DD8DECC156B4AD39691710EB46B73B538DCBBBF8F6A963F3D3D40E7A` |

同时提供 `SHA256SUMS.txt`。Android APK 备份 SHA256：`90518F6F1DBA9D4CB4B41D3BA17ADB7877606BBA45050E2DC8662616BAA90AA3`。
