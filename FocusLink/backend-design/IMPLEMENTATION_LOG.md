# FocusLink 实施日志

## 2026-07-30 · v0.12.71 手机与平板工业时间仪器重构

- 移动 renderer 改为深墨设备框架、暖白连续工作面与翡翠校准线；四入口、真实计时/账本/任务/同步语义均未改变。手机首屏按主读数、任务输入、112px 时间之带顺读，深色粘底操作条固定在 68px 底部导航之上。
- 平板从 620px 起使用 80px 左侧导航轨；华为 DBY-W09 的 640 CSS-pixel 竖屏不再被实时上下文侧栏压缩，760px 起才展开双栏。统计结论舞台、任务空态与设置外观规格表共享同一仪器框架，亮暗主题均有独立映射。
- Android 原生业务与系统表面未修改：保留华为 `huawei-live-capsule`、小米系统通知路径、OPPO 手表 renderer 和 Windows 两态 mini。响应式合同更新为 620px 单列/760px 双栏；本轮四端安装矩阵在构建后补录。
- Windows 403 根因为 canonical GET 无命令正文而成功，但 live command 与 task snapshot 仍携带 legacy 本机 UUID；Account DO 将其识别为与 `fl2` 凭据不匹配的设备伪装并拒绝。`getDeviceSyncRuntimeConnection`、Sync v2 与任务快照现统一从 token 解析 `device-<publicId>`，单元回归同时断言实时连接和任务发布正文。
- 空闲云端的 start 遇到网络失败或 401/403 时，桌面退出 live fact source 并启动本地 TimerManager；已有 running/paused 云端会话不允许降级。日志保留 Error name/message/stack 与 `credential-rejected` / `transport-unavailable` 分类，任务快照错误不再抛出普通对象。
- 桌面时间之带彻底删除旧的 3px 锯齿列、齿端浮尘和内部颗粒分支，暂停/结束画面中的绿色历史段也固定为连续磨砂玻璃；设置九仪表 smoke 新增逐卡预览边界断言，覆盖指针表圈、游标标尺与制图描线的裁切回归。

## 2026-07-30 · v0.12.70 云端三端同步与 MCP 修复

- 桌面 correction 使用已结束账本时间生成稳定 payload/opId；同步前只修复旧缺陷留下的 correction outbox/ACK conflict，保留操作审计。Account DO 仅把 createdAt 漂移视为 semantic duplicate，并要求历史 conflict 同时满足无 base、纯 revision 和双侧内容匹配才关闭。
- Electron 运行期不再启动内嵌同步服务、ADB reverse 或 Android 自动配对。手机/平板仍直接连接 canonical HTTPS Account DO；独立 staging Android identity 和硬编码 staging endpoint 已移除，候选 endpoint 只能由构建参数注入。
- 私有 Account DO records DTO 返回已校正 session、任务、segments、pauses、结束时间及 cloud live，删除 deviceId、note、tags、reason 和凭据。cloud MCP 的 status/today/list 工具直接读取该 DTO；D1 保留为同步诊断。
- FocusLink-only OAuth 轮换使用临时 capability：OAuth Worker 内计算并登记新 HMAC，脚本只更新 `foxlink-cloud-mcp` secret，验证 introspection/readyz 后删除 capability；不轮换 Journal、Watch、Gateway 或 App。生产 OAuth 恢复到健康版本 `c5be709d-c084-49d2-8e54-23760a06b51e`，轮换端点在 capability 销毁后返回 404。
- Account DO 冷启动增加 `account_schema_version` 常量行快路径，避免大账户每次唤醒重放 schema/index DDL而触发 Cloudflare 免费层行读取上限；live 完成同时发布 v1 bundle 与 v2 ledger/metadata，并有界补迁移历史 v1-only 完成账本。生产 Version ID 为 `c17d90b8-2501-4e0a-b578-cd0505b8e9db`。
- 生产实机闭环在 Windows FocusLink 关闭时完成：小米发起、华为暂停、小米继续、华为结束；华为再发起、小米观察并结束。最终 live 为 idle、revision 62；两端看到同一两条账本（小米 2 segments/1 pause，华为 1 segment/0 pause）。Windows 重启和第二轮自动同步后两条记录各导入一次，既有 correction outbox/open conflict 基线不增长。
- ChatGPT 经 FocusLink 云端 OAuth 实际调用 status/today/list；在本地 FocusLink、两个 Foxlink 服务及 8770/8878 监听全部关闭时，三个工具仍从 `focuslink-account-do` 返回 fresh、revision 62、live idle 和当天 2 条完整记录。生产移动域名 cloud MCP Worker Version ID 为 `5ce44467-e209-4780-8cc4-72297470ed48`。验证后独立 Foxlink 服务恢复 Running/Automatic。Windows、小米、华为与 OPPO 手表均实装并回读 `0.12.70/1270`；物理关闭整台 Windows 的验收未执行，不能把桌面进程关闭描述为整机关机。

