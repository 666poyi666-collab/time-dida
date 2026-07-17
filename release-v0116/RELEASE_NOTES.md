# FocusLink v0.11.6

> 发布日期：2026-07-17
>
> 对应提交：`77dc1b4`（从干净 commit 出包）
>
> 发布类型：正式版
>
> 验证状态：已通过

## 本次更新

### Aurora Ink 视觉语言彻底重建

- 抛弃顶部胶囊导航，改为约 76px 左侧垂直轨道：顶部品牌、图标+标签四入口导航（激活项带强调色底、左侧指示条与受控光晕）、底部计时状态胶囊。
- 亮色主题是主角：冷瓷白画布上两片超大虹彩柔光缓慢漂移，白瓷工作面配材质阴影与顶部彩色 edge light，主操作为浓郁 accent 渐变加 `--shadow-glow-accent` 发光，计时数字放大到 88–148px（Geist、tabular-nums、收紧字距）。
- 暗色主题完整同构：曜黑画板承载同一套光场，发光更浓。
- 任务工作台、统计统一分析画布、设置面板与迷你小窗按同一瓷面+彩色边缘光配方重建；全应用继续禁止 backdrop-filter，reduced-motion 下持续动画全部停用。

### 暂停语义色由琥珀改回红色

- 状态徽章、计时活动轨、片段账本、统计图表与小窗暂停态统一使用 `--app-pause` 红色系与 `--shadow-glow-pause` 光晕；运行态保持绿色语义。
- 主窗「暂停专注」与小窗「暂停」按钮均为红色实底发光；「继续专注」保持品牌 accent。

### Geist 默认字体与虹彩图标

- 新安装默认使用 Geist「锐界」主导排印，Manrope「舒展」保留为设置可选项；已保存偏好的用户不受影响。
- 应用与托盘图标重建为虹彩 BrandMark 几何；键盘焦点环仅在 Tab 进入键盘导航后显示。

## 修复

- 亮色松石绿（`12 142 94`）与琥珀金（`186 110 26`）强调色对白字未达到 4.5 对比度门禁，分别加深为 `10 132 86` 与 `168 98 22`，设置色板同步更新。
- 修复上一轮中断遗留的任务页 JSX 未闭合与统计页未使用函数，恢复全量 typecheck 通过。

## 升级提示

- 用户数据库、任务关联、计时记录、同步队列、小窗尺寸与字体偏好无需迁移。
- 可直接覆盖安装；便携版建议完整退出旧进程后替换可执行文件。
- 若机器上已存在 v0.11.6 的本地验收安装（commit 含 `fb9c060-dirty`），请用本包覆盖安装或改用便携版，以获得 Aurora Ink 界面。

## 已知限制

- 番茄 To-do 仍只能确认上传接口 success，不能声明客户端未提供的独立云端回读或远端删除。
- 无已知阻断问题。

## 验证

- `npm run format:check`、`npm run typecheck`、`npm run lint` 全部通过；`npm test` 为 28 个测试文件、232 项测试全部通过。
- 从干净 commit `77dc1b4` 执行 `npm run build` 与 `npm run dist` 出包；`scripts/smoke/ui-state-smoke.cjs` 与 `scripts/smoke/mini-ui-smoke.cjs` 全部通过（含六强调色 × 双主题对比度、红暂停令牌、四边吸附与原生拖拽释放门禁）。
- 主窗四页 × 深浅双主题 × 计时四态 × 任务选择器、小窗两态 × 双主题共 26 张视觉走查截图逐张人工验收（`visual-review/redesign-0116/`）。
- 便携版启动验收通过：`appVersion === '0.11.6'`、`appCommit === '77dc1b4'`、左轨道与专注台正常渲染、暂停令牌为红；安装版产物已生成，安装动作由用户执行。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.11.6-x64.exe` | `013c8be766eb82a3bbf1e92c2a923fe45010fb4e743080e5f0f515ef64557dd7` |
| `FocusLink-0.11.6-x64-portable.exe` | `6a817c27ad3bceadce2245d98abc48bab41891db5bb2833f68d63ffcb0eff39f` |

同时提供 `SHA256SUMS.txt`。下载后可在 PowerShell 执行：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\FocusLink-0.11.6-x64.exe'
```
