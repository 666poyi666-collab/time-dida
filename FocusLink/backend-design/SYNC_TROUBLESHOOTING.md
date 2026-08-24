# FocusLink 同步错误索引

这是一份可重复使用的同步排错文档。它覆盖三条彼此独立的链路：FocusLink 跨设备账本、滴答清单队列和番茄 To-do 上传。错误编号稳定，截图或日志出现同样文本时可以直接按编号处理。

## FL-SYNC-001：`timer:start-with-task` / `fetch failed`

典型提示：

> 操作失败：Error invoking remote method `timer:start-with-task`: TypeError: fetch failed

### 含义

这不是任务标题、SQLite 或计时器状态错误。PC 已开启「PC 参与实时专注」，于是开始按钮会请求配置的实时服务：

```text
<同步服务地址>/v1/live/command
```

默认地址 `http://127.0.0.1:18787` 由 0.12.22 及以后版本的 Windows 桌面主进程按需托管；旧版本或自定义地址仍需要单独启动后端。旧版本的 `8787` 默认值容易与 Windows 桌面软件（本机当前由 Baidu Netdisk 占用）冲突；地址没有监听、VPN/代理拦截或服务崩溃时，Node/Electron 会报告 `TypeError: fetch failed`。

### 处理步骤

1. 先不要连续点击开始。打开「设置 → 同步」，确认「同步服务地址」和令牌属于同一个服务。
2. 如果只想使用本机计时，关闭「PC 参与实时专注」，点击「保存并连接」。已结束的账本同步仍可单独保持开启；这不会删除本地记录。
3. 如果要做跨设备实时专注，在工作区启动与设置中令牌相同的后端：

   ```powershell
   Set-Location C:\Users\poyi\Desktop\time1\FocusLink
   $env:FOCUSLINK_CLOUD_TEST_TOKEN = '<与设置页相同的访问令牌>'
   npm run dev:cloud
   ```

4. 用健康检查确认服务确实在监听，再回到设置点击「保存并连接」：

   ```powershell
   Invoke-WebRequest http://127.0.0.1:18787/health | Select-Object -Expand Content
   ```

   返回 HTTP 200 后再开始实时专注。不要把访问令牌写进仓库、截图或日志。

   如果仍使用旧配置或自定义端口，先检查端口归属：

   ```powershell
   Get-NetTCPConnection -LocalPort 18787 -ErrorAction SilentlyContinue |
     Select-Object LocalAddress,LocalPort,State,OwningProcess
   ```