## 2026-07-29 · v0.12.69 中央 canonical identity-focus 对齐

- FocusLink observation 在中央签名 registry 中固定使用 `productId=identity-focus` 与完整 HTTPS `/authority/identity-focus` audience；内部 named entrypoint 仍为 `FocusLinkAuthorityObservation`，路径仍为 `/internal/authority-observation/v1`。
- staging Wrangler 固定 canonical audience，独立 capability 只以 Cloudflare secret 配置；默认 Worker ingress、错误 capability/audience、缺依赖、过期或额外字段继续 fail-closed。
- 首次 staging 两跳暴露空闲 TTL 缺陷：旧 schema 对 `state_hash` 设唯一约束，且 GET 只读 snapshot，导致相同业务状态无法生成后续 verification checkpoint。现以事务化 DO schema v2 迁移移除该唯一约束；GET 每次做只读依赖 probe，有效 snapshot 不写库，只有缺失/损坏/到期才递增 checkpoint revision。
- 第二次 staging 探测未进入 Account DO：产品曾额外要求 `fao_` 固定格式，而中央 capability registry 使用统一的 32–512 字符安全 token。两端现共享同一格式校验，仍保持独立 secret、常量时间比较和不得复用 device/MCP/pair 凭据的约束。
- 本轮跨端候选提升为 `0.12.69/1269`。远端 staging、中央两跳、真实手机/平板/手表和三轮 PC-off 必须在源码提交后独立验收；未全部完成前不得写 `supportsPcOff=true`。

## 2026-07-28 · v0.12.68 私有 authority 与 canonical adapter 收口

- `cloudflare/worker.ts` 改为无公网入口的 service-binding authority adapter；只接受 canonical `/sync/v2/*` 与 `/sync/v1/pair/*`。pair offer 将 fl2 credential 转交 DO 复验 `devices:manage`，公网 owner session + CSRF 仍由 foxlink-cloud-mcp 负责。
- Account DO 绑定 authenticated device 与 body/mutation `deviceId`；live/task scope、伪造/过期/撤销/跨账号 token 负测齐全。V2 change feed 使用与 foxlink adapter 一致的 1,100,000-byte cap 二分选页，cursor/watermark 只推进到返回尾。
- Node personal-cloud production entry、Docker API service、静态 bearer account 和数据卷硬退役；Node 只保留回环合同测试。`/readyz` 检查三项两两不同的 service secret 并执行 DO SQLite probe。
- 手机、平板、手表响应式比例与 Android Keystore-first 恢复已实现；本地 viewport screenshot 与样式契约覆盖八位计时、双按钮、完整错误/设备字段及横向 overflow。
- `focus_guard_state_v1` producer golden fixture 与 Java consumer 完全一致；因同账号 32-byte root provisioning 尚不存在，生产 publisher 保持阻断，不创建第二 authority 或明文状态面。
- 本轮只做本地实现、dry-run 和自动化；未部署、未读取/复用远端 secret，最终 v0.12.68 ADB 覆盖安装与 PC-off 三轮验收未执行，`supportsPcOff=false`。

## 2026-07-28 · v0.12.67 Android 安全凭据恢复

- 手机和手表共用 `restoreOrMigrateNativeFocusConnection`：优先读取 Android Keystore；旧版仅有 WebView credential 时，原生写入成功后才清理浏览器副本。
- 手表配对流程补齐原生 `configureConnection` 与启动恢复；手机配对、手工连接的提交顺序同步收紧，Keystore 失败不再产生假保存。
- 新增恢复/迁移/失败保持和三类视口 CSS 契约测试。当前真机上已经被 v0.12.66 删除的旧手表凭据无法凭空恢复，需重新配对后完成活动态视觉验收。
- 本轮不部署、不读取远端 secret，`supportsPcOff` 继续为 false。

