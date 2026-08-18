# FocusLink v0.12.87

> 发布日期：2026-08-12
>
> 对应源码提交：`f4b3ce3`
>
> 发布类型：GitHub 预发布候选
>
> 验证状态：Windows 与小米已实装；华为不可达，三设备同版门禁未闭合

## 主要变化

- 桌面主窗所有非零圆角统一从 `--radius-*` 语义梯子取值；圆形、仪器槽位和前景高光进入主题 token，新增静态合同阻止 literal 黑白高光和散落圆角回归。
- 360/412 手机 production viewport 新增滚动到底部后的 sticky CTA、底部导航和内容遮挡几何断言；640/760/915×412、亮暗主题与四功能页继续保持无横向溢出和 ≥44px 触控目标。
- 保留固定两态 Windows mini、Huawei capsule 路径与 Xiaomi system-surface 路径；OPPO OWW221 继续退役/冻结，不纳入新迭代。

## 验证

- Node `22.22.2` / npm `10.9.9`：format、typecheck、lint、全量 Vitest `117 files / 850 tests`、build、dist 全部通过。
- Android：unit、lint、AndroidTest 编译、assemble 通过；APK 元数据回读 `versionName=0.12.87 / versionCode=1287`，SHA-256 `A91F65C96F96CA110AF6ADD5B1AEF135BFA124633DF662E3071BEDE0A0385A0E`。
- Packaged UI、mini、live-fallback smoke 全部通过；三者回读 build identity `0.12.87 / f4b3ce3`。
- 安装版与便携版启动门禁通过；便携版直接回读 `0.12.87 / f4b3ce3` 与完整主工作面。
- TomaToDo bridge/real 与 dida real/state/packaged UI 五项真实门禁全部通过。TomaToDo 只确认上传与本地 marker 清理，准确报告不支持独立云端读回/远端删除；dida 临时中文评论、幂等 marker、原生 focus、任务完成/撤销/恢复链均通过且临时任务已删除。
- Windows：安装器 `/S` exit 0；卸载项 `DisplayVersion=0.12.87`，已安装 EXE 回读 `FileVersion=0.12.87 / ProductVersion=0.12.87.0`，应用已重新启动。
- 小米 xaga：当前 ADB 地址 `192.168.1.4:5555`，覆盖安装后回读 `0.12.87/1287` 并启动；旧 `192.168.50.250:5555` 仅为 offline 历史。
- 小米暂停态系统通知为 foreground service，启用 chronometer，并携带 `focuslink.systemSurface=xiaomi-island` 与 MIUI island 参数；这是系统对象结构证据，不冒充超级岛外观已肉眼验收。
- 2026-08-12 人工检查桌面四视图、固定两态 mini 与 360/640/760/915×412 代表截图，未见裁切、重叠、黑边、绿边或卡片墙回归。

## 已知限制

- 华为 DBY-W09 未出现在 `adb devices` 或 mDNS，历史地址 `192.168.1.7:5555`、`192.168.1.61:5555` 在有界探测内不可达；未执行 0.12.87 安装或实体 IME/capsule 验收。因此当前候选不能宣称三设备交付完成；本次按用户要求同步到 GitHub `main` 并作为 `v0.12.87` 预发布提供下载，不替代华为实体验收。
- 多显示器混合 DPI 的真实拖拽未在对应硬件组合上执行；自动化只覆盖固定两态、四边吸附、native move-loop 与窗口几何合同。
- 当前 Windows 会话只枚举到一台 `2560×1440 @ 100%` 显示器，无法执行多显示器混合 DPI 的真实拖拽。小米 overlay 权限已授予但当前未显示 FocusLink overlay，拖动、旋转与重启恢复仍待人工操作；0.12.87 的 PC-off 双机真机流程也仍依赖华为在线。
- smoke 运行期间主机异常时钟曾让应用历史页显示 2026-08-13；本轮权威当前日期及所有发布记录严格使用 2026-08-12，该冲突显示不作为发布日期证据。
- GitHub Release 使用 `v0.12.87` 预发布标记并提供本目录中的安装版、便携版和 `SHA256SUMS.txt`；该预发布不等同于正式三设备发布。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.87-x64.exe` | `84181999DABFD53C0F20EA72CC40F66E60D02C42315E28A650D09AD4F37AAF4D` |
| `FocusLink-0.12.87-x64-portable.exe` | `B765B8C2D5A8E985858162C0897D9319091A14CFED75E670852DC3AC35EDBE0A` |

同时提供 `SHA256SUMS.txt`。Android APK 已备份到 `.tmp/android-apk-backups/FocusLink-0.12.87-1287-debug.apk`。