安装验收时只运行仓库根目录 `release-v01222\` 下的安装包；`%TEMP%\focuslink-*` 目录只用于 smoke 或安装器临时测试，不能当作交付版本。旧包即使文件名相同，也可能仍显示未包装的 `Error invoking remote method` 原始错误。

修复后的客户端在实时握手成功前不会把本机计时切换到云端事实源；因此服务暂时没启动时，普通桌面计时仍可开始。已经建立的实时会话断线时不会伪造本机确认状态；如果云端当前为空闲，客户端会自动退回本机计时路径，避免开始按钮被不可达服务卡住；如果云端仍有进行中的会话，则继续锁定云端状态，直到服务恢复。设置页会显示「实时连接已断开」，服务恢复后再重连。

发布前用本次刚构建的 unpacked 可执行文件复验这个降级路径：

```powershell
npm run smoke:live-fallback -- <本次构建的 win-unpacked\FocusLink.exe>
```

该 smoke 在系统临时目录创建隔离 profile，并由 Electron `safeStorage` helper 现场生成 synthetic 非生产令牌，再写入不可达的随机 loopback 地址，通过独立 Electron 实例验证“首次实时握手失败 → 本机计时可开始 → 可结束”。它不得读取、复制或解密当前账户的真实同步凭据，也不会连接、关闭或修改当前正在使用的 FocusLink；helper 初始化、加密或解密失败必须在有界超时内明确失败，不得以 `SKIP` 计入通过。

## FL-SYNC-002：`network_error` / `无法连接跨设备同步服务`

这是已结束账本或实时同步请求当时不可达。当前 canonical 客户端使用 `/sync/v2/exchange`、`/sync/v2/status` 和 `/sync/v2/live*`；日志可能只保留结构化 `network_error`。旧安装或 loopback 测试后端仍可能出现 `/v1/sync`。先按本页“连接事故诊断顺序”区分历史失败、当前可达性和产品状态；它与滴答清单同步无关。网络恢复后点击「立即同步」，本地待同步会话不会因为一次网络失败而丢失。

滴答清单页面显示「N 条同步失败」时，点击「立即重试」会先把已达到重试上限的记录恢复为待同步，再执行队列；若服务仍不可达或处于限流冷却，会提示「已恢复 N 条失败记录，等待连接恢复后自动重试」，不会静默无动作。

## FL-SYNC-003：HTTP 401/403 或“令牌无效”

服务可达但鉴权或设备绑定失败。普通用户只需确认各设备登录同一 FocusLink 管理员账号；产品 UI 不再要求服务地址、token 或配对码。已有设备升级后若失去登录态，先核对安全存储中的旧 `fl2` 是否仍可被识别，禁止清数据；新设备登录失败时运行 `npm run probe:account-bootstrap`，`not-deployed` 表示 canonical gateway 尚未上线，不能误报为账号密码错误。切换账号后客户端只清理旧连接的本机 cursor/实时缓存，不删除 SQLite 会话。

若 probe 返回 `deployed-login-required` 且系统浏览器打开 `Poyi OAuth / Owner sign in`，当前页面要求的不是账号密码，而是 43 位一次性管理员授权码。2026-08-24 实测该页只有 `One-time code` 字段，身份服务没有普通注册、找回密码或自助取码入口；没有管理员授权码时，反复点击登录不会成功。这应报告为首台设备身份供应未闭环，不能归类成 transport outage，也不能通过清缓存、删除数据库、展示 token 或内置固定验证码规避。FocusLink 本机任务和计时仍应可用。

若手机任务页长期停在旧 revision：先确认 canonical `GET /sync/v2/tasks` 响应含 `Cache-Control: no-store`，再比较 PC 发布日志的 revision/source/payload 确认与手机回读。移动端可见态应在 15 秒内拉新；低 revision 不覆盖本机缓存，同 revision 异文会报告 authority 不一致。PC 的 pending task snapshot 只有服务端原样回读后才清除，因此 pending 未清说明发布链仍未确认，不要手工伪造 revision。

v0.12.71 起，Electron 从 `fl2` token 解析与 authority 一致的 `deviceId`，live command 和任务快照不再发送 legacy 本机 UUID。若空闲状态下仍收到 401/403，“开始专注”会退回本地计时并在 `liveFocus` 日志写入 `credential-rejected`；已经进行中的云端会话不会降级。任务快照日志应显示具体 HTTP 状态/消息，不应只出现 `[object Object]`。

## FL-SYNC-004：`pause 引用了不存在的 segment`

这是旧版本合并/删除片段留下的本地孤立暂停引用，不是网络错误。当前客户端在生成跨设备 bundle 时会把无法解析的旧引用降级为会话级暂停（`segmentId: null`），原始本地账本不被删除；日志会保留诊断。若仍被标记为冲突，请保留会话 ID、暂停 ID 和日志时间，不要直接删除数据库。

## FL-SYNC-005：请求超时

提示为「跨设备同步请求超时」。检查服务端健康检查、反向代理和 VPN；恢复后可重试。客户端使用有限超时，不会无限占用同步队列。

## FL-SYNC-006：云端恢复后仍显示“跨设备同步失败” / `conflict_present`

### 事故证据

v0.12.78 的一次已安装实例先在日志中真实记录 canonical Sync v2 `network_error` 与 liveFocus 重试；稍后 DNS、TCP 443 和 HTTPS 已恢复，canonical adapter 的 `GET /healthz` 连续返回 200，无凭据 `GET /sync/v2/status` 返回 401。此时 Electron 状态仍可能返回 `lastError=conflict_present`，设置页却显示 danger/“跨设备同步失败”。早先网络失败、当前服务恢复和本机仍有未解决冲突是三个可以同时成立的事实。

同轮 QA 还发现三处同类误分类：手机 completed-ledger 即使本轮返回 conflict/rejected，仍清空 native error 并显示“账本同步已确认”；Android native ledger 把 conflict/rejected ack 保留在 durable outbox 后仍作为普通异常请求后台重试；OPPO watch 对 live command conflict/rejected ack 只接受返回 snapshot，不显示 ack 结果。v0.12.79 已分别改为 partial ledger、保留原始记录的 terminal sidecar、以及“本次未执行，已刷新云端状态”的明确 notice；自动化必须继续锁住这些分支。

### 根因

`electron/sync/deviceSyncV2Service.ts` 在一次同步完成后，如果本机冲突箱非空，会把稳定机器码 `conflict_present` 写入 `deviceSync.lastErrorV2.<scope>`。`readDeviceSyncStatus()` 优先返回持久化码；v0.12.78 的 `SettingsPanel.tsx` 却只用中文“未解决的跨设备冲突”正则识别 conflict-only 状态。因此机器码落入通用失败分支。这是状态分类和呈现 Bug，不是 health 失败，也不应靠清数据修复。

移动端是同一类“收到响应即视为成功”问题：

- `MobileApp.pullLedger()` 没有先检查 `runMobileSyncV2()` 的 `conflicts/rejected`，便写入空 `lastErrorCode`、`confirmed` state 和“已确认”文案。
- `FocusLedgerSyncProtocol` 会拒绝 conflict/rejected ack 并保留 outbox；但 `FocusLedgerSyncWorker` 的通用异常分支没有把这些确定性终态与瞬时 transport 失败分开，所以 WorkManager 可以持续重试相同 mutation。
- `WatchApp.sendCommand()` 收到任意合法 ack 后只映射 snapshot；它没有调用 `commandAckNotice()` 或等价策略，因此 conflict/rejected 没有用户可见结果。

正确语义：

- `conflict_present` 且 `unresolvedConflicts > 0`：warning，“同步已连接，有记录待确认”；保留冲突，不自动覆盖。
- `network_error` / timeout：最近一次 transport 请求失败；若没有更晚成功证据，显示当前未连接。
- 401/403 或 credential code：服务可达但身份/scope 被拒绝，不能写成网络断开。
- `rejected_operation`：远端拒绝某项操作，保留诊断；不能把整条连接标成离线。
- 移动 completed-ledger 的 conflict/rejected：请求已得到权威响应，但对应 mutation 未获确认；保留 pending/conflict/rejected 状态并显示待处理，禁止更新“最近确认”或清空错误。
- Android native ledger 的 applied/duplicate 才能确认 projection 并删除 outbox；conflict/rejected 是需要显式处理的持久终态，不做无界自动 retry。只有可恢复的 transport、5xx 或 rate-limit 才进入有界退避。
- 手表 live command 的 applied/duplicate/conflict/rejected 都必须显示精确 ack 结果；conflict/rejected 应说明“未执行/被拒绝”和云端当前 snapshot，不能静默，也不能仅因 snapshot 可解析就显示确认。

### 连接事故诊断顺序

1. 记录用户看到的文案、当前本地时间和最后成功时间；不要先清 token、缓存、checkpoint 或 SQLite。
2. 从已安装设置读取并脱敏 endpoint，只保留 scheme/host/port/path；从 `%APPDATA%\focuslink\logs\focuslink-YYYY-MM-DD.log` 提取最近时间和结构化错误码，不输出 credential、请求正文或用户数据。
3. 对 endpoint host 依次检查 DNS 与 TCP 443。`198.18.0.0/15` 等合成地址通常表示本机代理/TUN DNS，记录这一环境事实，但不要单凭它判定云端宕机。
4. canonical `foxlink-cloud-mcp` origin 只做匿名 `GET /healthz`；本机 loopback Node 后端才用 `GET /health`。health 200 只证明当前请求链存活。
5. 必要时对 canonical `GET /sync/v2/status` 发无凭据只读请求；401 是“路由存在且鉴权拒绝”的预期证据，不证明已存 token 有效。不得输出或复制已存 token。
6. 不得用 bootstrap 做健康探测：inventory/entities 为 POST，会创建或更新远端 bootstrap 状态。只有完成上述只读层并获得明确授权后，才运行会写同步的“立即同步”或账号流程。
7. 最后读取结构化 `lastError`、`unresolvedConflicts`、`lastSyncAt` 和 live telemetry 分别归类。历史 `network_error` 不因当前 200 被抹掉，当前 200 也不清除 durable conflict。

## FL-SYNC-007：手机/平板“实时连接中断 · 自动重试中”

### 已确认的本轮事故

v0.12.80 在小米 `D68P65855TPBHYWS` 与华为 `f8630574` 上反复失败。两台设备均为普通 Wi‑Fi、无 VPN/HTTP 代理；`workers.dev` DNS 答案持续漂移，TCP 443 在 TLS 前超时，未产生 HTTP 状态或 401/403。小米 WebView 的 `/sync/v2/live`、`/sync/v2/tasks`、`/sync/v2/status` Resource Timing 均为 `transferSize=0`，Android authority 同时记录 `network_error`。这不是 token 失效、scope 拒绝、任务树或计时器故障。

只读验证同一网络上的固定备用数据面 `https://focuslink.pyzzgk.dpdns.org`：`GET /healthz=200`，无凭据 `GET /sync/v2/status=401`。该地址只能作为源码固定白名单的同步数据面 failover，不能变成用户可编辑域名，也不能用于 OAuth/owner 登录或 bootstrap 健康探针。

