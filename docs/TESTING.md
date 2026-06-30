# 测试指南 (TESTING)

> 版本：v0.1.7
> 测试框架：Vitest 2（`environment: node`，`globals: true`）

## 1. 运行测试

```bash
# 单次运行（CI / 验证）
npm test

# watch 模式（开发）
npm run test:watch
```

配置文件：[vitest.config.ts](../vitest.config.ts)

```ts
test: {
  environment: 'node',
  include: ['tests/**/*.test.ts'],
  globals: true,
}
```

路径别名与主项目一致：`@` → `src/`，`@shared` → `shared/`。

## 2. 测试覆盖

| 文件 | 覆盖范围 |
| --- | --- |
| `stateMachine.test.ts` | 状态机所有合法/非法转换、`getToggleEvent`、`isTerminal` |
| `timeModel.test.ts` | 三时间模型核心场景（45+5+45 → 90/5/95）、多次暂停累加、时间回退保护 |
| `hotkeys.test.ts` | 快捷键格式校验（`isValidAccelerator`） |
| `paneLayout.test.ts` | 左右分栏拖拽布局计算 |
| `historyStats.test.ts` | 历史统计聚合 |
| `syncStatus.test.ts` | 同步状态推导 |

## 3. 核心测试场景

### 3.1 状态机

合法转换：

- `idle + START -> running`
- `running + PAUSE -> paused`
- `paused + RESUME -> running`
- `running + STOP -> finished`
- `paused + STOP -> finished`
- `finished + RESET -> idle`

非法转换被拒绝（`ok: false`），如 `idle + PAUSE`、`finished + START`。

`getToggleEvent`：idle→`START`、running→`PAUSE`、paused→`RESUME`、finished→`null`。

### 3.2 三时间模型

核心验证：专注 45 分钟 → 暂停 5 分钟 → 专注 45 分钟 → 结束

- `activeElapsedMs` = 90 分钟（不含暂停）
- `pauseElapsedMs` = 5 分钟
- `wallElapsedMs` = 95 分钟（自然跨度）

并验证：

- 多次暂停累加正确
- 时间回退保护（不出现负时间，触发器 `RAISE(ABORT)`）

## 4. 纯函数测试策略

测试只覆盖**纯函数**与**数据模型**，不启动 Electron / 不连数据库：

- `stateMachine.transition()` 是纯函数，直接断言输入输出
- 时间模型通过模拟 `activeElapsedMs` 累加验证算术
- 快捷键校验只测格式字符串，不测真实 `globalShortcut.register`

这保证测试快速、稳定、无副作用，可在 CI 直接运行。

## 5. 端到端验证（手动）

自动化测试不覆盖 Electron 主进程集成，以下场景需手动验证（参考 `docs/archive/PACKAGE_EVIDENCE_REPORT.md` 的验证方法）：

1. `npm run dev` 启动开发模式，主窗口 + 小窗视觉正常
2. 全局快捷键开始/暂停/继续/结束全链路（idle→running→paused→running→finished）
3. 计时数字每秒刷新，暂停时不增加，继续后继续增加
4. 关闭主窗口最小化到托盘，主进程继续计时
5. 托盘菜单「退出」真正退出
6. dida CLI 任务能读取，任务树折叠/展开/搜索正常
7. 主题切换（深色/浅色 + 6 种 accent）正常
8. `npm run build` 类型检查 + 构建通过
9. `npm run dist:win` 生成安装包 + 免安装版

## 6. 数据库写入验证

如需验证打包版数据库写入，可参考 `scripts/selftest.ts` / `scripts/crash-recovery.ts`（构建产物在 `dist-selftest/`），用 Electron 二进制以 NODE 模式运行查询 `focuslink.db`，校验：

- `Segment1.active + Segment2 增量 = Session.active`
- `Pause.duration = Session.pause`
- `ended_at - started_at = Session.wall`

## 7. 构建与打包验证

```bash
# 类型检查 + 构建（必须通过）
npm run build

# 打包 Windows（生成安装包 + 免安装版）
npm run dist:win
```

`npm run build` 执行 `tsc --noEmit && vite build`，TypeScript 严格模式（`strict: true`）。任何类型错误都会导致构建失败。

打包产物：

- `release-v017/FocusLink-0.1.7-x64.exe`（NSIS 安装包）
- `release-v017/win-unpacked/FocusLink.exe`（免安装版）

## 8. 代码格式化

```bash
# 格式化 src/electron/shared/tests
npm run format

# 检查格式（不修改文件，CI 用）
npm run format:check
```

配置：[.prettierrc](../.prettierrc)、[.prettierignore](../.prettierignore)

## 9. 相关文档

- [架构说明](ARCHITECTURE.md) — 测试在分层中的位置
- [产品规格](PRODUCT_SPEC.md) — 功能清单
- 历史验证报告见 `docs/archive/PACKAGE_EVIDENCE_REPORT.md`、`EVIDENCE_REPORT.md`