## 2026-07-28 · v0.12.66 canonical 云端专注数据面

- Account Durable Object 增加内部 `GET /internal/mcp/v1/focus/summary` 投影；独立 MCP service credential 与设备 token、OAuth token 分离，公网 OAuth 仍由 canonical foxlink-cloud-mcp 验证 `focuslink:read`。
- 投影从 `focus_ledger_v2` 与 `focus_metadata_v2` 生成次数、任务、时长、起止、最近记录和 `lastVerifiedAt/freshness`，不输出 note、tags 或任何凭据。
- live/task 公网路径迁移到 `/sync/v2/live*` 与 `/sync/v2/tasks`；旧 `/v1/*` 保持退休，DO 内部路径增加真实设备 credential、scope 与 `deviceId` 绑定。
- 当前只完成本地实现和门禁；未部署、未读取远端 secret，`supportsPcOff` 维持 false。

## 2026-07-27 · v0.12.65 专注时间之带磨砂材质

- running 专注材料从确定性锯齿、浮尘和内部颗粒改为全高半透明磨砂玻璃；以柔和内雾、宽幅漫反射和薄边缘高光保留质感及刻度可读性，去除长条展开后的毛边与分节感。
- paused 继续调用原有绿色历史材料、红色缺口、底部疤痕和 `frontier-ash` 消散分支；修正视觉审计中仍期待旧 `interval-trace` 且禁止疤痕的过期断言，不改变暂停画面。
- 自动化通过 format/typecheck/lint、73 文件 497 项测试、Electron 隔离回归、Android 单测/lint、安装版/便携版 UI、两态 mini 与四状态织带审计；依赖审计为 0 漏洞。
- 三端实装：Windows 静默覆盖后注册表、EXE 与健康接口均回读 `0.12.65`；小米 22041216C、华为 DBY-W09 均 `adb install -r` 成功并回读 `0.12.65/1265`。本轮未改移动/手表产品代码，OPPO 手表门禁不适用。

## 2026-07-26 · Foxlink 独立 MCP 最终私有接入

- 独立 `PoyiFoxlinkMcp` Windows 服务安装并运行于 `127.0.0.1:8770/mcp`；业务 API 仍由
  FocusLink Electron 在 `127.0.0.1:18770` 提供，MCP 不直接读取 SQLite。
- `FoxlinkSecureMcpTunnel` 以独立 Tunnel ID 连接，不依赖 PersonalMcpGateway；健康端口
  `127.0.0.1:8878` 返回 ready。
- ChatGPT Plus Developer Mode 已创建 Foxlink 私有应用并连接成功，不经过开发者实名认证或
  公开 App 发布。真实只读调用返回 `0.12.60 / revision 22 / paused`。
- 真实写入依次返回 `revision 23 / running` 和 `revision 24 / paused`；复用同一 pause
  `requestId/commandId` 再次调用仍返回 `revision 24 / paused`，幂等结果重放通过。
- 打包复验发现原 v0.12.60 安装包生成早于业务 API 合入，因此递增到 `0.12.61 / 1261` 并重新
  覆盖三端。正式 Windows 进程监听 18770，MCP 回读 `0.12.61`；ChatGPT 最终只读调用返回
  `0.12.61 / revision 28 / idle`，不再依赖开发态进程。

## 2026-07-26 · v0.12.54～v0.12.60 Sync v2 连续实施

- 0.12.54：建立三类实体、稳定 deviceId、租约 Outbox、base snapshot、bootstrap manifest 与三类 epoch。
- 0.12.55：加入 metadata 三方合并、tagId 操作语义、tombstone、90 天 stale 水位和 graveyard 防复活策略。
- 0.12.56：完成 `fl2_` 独立设备令牌、HMAC pepper、scope、配对重放保护、撤销与轮换。
- 0.12.57：接入冲突/回收站查询与标准 mutation 解决、恢复、用户层永久删除；ledger correction 强制原因。
- 0.12.58：创建并部署 Cloudflare Queue；厂商推送凭据缺失时只记录 `credential-missing`，轮询保持权威。
- 0.12.59：完成 R2 AES-256-GCM 快照目录和 maintenance generation 恢复代码；账户级 R2 未启用，Wrangler 返回 10042。
- 0.12.60：Node/Docker 与 Cloudflare 核心 v2 契约统一，桌面/移动双栈客户端、管理界面、公网与容器回归收口。
- 以上版本仅是迁移检查点，连续完成后统一生成 0.12.60 本地候选，不曾在中间检查点停止或分发。

