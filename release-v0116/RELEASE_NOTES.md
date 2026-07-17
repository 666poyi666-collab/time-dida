# FocusLink v0.11.6

> 发布日期：2026-07-17
>
> 对应提交：`8c8abea`（从干净 commit 出包）
>
> 发布类型：正式版
>
> 验证状态：已通过

## 本次更新

### 曦光控制台（Bloom Console）：视觉语言从零重建

- **曦光花田**：亮色主题为桃 / 鸢尾 / 天青 / 薄荷四色可见光斑缓慢漂移的晨曦光场，暗色为同构加浓的极光场；彻底告别灰白卡片与顶部胶囊导航。
- **单轴和谐构图**：专注页全部内容沿一条垂直中轴——REC 眉毛、Space Grotesk 渐变墨巨数（88–188px，11s 色相流动，回晖呼吸）、彗星进度轨、磨砂命令坞；有片段时账本以贴边全高右栏呈现，不再是浮动卡片。
- **彗星进度轨**：细密刻度基底上渐变彗星带发光彗头 3.4s 永续循环；运行时为青蓝色，暂停时冻结为红色彗星。
- **凝脂工艺控件**：宝石主按钮（渐变 + 内高光 + 内阴影 + 内描边 + 外发光 + 扫光 + 弹簧手感）、磨砂次级按钮、白瓷激活导航瓦片与靛青霓虹指示条；暂停语义全程为红色。
- **动效全量**：花田漂移、数字回晖、彗星循环、按钮扫光与弹簧、命令坞弹簧入场、状态点脉冲，reduced-motion 下全部退化。

### 字体系统换血

- 数字与展示字体更换为 **Space Grotesk**；中文更换为 **MiSans**；拉丁 UI 保留 Geist「锐界」/ Manrope「舒展」双档位；mono 细节沿用 JetBrains Mono。

### 暂停语义色

- 状态徽章、活动轨、片段账本、统计图表与小窗暂停态统一为 `--app-pause` 红色系；运行态保持绿色语义。

## 修复

- 渐变墨数字在翻转动画下会整位隐形（子节点 `filter: blur` 破坏 `background-clip: text`），已改为硬切显示。
- 亮色主题下小窗「暂停」按钮被通用按钮规则冲刷成白底（specificity 冲突），已补红色实心守卫。
- 亮色松石绿与琥珀金强调色加深至 4.5 对比度门禁之上。

## 升级提示

- 用户数据库、任务关联、计时记录、同步队列、小窗尺寸与字体偏好无需迁移。
- 可直接覆盖安装；便携版建议完整退出旧进程后替换可执行文件。
- 若机器上存在早期本地验收安装（commit 含 `fb9c060-dirty`），请用本包覆盖安装或改用便携版。

## 已知限制

- 番茄 To-do 仍只能确认上传接口 success，不能声明客户端未提供的独立云端回读或远端删除。
- 无已知阻断问题。

## 验证

- `npm run format:check`、`npm run typecheck`、`npm run lint` 全部通过；`npm test` 为 28 个测试文件、232 项测试全部通过。
- 从干净 commit `8c8abea` 执行 `npm run build` 与 `npm run dist` 出包；`scripts/smoke/ui-state-smoke.cjs` 与 `scripts/smoke/mini-ui-smoke.cjs` 全部通过（含六强调色 × 双主题对比度、红暂停令牌、彗星轨动画、四边吸附与原生拖拽释放门禁）。
- 两轮真实应用截图人工验收：亮/暗 × 专注四态 × 任务/统计/设置 × 小窗两态（`visual-review/bloom-console-v2/`）。
- 便携版启动验收通过：`appVersion === '0.11.6'`、`appCommit === '8c8abea'`、左轨道与专注台正常渲染、暂停令牌为红；安装版产物已生成，安装动作由用户执行。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.11.6-x64.exe` | `f380126cf6cdc82541e332529b2dec9849ed7d86cbfce53ad1c13b546ee3f720` |
| `FocusLink-0.11.6-x64-portable.exe` | `fa16ec5d85e22ab80025e0a095c0aa8a3bb9ac776fe0644c6bde90d52cf9d832` |

同时提供 `SHA256SUMS.txt`。下载后可在 PowerShell 执行：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\FocusLink-0.11.6-x64.exe'
```