### v0.12.84 客户端处理（继承并收口 v0.12.81）

- 实时、任务快照、移动 Sync v2 与 Android `FocusCloudClient` 优先请求固定备用 origin：只有 transport/network/timeout 失败才试 canonical；任一 origin 返回的 HTTP 响应（包括 408/425/429/5xx、401/403、409、协议错误或其他明确拒绝）都保留为该 authority 的权威结果，不切换 origin，也不改写成网络失败。Android 只在首个 `IOException` 后切换，第二次请求的 401/403 同样必须保留外层 HTTP 状态，账本 Worker 据此停止自动重试。
- document hidden、Capacitor inactive 时立即 abort 当前 live long-poll；visible/pageshow/active 仅以 generation+epoch 建立唯一新 loop。备用与 canonical 的 bounded wait 都使用协议请求本身的 timeout，不能因备用 origin 不是持久化 endpoint 就在 8 秒提前中止合法的 25 秒 long-poll。网络/超时/409/5xx/rate-limit 有界退避，认证/协议错误停止盲目重试并给出明确文案。
- DOM visibility 与 Capacitor app active 是两个独立门禁：`pageshow` 只能重新评估当前状态，不能强行把 native inactive 改成 active；live effect 每次因 online、凭据或其他依赖变化准备启动前都必须重新经过该门禁，后台不得重建 long-poll。连接失败原因必须同时进入实时状态条和专注控制台，权威 snapshot 成功后清除；不得让旧“正在自动重连”覆盖已经恢复的连接或命令 ACK。
- 首次恢复后的只读顺序：备用/主 origin `/healthz=200` → 无凭据 `/sync/v2/status=401` → 再在应用内观察 live 握手。不得清 token、缓存、checkpoint 或 SQLite 来“修复”这类 transport 事故。

