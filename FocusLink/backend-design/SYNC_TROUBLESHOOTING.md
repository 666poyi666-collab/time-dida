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

该 smoke 只读复制当前 Windows 账户已经加密的同步令牌到系统临时目录，写入隔离设置和不可达的随机 loopback 地址，再通过独立 Electron 实例验证“首次实时握手失败 → 本机计时可开始 → 可结束”。它不会连接、关闭或修改当前正在使用的 FocusLink；若当前账户没有令牌或 Electron `safeStorage` 无法解密，会输出明确的 `SKIP`，不得把 `SKIP` 当成已通过。

## FL-SYNC-002：`无法连接跨设备同步服务（.../v1/sync）`

这是已结束账本同步请求不可达。先按 FL-SYNC-001 的地址、监听和令牌步骤检查；它与滴答清单同步无关。网络恢复后点击「立即同步」，本地待同步会话不会因为一次网络失败而丢失。

滴答清单页面显示「N 条同步失败」时，点击「立即重试」会先把已达到重试上限的记录恢复为待同步，再执行队列；若服务仍不可达或处于限流冷却，会提示「已恢复 N 条失败记录，等待连接恢复后自动重试」，不会静默无动作。

## FL-SYNC-003：HTTP 401/403 或“令牌无效”

服务可达但鉴权失败。确认 PC、网页和 Android 使用同一账号的 endpoint 与 token；必要时在设置页重新输入令牌并保存。切换 endpoint/token 后，客户端只清理旧连接的本机 cursor/实时缓存，不删除 SQLite 会话。

## FL-SYNC-004：`pause 引用了不存在的 segment`

这是旧版本合并/删除片段留下的本地孤立暂停引用，不是网络错误。当前客户端在生成跨设备 bundle 时会把无法解析的旧引用降级为会话级暂停（`segmentId: null`），原始本地账本不被删除；日志会保留诊断。若仍被标记为冲突，请保留会话 ID、暂停 ID 和日志时间，不要直接删除数据库。

## FL-SYNC-005：请求超时

提示为「跨设备同步请求超时」。检查服务端健康检查、反向代理和 VPN；恢复后可重试。客户端使用有限超时，不会无限占用同步队列。

## 日志位置与收集方式

Windows 日志在 `%APPDATA%\focuslink\logs\focuslink-YYYY-MM-DD.log`。只提供包含错误编号/时间、endpoint（可打码）和 HTTP 状态的片段；不要提供 `focuslink-device-sync-credential.json`、访问令牌或整个 SQLite 文件。

## 维护规则

- 新错误先分配稳定 `FL-SYNC-xxx` 编号，再补触发条件、可逆处理和验证命令。
- 跨设备、滴答清单、番茄 To-do 三条同步链路的成功状态不能互相冒充。
- 任何“已同步”结论都必须有对应服务的确认；网络不可达只能显示“未同步/同步失败”。
