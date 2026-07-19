# FocusLink vX.Y.Z

> 填写与验证本模板时，所有 `npm` / `node` 命令均从仓库内 `FocusLink/` 执行。

> 发布日期：YYYY-MM-DD
>
> 对应提交：`COMMIT_SHA`
>
> 发布类型：正式版
>
> 验证状态：已通过

## 本次更新

### 主题一

- 用用户可感知的结果描述变化。
- 说明关键兼容性或迁移行为。

### 主题二

- 只记录已经实现并通过验收的能力。
- 任务改动要说明滴答连接策略、完成历史范围、排序与撤销/恢复路径。

## 修复

- 说明问题、现在的行为和数据安全边界。

## 升级提示

- 是否需要迁移设置或数据。
- 安装版与便携版的升级注意事项。

## 已知限制

- 明确列出；若无，写“无已知阻断问题”。

## 验证

- `npm run format:check`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run dist`
- 主窗、小窗、安装版和便携版 smoke
- 深浅主题人工验收：单一字体系统（Geist Variable + MiSans + JetBrains Mono；仪表字形 Inter Tight / Oswald）、四套计时仪表实时预览与 canvas 时间之带逐秒步进/变焦；核对无整页 blur/合成黑块、字号下限、对比度与 reduced-motion
- 统计快速展开/切换的 request-id 与计时 tick 性能 smoke
- 真实 UI “滴答任务完成 → 6 秒撤销 → 再完成 → 完成列表找回 → 恢复” smoke
- renderer 无响应受控恢复、Error 日志序列化与托盘监听幂等性验证
- 本版本涉及的真实外部服务临时数据测试

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-X.Y.Z-x64.exe` | `填写` |
| `FocusLink-X.Y.Z-x64-portable.exe` | `填写` |

同时提供 `SHA256SUMS.txt`。下载后可在 PowerShell 执行：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\FocusLink-X.Y.Z-x64.exe'
```