### v0.12.84 验收

必须覆盖：两个 origin 的候选顺序与未知域名拒绝；备用 origin transport 失败后 canonical 成功；备用 origin 超过 8 秒才完成的合法 bounded wait 不得误切 canonical；两端都失败时结构化 `network_error/timeout`；首个或第二个 origin 返回 401/403 都不继续自动重试；hidden→active 旧请求 abort 且只有一个新 loop；Android failover 请求；真机前台→后台→前台与 Wi‑Fi 切换。OPPO OWW221 已于 2026-08-11 退役，不再纳入新版本发布验证。

### v0.12.84 综合验收（继承 v0.12.80 及此前门禁）

设置页不得再用本地化错误字符串正则推断状态。定向测试至少覆盖：

- 旧安装遗留的中文 durable error 只允许在 Electron 持久层边界一次性迁移并回写 machine code；renderer presenter 源码不得含 legacy 中文正则，未知旧文本统一降为 `sync_failed`，不得跨 IPC 原样展示。

- 桌面 `lastError=null`、`network_error`、timeout、401/403、`conflict_present`（冲突数 0 与大于 0）和 `rejected_operation`；`conflict_present + unresolvedConflicts > 0` 永不渲染“跨设备同步失败/连接失败”，同时保留更早网络错误的日志证据。
- 手机 completed-ledger 的 applied/duplicate、conflict、rejected、混合 ack 和 transport failure；只有全部应确认 mutation 获 applied/duplicate 才使用“账本同步已确认”并推进 native `lastVerifiedAt`，其余状态保留准确的 pending/conflict/rejected 计数和错误码。
- 手机 partial 后立即投影、重启 hydration、再次 retry 三条路径都不得推进 `lastVerifiedAt`；legacy/V2 待办按 session identity 并集计数，同一场 ledger+metadata 不得显示成两场，已绑定其他 device 的记录不得计入或上传，未绑定 legacy record 只能由一个 device 原子认领。
- Android native ledger Worker 的 applied/duplicate 删除、conflict/rejected 持久终态、401/403 停止自动重试，以及 transport/5xx/rate-limit 有界退避；验证确定性 ack 不形成无限 WorkManager retry。authority projection 必须把 terminal 数量/安全错误码持续列为 attention，不能被另一条 applied record 清空；敏感字段过滤在 Turkish locale 等环境下仍须拒绝大小写变体。terminal 只能由用户在电脑端处理后显式点击重新检查：入口先核对当前 device/lease，独立 `REPLACE` work 持久绑定 expected device id，marker 在执行前保留且普通 Worker 不可读取；排程失败、进程重启或账号切换不得产生裸 pending。只有显式 Worker 收到 applied/duplicate 后，outbox 与 sidecar 才同时清除。
- 冻结的 OPPO watch 历史合同仍保留自动化回归，但不再扩展功能或纳入真机发布门禁。
- v0.12.84 追加：`rejected_operation` 在 Windows 设置页必须是 warning“同步已连接，部分记录未同步”，不得落入整体连接失败；Android authority 对 `conflict_present/rejected_operation` 必须维持 attention freshness（有 verifiedAt 时 fresh/stale、无 verifiedAt 时 unknown），不得因 terminal ack 伪报 offline。所有 synthetic status fixture 的 `nextCursor` 必须符合正式 `^c[0-9a-z]+$` 合同；Android failover-first 的第二 origin 401/403 必须保留外层状态并停止重试，备用 long-poll 超过 8 秒但在协议 timeout 内合法返回时不得误切 canonical。先通过真实 instrumentation 再晋级资产。

