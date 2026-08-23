# Development Log

## 2026-08-22

- 修复番茄 To-do 云上传与手机投递状态混用：bridge 现在分别返回 `uploadConfirmed` 和 `phoneSyncConfirmed`。
- 电脑版未连接手机时，记录进入 `phone-pending` durable queue；云上传成功不再清掉手机投递意图。
- 已存在 marker 仍可重试手机投递；补充 15 项 bridge、14 项同步服务和 24 项本地适配器测试，专项合计 53 项通过。
- 小米真机复现并修复番茄 To-do 锁屏待机下的应用级 DNS 失败；恢复后台联网后，手机日志形成真实云文件下载回执。
- 验证番茄 To-do 专注云投递存在 7 天窗口和一次性批次覆盖语义；桥接层不再把超窗记录标成上传确认，并新增稳定排错条目 `FL-SYNC-009`。

## 2026-08-23

- 建立 FocusLink 自有任务库的第一阶段：新增本地清单表，滴答清单只作为一次性导入来源；导入后的任务以 `local` 身份发布到 FocusLink 账号快照。
- 桌面任务刷新优先读取 FocusLink 本地任务，避免每次把滴答清单当作主数据源；保留滴答 CLI/OAuth 作为迁移入口。
- 迁移保留滴答清单的父子任务层级：新增 `tasks_cache.parent_id` 并为旧数据库提供幂等迁移；重复导入按外部标识去重，不复制任务。
- 移动端完成首轮视觉重排：手机优先突出计时器与主操作，收纳次要同步信息；平板使用独立双栏/顶部导航布局；通过 `data-device-tier` 自动区分 phone/tablet/watch。
- 替换 Android Capacitor 默认蓝色启动图为 FocusLink 深色 F/L 品牌启动图，覆盖横竖屏密度资源。
- Android 构建环境补齐 Microsoft OpenJDK 17；Gradle 增加国内 Maven 镜像首选，解决本机访问 Google Maven TLS 握手失败。
- Android Gradle 允许当前 Windows 中文路径，解决 Android 构建工具的非 ASCII 路径保护误报。
- 恢复 Electron 31.2.1 Windows 二进制；根桌面 TypeScript 编译排除独立 `cloud/mcp` 子项目，避免 Cloudflare Worker 类型污染桌面构建。
- 版本提升至 `0.12.88/1288`；APK、Windows 安装器和便携版均已生成并完成哈希回读。Windows 安装器已静默覆盖安装，三项版本回读一致并重启。
- 移动端任务页新增 FocusLink 云端任务创建入口；写回成功后立即使用服务端 revision 更新本机快照与账号缓存。
- PC 任务刷新增加账号云快照合并，按任务 ID 和 `updatedAt` 合并移动端任务后再发布；版本提升为 `0.12.89/1289`。
- PC 与移动端均新增 FocusLink 清单创建；移动端支持完成/恢复任务并写回同一账号 revision。
- 最终本地验收版本提升为 `0.12.90/1290`。
- 升级时检测旧 loopback 凭据：非正式账号凭据会被安全清除并切换到官方账号入口，停止无限重试失效本机地址。
- 最终安装版本提升为 `0.12.91/1291`。
- 从干净源码提交 `f1361e9` 重建 0.12.91 安装器、便携版与 APK；Windows 已覆盖安装并回读干净构建标识，最终 SHA256 已写入发布目录。
- 华为 DBY-W09 真机截图发现 640 CSS 像素竖屏被强制套用顶部导航和双栏；修正为大屏单栏与底部浮动导航，760+ 或横屏才启用宽屏双栏。
- 真机视觉修复版本提升为 `0.12.92/1292`。

## 2026-08-20：测试凭据门禁标记统一

- 将上游错误响应测试中的确定性假令牌改为带 `wrong-test` 标记的合法格式测试值。
- 让全局秘密扫描门禁能够区分明确测试夹具与潜在真实凭据，同时不降低生产代码检查强度。

## 2026-08-20

- 从 `foxlink-cloud-mcp` 导入云端代码到 `FocusLink/cloud/mcp`，排除旧构建数据库和嵌套项目清单。
- 将已弃用的 `McpAgent` 会话 Durable Object 升级为 `createMcpHandler` + MCP SDK Server 2.0 无状态处理器。
- 保留旧客户端的无状态兼容通道，新增 MCP 2026-07-28 `server/discover` 合同测试。
- 保留业务同步 Durable Object、D1、OAuth 和现有生产 Worker 身份。
- 完整测试 103 项通过。
- 升级 Cloudflare Vitest Pool 以移除旧 Wrangler/Miniflare/undici 安全风险，需重新执行完整测试确认兼容。