本日志长期记录有产品意义的实现决策与验证结果，不记录逐条终端命令、访问令牌、完整配对载荷、私人任务正文或敏感设备信息。版本发布历史仍只写入根 `CHANGELOG.md`。

## 记录格式

每条记录包含日期、需求 ID、涉及子系统、关键决策、兼容性变化、三端验证矩阵、测试结果、部署结果和遗留风险。

## 2026-07-26 · v0.12.53 Windows 原位覆盖安装

- v0.12.52 证明旧卸载器既可能返回任意非零值，也可能完全不删除旧 EXE。重试耗尽后不再依赖旧卸载器副作用：当前用户进程已由 `customInit` 有界关闭，新安装器直接覆盖注册表来源的同一安装目录，不执行目录删除。
- 版本递增为 `0.12.53 / 1253`，最终验证旧版覆盖、同版本重装、数据哈希、公网同步、双 Android 覆盖与三端回读。

## 2026-07-26 · v0.12.52 Windows 覆盖安装事实判定

- v0.12.51 仍停留在重试，证明旧卸载器返回码不稳定。恢复宏改为在重试耗尽时只检查注册表来源 `$installationDir` 下产品 EXE 是否已消失；消失则继续安装，存在则保持失败。
- 版本递增为 `0.12.52 / 1252`；旧卸载器未移除 EXE，改由 v0.12.53 原位覆盖。

## 2026-07-26 · v0.12.51 Windows 覆盖安装无删除恢复

- v0.12.50 不再直接退出 2，但在 `RMDir /r` 处理仍被旧卸载器占用的安装根目录时超时。恢复宏删除递归删除动作，只在注册表来源目录的产品 EXE 已消失时归一退出码 2，新安装器随后覆盖同一路径。
- 版本递增为 `0.12.51 / 1251`；实际重试退出码不稳定导致恢复未触发，由 v0.12.52 继续修复。

## 2026-07-26 · v0.12.50 Windows 覆盖安装闭环

- v0.12.49 覆盖仍失败，原因是最终结果处理时旧卸载器已删除注册值。恢复判定回到仍持有注册表来源 `$installationDir` 的重试函数，只要求该目录下产品 EXE 已不存在，再清理残留并把已知退出码 2 归一为成功；任何产品 EXE 残留继续失败。
- 版本递增为 `0.12.50 / 1250`；真实覆盖在锁定目录删除处超时，由 v0.12.51 继续修复。
- 本轮明确不推送 `main`、不建 tag/GitHub Release，尽管补丁号达到集中上传节点；只保留本地四文件目录、APK 备份和完整证据。

## 2026-07-26 · v0.12.49 Windows 覆盖安装最终恢复

- v0.12.48 真实覆盖仍返回 2，证明 `customUninstallRetryExhausted` 不负责最终退出。恢复逻辑迁入 `customUnInstallCheck`：仅在退出码 2、注册卸载器父目录匹配 `$installationDir` 且产品 EXE 已消失时清零结果；残留 EXE 和其他失败继续退出 2。
- 版本递增为 `0.12.49 / 1249`；真实覆盖仍失败，未进入三端交付，由 v0.12.50 继续修复。

## 2026-07-26 · v0.12.48 Windows 覆盖安装收口

- 复现：停止全部 FocusLink 进程后，v0.12.47 同版本静默覆盖仍返回退出码 2，旧 payload 被删除但卸载注册项保留；四个用户数据文件哈希不变。
- 根因与修复：`customUninstallRetryExhausted` 对注册旧安装目录与新 `$INSTDIR` 做了脆弱的字符串等值门禁。删除该重复条件，保留“注册卸载器文件的父目录必须等于 `$installationDir`”作为实际删除边界，并更新 installer policy 测试。
- 版本：行为候选递增为 `0.12.48 / 1248`；真实升级仍失败，未进入三端交付，由 v0.12.49 继续修复。

## 2026-07-26 · v0.12.47 公网本地优先收敛版