## FL-SYNC-008：loopback 同步服务分配到 Fetch forbidden port（`TypeError: fetch failed` 间歇 flake）

### 含义

回环协议测试与嵌入测试后端在不显式指定端口时绑定动态端口 0；若操作系统分配的临时端口落入 WHATWG Fetch forbidden-port 列表（0、1、25、465、587、6000、6667、10080 等），Electron/Chromium `fetch` 会在请求发出前直接拒绝该 URL，表现为 `TypeError: fetch failed`，即使服务端实际已在监听。这是测试/嵌入服务端口与 Fetch 协议限制的冲突，不是真实断线、防火墙或 VPN 问题，也不能据此判定服务未启动。

### 处理与修复（v0.12.85 起）

- 显式配置 forbidden port 时在 `listen()` 前拒绝，不进入 bind。
- 动态端口 0 至多有界重试（`MAX_DYNAMIC_PORT_BIND_ATTEMPTS=16`），每次尝试后若分配端口 forbidden 先关闭该 listener 再重试。
- 标准 forbidden 列表不能被测试 seam（`isPortForbidden`）绕开；seam 只能在标准列表之上追加条件。
- 并发 `listen()` 调用合并为同一次 in-flight bind，返回同一地址。
- 重试耗尽后服务保持关闭，不残留监听。

