# FocusLink v0.11.7

> 填写与验证本模板时，所有 `npm` / `node` 命令均从仓库内 `FocusLink/` 执行。

> 发布日期：2026-07-17
>
> 对应提交：`eab84bf`
>
> 发布类型：正式版
>
> 验证状态：已通过

## 本次更新

### 设计方向切换：安静的桌面时间仪器

- 废止 Bloom Console / Dawn Ledger 语言，锁定「安静的桌面时间仪器」。
- 视觉 token 全部重写：亮色 canvas `#F3F1EC`、深 teal accent `#286C63`、pause `#CC5145`；暗色同构 `#111411` / `#78C5B5` / `#EF6A5C`。
- 字体统一为 IBM Plex Sans（界面）+ IBM Plex Mono（计时数字，tabular-nums），中文回退 Microsoft YaHei UI / Noto Sans SC。
- 旧 accent 六色选择器与 font-profile 双档已归一中性化，将在设置页阶段移除。
- 状态色规则固化：暂停 = 红；继续/运行 = 主题强调色。

### 专注页 58/42 双区重建（阶段 1）

- 左区：当前任务意图、约 300px 细刻度 SVG 仪表（60 根哑光发丝刻度 + 细针，运行填充 accent、暂停转红）、84px 等宽主数字、暂停/结束双主操作（accent / pause / ink 三体系，hover / active / disabled 齐备），累计专注 / 累计暂停 / 总历时同一竖线对齐。
- 右区：纯文本「本次专注账本」，Segment 与暂停区间按时间交织、发丝线分隔，彻底去除 chip 与色块堆叠。
- 阶段 1.5 打磨：按钮视觉重量收敛、8 倍数节奏、鼠标惯性跟随环境光场（lerp 0.08、反向视差、失焦停驻、遵循 reduced-motion）。

### 小窗状态色规则对齐

- 小窗「开始 / 继续」主按钮由 ink 体系改为 accent 体系（规则：继续/运行 = 主题强调色）；暂停键保持语义红。
- 小窗展开/收起尺寸与显示信息不变。

## 修复

- 小窗暗色主题下「继续」按钮误用 ink 底色，现已与状态色规则一致；数据与计时逻辑不受影响。
- 根 README 与后端索引中「最近正式版 v0.11.4」「v0.11.6 仅源码迭代」等滞后表述修正为已发布口径；小窗时间 31px 更正为 30px。

## 升级提示

- 无需迁移设置或数据；计时、任务关联与状态机逻辑零改动。
- 安装版覆盖安装即可；便携版直接替换可执行文件。

## 已知限制

- 本版为视觉重构阶段 1：仅专注页完成重建；任务页、统计页、设置页与专注小窗仍为旧排版，将按阶段陆续重构。
- 设置页的旧 accent 六色选择与 font-profile 双档目前为中性化显示（选择不再改变配色），将在设置页阶段正式移除。
- 滴答 / TomaToDo 同步路径本版无改动。

## 验证

- `npm run format:check`
- `npm run typecheck`
- `npm run lint`
- `npm test`（232 项）
- `npm run build`
- `npm run dist`
- 主窗 UI smoke（打包产物四态 + 对比度 + 溢出断言）：通过
- 小窗 UI smoke（展开/收起 × 运行/暂停 × 亮/暗 + 贴边收放 + 原生 move-loop 释放门槛）：通过
- 安装版与便携版启动验证：win-unpacked 冒烟通过；便携版启动抽查通过

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.11.7-x64.exe` | `7be8e3b6b16ff033c7389103b093dfccd5208e981dab0521658cbc39b50c01bd` |
| `FocusLink-0.11.7-x64-portable.exe` | `d384b4bf93c26106a63794c73ebb29a7fe994c8ac6000557c08f5af3d1fc18c1` |

同时提供 `SHA256SUMS.txt`。下载后可在 PowerShell 执行：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\FocusLink-0.11.7-x64.exe'
```