- Cloudflare：新增 Worker 与账号级 SQLite Durable Object，生产自定义域名为 `https://focuslink-sync.pyzzgk.dpdns.org`。公网测试覆盖 opId/commandId 幂等与复用拒绝、旧 revision conflict、cursor 增量、任务快照、实时 start/pause/resume/finish 和重部署后持久性；Node/Docker 后端未替换，隔离容器门禁使用 API `28787`、Web `28080` 通过。
- 双 Android：Windows FocusLink 停止时，小米会话 `live_741d6676-1418-4670-9f9e-384035719dfe` 与华为会话 `live_4fbefe9e-0420-4b57-a86a-6f452f724693` 均完成开始、暂停、继续、结束；两者各生成 2 段/1 暂停并只入账一次。旧 Node cursor 收到结构化 `invalid_cursor` 后，两端从空 cursor 正确重建。
- 小米 0.12.60 补验：网络 ADB `192.168.1.84:5555` 恢复后覆盖安装并回读 `versionName=0.12.60 / versionCode=1260`；`https_localhost_0.indexeddb.leveldb` 和原生连接偏好在覆盖安装后保留。9 项适用的 Sync/runtime instrumentation 通过；PIP UI 用例被系统结束且未返回完成码，人工截图、华为专属和缺少真实云参数的用例不并入通过数。
- Overlay：以 0.12.45 为真机基线，小米 janky 14.04%→3.54%，华为 15.52%→3.43%，两端超过 100 ms 帧均为 0；运行态与拖动后截图、原始 `gfxinfo` 和结构化报告保存在 `.tmp/v01247-acceptance`。
- 小米系统表面：指定设备 `22041216C / xaga / HyperOS OS3.0.1.0.VLHCNXM / Android 15` 已确认协议 3 载荷被 FocusPlugin 解析，但日志在 `onInflateSuccess/onInflateFinish` 后出现 `onAuthFailed ... app.focuslink.mobile`，桌面与锁屏截图均无超级岛。结论为 OEM Focus allowlist/签名授权不满足，当前 ROM 对该包视觉不兼容；标准通知和 overlay 继续工作。
- Windows：清理已备份的孤立 0.12.46 卸载注册项后，0.12.47 静默覆盖安装成功。数据库、设置、设备身份文件安装前后哈希一致；安装态安全保存公网令牌并同步成功（上传 63、拉取 76、导入 13、冲突 0、拒绝 0），两份 Android 账本在 SQLite 各一条。主界面与设置截图完成回归。
- 交付：三端均回读 `0.12.47 / 1247`。本版为本地中间版本，不推送 `main`、不创建 tag/GitHub Release；最终四文件目录、APK 备份与 SHA256 随本轮收口生成。

## 2026-07-25 · v0.12.46 移动端本地优先基础版

- 需求 ID：`FL-REQ-20260725-MOBILE-LOCAL`、`FL-REQ-20260725-OVERLAY-ISLAND`。移动端新增 `cloud-live/local-offline/reconnecting/forked-local` 四态与双事实域隔离；离线会话不升级、不覆盖远端，也不把本机 UUID 发送为云端控制目标。
- IndexedDB 升级到 v3，增加 `sessionSyncMeta` 与可诊断 pending 状态；本机开始/结束及成功出队使用跨 store 事务，旧 opId 保留，崩溃遗留 uploading 恢复为 retry。
- Android 原生快照增加 `localAuthority`，Store 在锁内拒绝迟到云端响应覆盖本机显示。系统表面拆为标准、小米、华为三个适配器；overlay 实现点按叉号、3 秒收起、持久关闭与按帧合并拖动。
- 自动化：format、typecheck、ESLint、68 个 Vitest 文件/475 项测试、桌面/Web/云构建、Android JVM unit/lint/assemble 与 Windows `dist` 已通过。跨设备 28 项 Vitest 通过；个人云容器门禁因 Docker Desktop Linux Engine 未运行而受阻。
- 三端：小米 `22041216C` 与华为 `DBY-W09` 已覆盖安装并回读 `0.12.46 / 1246`；华为 instrumentation 为 `OK (17 tests)`，小米能力选择、协议 3 载荷和真实通知发布用例分别通过。Windows 两个候选二进制均回读 `0.12.46`，尚未覆盖安装。小米活动通知表已接收 `1214`，但锁屏截图未出现超级岛，故只到 `systemui-accepted`；视觉、gfxinfo、稳定断开 PC 一轮及并发真机分叉仍未验收。
- 本地交付：`release-v01246` 仅含安装版、便携版、SHA256 与说明四文件；Android APK 备份位于 `.tmp/android-apk-backups`。根目录只保留 `release-v01244`、`release-v01245`、`release-v01246`。该候选来自 dirty 工作区，不推送 main、不建 tag/GitHub Release，也不宣称完整门禁完成。

