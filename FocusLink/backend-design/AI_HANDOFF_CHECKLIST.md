# 后端 AI 接手清单

> 所有 `npm` / `node` 命令默认从仓库内 `FocusLink/` 执行。

## 开始前

- [ ] 完整阅读 [BACKEND_SPEC.md](BACKEND_SPEC.md) 和 [TEST_AND_RELEASE.md](TEST_AND_RELEASE.md)。
- [ ] 阅读 [../frontend-design/FRONTEND_SPEC.md](../frontend-design/FRONTEND_SPEC.md) 的用户可见状态与交互。
- [ ] 查看 `git status --short`；不重置或覆盖用户已有变更。
- [ ] 用 `rg` 找到当前类型、IPC、Provider、数据库和测试，不创建平行实现。
- [ ] 确认测试使用隔离目录，不接触真实 FocusLink、滴答或番茄用户数据。

## 契约变更

- [ ] 类型、`shared/ipc/api.ts`、preload、IPC handler、调用端和测试一起更新。
- [ ] 设置局部更新不会覆盖其他设置域；异步旧响应不会覆盖新请求。
- [ ] 主窗、小窗和托盘收到同一事实广播。
- [ ] 托盘/快捷键/snapshot 监听初始化幂等；重复 ready 事件和设置变更不会累加监听。
- [ ] IPC 返回可证明的结果；空 id、`undefined` 和解析失败均为错误。
- [ ] 统计详情用 request id + 当前 session id 废弃旧响应；统计页不订阅会每秒变化的完整 snapshot。

## 计时与数据

- [ ] 专注/暂停/总历时三种时间没有混用。
- [ ] 暂停、继续、结束和崩溃恢复覆盖短专注及 45+5+45 场景。
- [ ] schema 迁移幂等且事务安全；删除协调队列和外部记录。
- [ ] 未经授权不读取或修改用户真实数据库。

## 任务与同步

- [ ] 任务工作台固定滴答语义，先探测 CLI、不可用时才回退已登录 OAuth；UI 不将连接方式冒充任务来源。
- [ ] 完成与取消完成可逆；checklist 只修改父任务目标 item。
- [ ] `tasks.refresh` 默认只读活动任务，完成历史按需限定 30/90/365 天；活动状态不被历史端点覆盖。
- [ ] `tasks.refresh` 保留实际连接方式与精确错误；`tasks.setCompleted` 返回回读后的规范 Task，并正确写入/清空 `completedAt`。
- [ ] dida Open API 恢复桥只在 CLI 不支持时使用，token 不进入日志、IPC 或诊断，并在写后 GET 验证。
- [ ] dida 写入继续使用 argv、comment-first、marker 幂等和空输出失败。
- [ ] 队列 payload 固定 Provider，限流退避不消耗永久重试次数。
- [ ] 番茄本地写入、上传接口确认与独立云端回读/远端删除没有混为一谈；未识别仍归入“学习”。
- [ ] 番茄手动同步仅在客户端未运行时使用参数数组和 `--remote-debugging-port=0` 按需启动，目标通过标题与特征 API 身份校验后才使用。
- [ ] 番茄已普通运行但无桥时绝不杀进程/重启；后台启动与周期重试绝不擅自启动外部应用。
- [ ] 番茄桥接启动/发现改动已运行无写入的 `npm run smoke:tomatodo:bridge`，验证标准路径、身份校验与不终止已运行普通实例。
- [ ] 真实外部验证使用临时任务/记录，并在结束后清理。
- [ ] FocusLink 跨设备账本与 dida/TomaToDo 队列保持独立；completed bundle 仍只发送已结束 session，不发送第三方凭据、`cloudFocusId` 或桌面本地设置。
- [ ] 实时控制平面以服务端 revision 为权威；command id 重放、id 复用、expected revision 冲突、错误 session、非法迁移和单账号隔离均有测试。
- [ ] finish/abort 原子闭合 segment/pause 并写入现有 completed ledger；进程重启保持活动时间边界与命令幂等，旧 v1 测试存储可迁移。
- [ ] 长轮询有上限，客户端断开会释放 waiter；移动端切账号/页面隐藏/卸载会取消旧请求，不让旧账号快照回填。
- [ ] Android 通知/Tile 只排队带 session/revision 的 native command，原生层不推进计时或在云端确认前翻转状态。
- [ ] 账本 `opId` 重放幂等、revision 冲突、cursor 分页、Bearer 鉴权、CORS 与 1 MiB 上限有契约测试；completed bundle 不携带活动会话字段。
- [ ] 拉回新会话使用单事务导入且不自动触发第三方副作用；远端更新/删除未有显式策略时报告冲突，不静默覆盖。

## 稳定性与诊断

- [ ] 主/小 renderer 的 `unresponsive`、`responsive`、`render-process-gone` 有受控恢复；5 秒 grace 与每 60 秒最多 3 次的预算有测试或可重复验证。
- [ ] renderer 重载时主进程计时和会话不丢失，不进入无界恢复循环。
- [ ] logger 能序列化 Error name/message/stack/cause、bigint 与循环对象，未捕获异常不再只留 `{}`。

## 交付前

- [ ] 更新 `BACKEND_SPEC.md`、根 [CHANGELOG.md](../../CHANGELOG.md) 和当前 Release 正文源。
- [ ] 完成 [TEST_AND_RELEASE.md](TEST_AND_RELEASE.md) 全部门禁。
- [ ] 多端改动额外构建 Web/PWA 与测试云；Android 必须通过 Capacitor sync、unit/lint/assemble、前台通知/Tile instrumentation 与华为/小米双机 smoke。
- [ ] 真实 UI smoke 完成“完成 → 撤销 → 再完成 → 完成列表找回 → 恢复”并清理临时任务。
- [ ] release 目录只有两个 exe、SHA256 和 Release notes。
- [ ] Git commit 元数据干净后重新构建正式包，校验 hash。
- [ ] 推送 main/tag 后创建 GitHub Release、附加两个 exe 与 SHA，并回读核验。
- [ ] 未创建 GitHub Release 时，版本不得宣告“已发布”。