### 验证

`tests/deviceSyncServerPortSafety.test.ts` 覆盖标准端口判定、显式端口 bind 前拒绝、seam 不可绕开、动态端口重绑、耗尽关闭与并发合并；回归已在干净源码 `e75e466` 复跑通过（全量 Vitest 114 文件 / 801 项）；回环协议测试与 Cloudflare 本地协议测试在干净源码上复跑通过，不得把端口 flake 当作 authority 故障。

## FL-SYNC-009：番茄 To-do 电脑显示已上传，手机没有记录

先把三种状态分开：`cloudSyncGetStatus.isBound=true` 只表示云端账号已绑定；`cloudSyncUploadRecord.success` 只表示电脑上传接口接受了批次；只有手机 `CloudSyncManager` 的“文件下载成功 / 下载到专注记录数量”才是手机真实接收证据。四位码属于电脑直连手机通道，不能用来解释已绑定的云端下载失败。

真实安装版已验证两个独立失败条件：

- 小米锁屏进入 Device Idle 后，番茄 To-do 进程可能对 `pcd.fanqietodo.cn` 报 `UnknownHostException`，即使 `adb shell ping` 同一域名成功。先检查该应用的后台联网和省电限制；恢复后重启应用，并以新的手机日志复验，不能沿用历史错误。
- 番茄 To-do 专注云投递只接收最近 7 天记录。受控上传 17 条时手机只下载窗口内 12 条；将 4 条移入窗口后，手机明确下载 4 条。桥接层对超窗记录返回 `tomatodo_record_outside_seven_day_window` 并保留待同步；产品不得静默修改日期。历史补录只有在用户明确接受新时间段后才能重排。

专注云文件按一次性批次消费，后一次上传可能覆盖手机尚未取走的前一批。多条记录必须同批上传；真实设备验证时严格按“停止手机应用 → 上传一个完整批次 → 启动手机应用 → 读取下载数量”执行，避免后台提前消费后再误读为 0 条。

## 日志位置与收集方式

Windows 日志在 `%APPDATA%\focuslink\logs\focuslink-YYYY-MM-DD.log`。只提供包含错误编号/时间、endpoint（可打码）和 HTTP 状态的片段；不要提供 `focuslink-device-sync-credential.json`、访问令牌或整个 SQLite 文件。

## 维护规则

- 新错误先分配稳定 `FL-SYNC-xxx` 编号，再补触发条件、可逆处理和验证命令。
- 每轮同步改动前先读 `IMPLEMENTATION_LOG.md` 顶部当前版本 Bug/事故、相关 `FL-SYNC-*` 条目和完整 `TEST_AND_RELEASE.md`；禁止另建平行 Bug 日志或一次性故障报告。
- 跨设备、滴答清单、番茄 To-do 三条同步链路的成功状态不能互相冒充。
- 任何“已同步”结论都必须有对应服务的确认；网络不可达只能显示“未同步/同步失败”。