## 2026-07-25 · v0.12.45 便携版 CI 启动门禁与集中发布节奏

- `v0.12.44` 两次通过源码与 Electron 回归，但 GitHub Windows runner 的便携包自解压未在硬编码 15 秒内暴露 CDP 页面；本机同一包的主窗、小窗和便携启动均已通过，Release 尚未创建。
- smoke 的 CDP 启动窗口扩展为有界 60 秒，并在 Electron 提前退出时直接报告退出码，避免把慢启动误报成产品页面失败。
- 从 `0.12.45` 起，仅补丁尾号为 `0` 或 `5` 的版本上传 GitHub；中间版本保留完整本地日志、三端验收、四文件发布目录和 APK 备份，下一上传节点汇总发布。

## 2026-07-25 · v0.12.44 CI 握手测试同步修订

- `v0.12.43` 的发布工作流两次在 `desktopLiveIdleFallback.test.ts` 相同断言失败：测试固定等待 8 个微任务，GitHub runner 尚未完成初始 live 握手；标签、版本、发布说明与 LFS 门禁均已通过，Release 尚未创建。
- 保留公开标签 `v0.12.43`，不移动、不覆盖；测试改为等待 `liveMode` 的可观察状态，产品的 idle 断线回退行为不变。
- Windows、华为、小米推进到 `0.12.44 / 1244` 并重新执行三端同版部署、正式打包和发布门禁。

## 2026-07-24 · v0.12.43 发布门禁修订

- `v0.12.42` 的公开标签触发工作流后，因发布说明使用“对应源码”而非强制字段“对应提交”，且 release-record commit 未包含干净构建生成的版本元数据，工作流在创建 Release 前失败。
- 按不可变标签规则保留 `v0.12.42`，不移动、不覆盖；`0.12.43` 保持相同产品行为，递增 Windows/Android 版本并重新执行三端同版部署与全部发布门禁。
- `0.12.43` 的 release-record commit 必须是源码提交的直接子提交，并且只包含 `shared/version.generated.ts` 与发布目录四个规定文件。

## 2026-07-24 · v0.12.42 三端自动配对与同版门禁

- 需求 ID：`FL-REQ-20260724-PAIRING`、`FL-REQ-20260724-TRI-END`。
- 涉及子系统：Electron Android reverse/配对协调、移动端一次性深链、版本与发布门禁。
- 关键决策：所有协调请求串行执行；每台在线设备按同步令牌指纹代次最多自动配对一次，断开后重连或令牌轮换才重新配对；失败设备保留为下一轮重试，成功设备不重复拉起。配对成功立即运行跨设备同步。
- 兼容性：继续使用 `tcp:18787` reverse 和既有一次性配对协议，不改变账本、实时 revision、Windows 两态小窗、华为 `layout11` 或小米超级岛协议。
- 自动化：format、typecheck、lint、66 个 Vitest 文件/467 项测试、桌面/Web/云构建、Capacitor sync、Android unit/lint、主 APK 与 instrumentation APK 均通过。协调器覆盖并发触发、晚连接、序列变化、单机失败、令牌轮换、重复轮询和恢复重连。
- Windows：候选安装版与便携版生成成功，安装元数据和运行时均读取 `0.12.42`；日志确认两台在线 Android 获得独立一次性配对并立即同步，小窗继续使用 `184×44 / 256×70` 两态。当前二进制嵌入 `e866c39-dirty`，只作为本机候选，不满足正式发布的干净提交门禁。
- 手机：小米 22041216C 覆盖安装后读取 `versionName=0.12.42`、`versionCode=1242`，`tcp:18787` reverse 存在；真机选择 `xiaomi-island`，投影含 `miui.focus.param`，HyperOS `FocusPlugin` 确认收到通知 `1214`。标准通知通道继续保留。
- 平板：华为 DBY-W09 覆盖安装后读取 `versionName=0.12.42`、`versionCode=1242`，`tcp:18787` reverse 存在；断开后晚连接可在一次探测周期内恢复 reverse 并立即同步。胶囊从 `01:30` 连续推进到 `01:43`，`layout11` overlay 仍挂载且 Launcher 稳定。
- 发布卫生：根目录只保留 `release-v01228`、`release-v01229`、`release-v01242`；`release-v01242` 严格包含安装版、便携版、SHA256 和发布说明四个文件，两个哈希复算一致，打包后 `.git/lfs/tmp` 为 0 文件。
- 三端门禁：三端版本矩阵已一致，Android 测试包已从两台设备清理。通过正式本机服务执行临时 start/pause/resume/finish 后生成 2 个 segment、1 个 pause；华为和小米 IndexedDB 均精确包含该 session。发送 delete tombstone 并重启拉取后，两台缓存均不再包含该 session，测试数据已清理。正式 Windows 资产必须继续从本条对应的干净源码提交重建。

