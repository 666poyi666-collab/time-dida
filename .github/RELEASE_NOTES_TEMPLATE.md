# FocusLink vX.Y.Z

> 发布日期：YYYY-MM-DD
>
> 对应提交：`COMMIT_SHA`
>
> 发布状态：草稿 / 已验证待发布 / 已发布（只保留真实状态）

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
- 精密明亮深浅主题与专用字体人工验收：中文使用内置 `Noto Sans SC Variable`，数字与拉丁使用内置 `Geist Variable`，`JetBrains Mono` 仅用于诊断和代码；同时核对只有受控状态光、无大面积 blur/光晕，并检查字号下限、对比度与 reduced-motion
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
