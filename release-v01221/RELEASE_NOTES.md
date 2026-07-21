# FocusLink v0.12.21

> 发布日期：2026-07-21
>
> 对应源码：`SOURCE_COMMIT`
>
> 发布类型：本地候选版（GitHub 暂缓）
>
> 验证状态：自动化门禁已通过；本地资产待生成

## 本次更新

- 整条过去的时间带渲染为确定性粒子场，近“现在”处粒子密集、向远端逐渐散开并消逝；叠加痕迹渍层，暂停引线以燃烧形态保留。
- 新增 `motion.css` 动效基础设施（缓动/时长 token），外壳四视图方向感切换、专注页交错入场与按钮辉光、Toast 堆叠重排与对话框弹簧接入同一套动效与光效语言，统一提供 `prefers-reduced-motion` 降级。
- 五套表盘各自成戏：standard 数字滑动、flip 翻页优化、pixel 呼吸核心、thin 与 segment 进位扫光；时间之带指针增加呼吸辉光与变焦交叉淡化，任务树展开与 Picker 改用弹簧动效。
- 统计页 KPI count-up 与交错入场，设置页开关与 tab 指示条，mini 窗交叉淡入与状态点呼吸，移动端 ConnectionSheet 弹簧且专注绿对齐桌面 `#0E9F6E`；FRONTEND_SPEC 新增「动效与光效语言」章。
- Windows、Web/PWA 与 Android 统一升级到 0.12.21；Android `versionCode` 为 1221。

## 升级提示

- SQLite 账本、用户设置和跨设备连接配置无需迁移。
- GitHub 推送、tag 与 GitHub Release 按用户要求暂缓，本次优先提供本地安装版与便携版。

## 已知限制

- `FocusLink/cloud/` 仍是 loopback-first 测试后端，不应公开部署。
- 滴答清单与番茄 To-do 的真实投递仍只由桌面端执行。

## 验证

- format、TypeScript、ESLint 与测试门禁沿用上批次通过结果；本次构建门禁（tsc + vite build + electron-builder）与资产验证在构建后补全。
- 时间之带粒子场与全端动效均带 `prefers-reduced-motion` 降级，不操作用户鼠标键盘。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.12.21-x64.exe` | `INSTALLER_SHA256` |
| `FocusLink-0.12.21-x64-portable.exe` | `PORTABLE_SHA256` |

同时提供 `SHA256SUMS.txt`。