## 2026-07-24 · 三端系统计时与任务层级重构

- 需求 ID：`FL-REQ-20260724-SURFACE`、`OVERLAY`、`MINI`、`TASK-TREE`、`PAIRING`、`TRI-END`。
- 涉及子系统：Electron 小窗、React 桌面任务选择器、移动 React renderer、Capacitor Android 原生层、设备同步 HTTP 服务与安全凭据存储。
- 关键决策：Windows 收起高度固定为 44px 并继续保持两态；Android 由统一 provider 按能力选择小米焦点通知、Android promoted ongoing 或标准常驻通知；华为 Android APK 不冒充 HarmonyOS Live View；overlay 仅显式启用；任务继续复用 `parentId`；配对二维码只承载协议版本、端点、一次性随机数和过期时间。
- 兼容性变化：Android `compileSdk` 升为 36，AGP 升为 8.9.1，目标版本保持独立评估；小米焦点协议不可用或未授权时自动降级；非回环远程端点仍强制 HTTPS。
- Windows：布局常量与单元测试已通过；dock 绿色装饰和 35px contentBounds 绕行已删除；隔离候选安装版/便携版打包成功。packaged Chromium 未开放 smoke 所需本地 CDP 端口，候选进程虽启动但 smoke 在 renderer 连接前超时，因此明暗主题、四边/四角像素截图不得标记完成。
- 手机：任务叠层、系统表面状态、显式 overlay 开关与一次性码兑换已实现。小米 22041216C（Android 15 / HyperOS OS3）覆盖安装成功，应用 UID 读取到焦点协议 3、权限已开，实际能力选择为 `xiaomi-island`；instrumentation 0 失败。状态栏/锁屏最终视觉与动作仍需人工截图确认。
- 平板：760px 任务树/详情双栏及窄宽回落已实现。华为 DBY-W09（Android 12 / EMUI 14.2）覆盖安装成功，能力按公开 API 选择 `ongoing-notification`，未宣称 Live View；instrumentation 0 失败。任务双栏和 overlay 拖动位置仍需人工视觉确认。
- 测试结果：format/type/lint 通过；Vitest 65 个文件、462 项全部通过；Android JVM unit + lint 通过；小米与华为各 13 项 instrumentation 中 10 项通过、3 项因未提供真实云参数跳过、0 失败；两台设备均能把 `focuslink://pair` 解析到 `MainActivity`；主应用、Web、云、Android debug APK 和隔离 Windows 候选包构建成功；`npm audit --omit=dev` 的生产依赖漏洞计数为 0。
- 部署结果：最终 debug APK 已安装到小米手机和华为平板。注意：Gradle connected instrumentation 在测试收尾卸载了 target package，导致测试前的本机 App 沙箱无法保留；随后已重新安装候选 APK，但该次属于新安装，旧本机缓存只能从既有同步服务重新拉取，不能声称原地保留。Windows 候选包只生成在本机临时目录，未覆盖 Git LFS 发布资产，也未发布 GitHub Release；公网云未部署。
- 遗留风险：Windows 像素级 smoke 尚未得到 renderer 连接；小米系统岛与华为锁屏通知仍需人工视觉/动作截图；overlay 旋转、分屏和拖动后的坐标恢复需人工操作；PWA 后台能力受浏览器冻结限制；HarmonyOS Live View Kit 需后续独立 ArkTS 客户端；公网 HTTPS 服务需要用户提供域名与托管资源。

## 2026-07-24 · 同步主流程简化与华为参考效果核验

- 需求 ID：`FL-REQ-20260724-SYNC-SIMPLE`、`FL-REQ-20260724-HUAWEI-CAPSULE`。
- 涉及子系统：Electron 设备同步 IPC、Windows 设置页、Android 系统通知能力选择、真机通知核验。
- 关键决策：新增可重入的一键本机同步动作，将安全令牌生成、本机服务启动、`/health` 检查、已授权安卓 ADB reverse 和首次账本同步合并；默认界面只保留开启/自动修复和连接二维码，端点、令牌及开关收进高级设置。现有 revision 冲突继续保留并提示，不自动覆盖用户记录。
- 华为核验：在 DBY-W09 / Android 12 / EMUI 14.2 上启动参考应用临时计时后确认其状态栏胶囊来自华为 Live Notification 专用通知数据，而不是普通 `ongoing` 通知或应用 overlay。华为公开的 Live View Kit 官方页面明确面向 HarmonyOS/ArkTS；参考 Android APK 未发现随包提供的公开 Huawei Live View SDK。因缺少可公开验证的 EMUI Android 接口，本轮没有把黑盒观察到的未公开通知键硬编码进 FocusLink，也没有把标准通知宣称为参考视频同款实况窗。
- Windows：格式、类型、lint、65 个 Vitest 文件/462 项测试、生产构建与 Windows 安装版/便携版打包通过；一键动作仍需在新候选 UI 中人工点击验收。打包前后 `.git/lfs/tmp` 均为 0 文件；非交付的 unpacked/debug/blockmap 已移出发布目录。
- 手机：本轮同步主流程是桌面入口调整，移动连接协议不变；同一 debug APK 已覆盖安装到小米手机，版本 `0.12.27`，应用数据保留。
- 平板：同一 debug APK 已覆盖安装到华为平板，版本 `0.12.27`，应用数据保留；标准系统常驻通知仍可用，但参考视频同款胶囊未标记完成。
- 测试结果：前端 format/type/lint 通过；Vitest 462 项全部通过；Android JVM unit、lint 与 debug APK 构建通过；APK SHA-256 为 `E6774F9A829CD103F32CDBB851D96A5AE90B791AF35B2767E02EEF4BBE0617E7`。
- 部署结果：APK 已覆盖安装到两台已连接安卓设备；Windows 本地候选已生成但未发布 GitHub Release。没有部署公网云服务。
- 遗留风险：华为 EMUI Android 实况窗需厂商公开且适用于第三方 Android APK 的接口/SDK；否则只能通过后续 HarmonyOS ArkTS 客户端接入官方 Live View Kit。Windows 候选仍需人工验证一键修复、二维码扫码和既有冲突提示。

## 2026-07-24 · 华为 EMUI 计时胶囊兼容层

- 需求 ID：`FL-REQ-20260724-HUAWEI-CAPSULE`。
- 逆向对照：从 DBY-W09 拉取参考 APK 后用 jadx 1.5.2 还原；业务代码由原生壳运行时加载，静态结果只含加载器、资源和 Manifest，且没有随包 Huawei Live View SDK。随后启动现有 1 分钟测试待办，从 `dumpsys notification --noredact` 读取系统实际接收的通知对象，确认 `notification.live.event=TIMER`、type/operation、`CapsuleEnabled` 和 capsule 内的 time/status/type/color/icon/countdown 字段。
- 实现：`SystemFocusSurfaceProvider` 对 Huawei/Honor 选择 `huawei-live-capsule`，从同一权威 `FocusRuntimeSnapshot` 投影运行/暂停、elapsed、图标与胶囊色；基础 ongoing notification 始终保留，兼容字段被系统忽略时自然回落。
- 验证：Android JVM unit、lint、debug APK 和 instrumentation APK 编译通过；DBY-W09 上能力选择与胶囊字段两项 instrumentation 均为 `OK (1 test)`。最终状态栏/锁屏外观仍随本轮完整 APK 部署后的活动会话做视觉验收。

## 维护规则

- 每次 UI 或行为变更必须更新 Windows、手机、平板三端矩阵；不适用也要写明原因。
- 只有测试、构建、部署和遗留风险均有事实记录，需求才能进入“已验收”。
- 失败或降级结果同样记录，禁止把计划、编译通过或协议支持误写成真机效果已确认。
