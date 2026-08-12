# FocusLink Windows 安装器错误索引

这是一份可重复使用的安装排错页，不是某次发布的临时报告。安装器默认只处理当前 Windows 账户的 `FocusLink.exe`；不会结束其他账户的同名进程，也不会用 `/T` 遍历 Chromium 进程树。

## FL-INSTALL-001：FocusLink 无法关闭

典型提示：

> FocusLink 无法关闭。请手动关闭它，然后单击重试以继续。

### 先做什么

1. 点击“取消”，不要连续点击“重试”。
2. 从 FocusLink 主窗口、托盘菜单和小窗退出；确认没有隐藏的小窗或沉浸窗口。
3. 打开任务管理器的“详细信息”，只结束当前账户下的 `FocusLink.exe`。不要结束其他账户或 Codex/其他应用的同名进程。
4. 重新运行工作区内的安装包：`release-v*/FocusLink-x.y.z-x64.exe`。

### PowerShell 核对命令

以下命令只列出当前账户可见的 FocusLink 进程，先核对路径和 PID，再决定是否结束：

```powershell
Get-Process -Name FocusLink -IncludeUserName -ErrorAction SilentlyContinue |
  Where-Object UserName -eq "$env:USERDOMAIN\$env:USERNAME" |
  Select-Object Id, UserName, Path
```

如果确认是自己的残留进程，可以按 PID 结束；不要使用不带账户过滤的全局强杀：

```powershell
Stop-Process -Id <当前账户的PID> -Force
```

### 仍然重复出现时

这通常是以下几类情况之一：

- 旧版卸载器在升级路径中仍持有文件句柄；
- 托盘/小窗的 Chromium 子进程在主进程退出后短暂重生；
- FocusLink 以管理员或另一个 Windows 账户运行，当前安装器没有权限结束它；
- 快捷方式或卸载注册项指向旧安装目录，导致安装器反复进入旧升级路径。

安装器会执行两轮有界的当前账户强制关闭，并等待子进程退出。若仍失败，请记录：

- 提示框中的错误文本和时间；
- `FocusLink.exe` 的 PID、完整路径和 `UserName`；
- 当前安装包完整路径；
- 是否存在 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` 下的旧 FocusLink 项。

不要直接删除 `%APPDATA%\FocusLink`；那里可能包含 SQLite 账本和设置。先备份，再处理旧卸载项或安装目录。

### 安装日志

需要日志时，从 PowerShell 启动安装器并保留 NSIS 日志：

```powershell
& .\release-v01222\FocusLink-0.12.22-x64.exe /LOG="$env:TEMP\focuslink-installer.log"
```

日志和截图只放在临时目录，不要提交到 release 目录。修复后仍必须从工作区 release 重新安装验证；不能用旧的 `%TEMP%` 包替代。

## FL-INSTALL-005：双击后像“没有反应”

FocusLink 使用分步安装器。首屏标题是「FocusLink 安装」，需要先选择「仅为我安装」或「为所有用户安装」，再点击「下一步」；首屏不会在未选择范围时直接复制文件。「为所有用户安装」还会等待 Windows UAC 确认，窗口可能出现在其他窗口后面。

优先选择「仅为我安装」，并从工作区 `release-v01222/FocusLink-0.12.22-x64.exe` 启动。安装器现在按 `域/电脑名\\用户名` 精确筛选当前账户的 `FocusLink.exe`，并进行有界强制关闭；若 10 秒后任务栏和 `Alt+Tab` 中仍没有「FocusLink 安装」，用上面的日志命令启动并记录安装器 PID；不要连续双击生成多个安装器。当前候选包应在 4 秒内显示该窗口。

## FL-INSTALL-002：安装后没有看到窗口

先检查托盘区和任务管理器。FocusLink 可能以隐藏模式启动；从托盘打开主窗口，或直接运行安装目录下的 `FocusLink.exe`。如果进程不存在，重新运行安装包并保留上面的日志。

## FL-INSTALL-003：卸载后仍显示旧版本

核对桌面快捷方式目标、开始菜单快捷方式目标和卸载注册项的 `InstallLocation`。它们必须指向同一个工作区 release 安装目录。不要只看文件名判断版本；同时核对安装器内的版本号和 `SHA256SUMS.txt`。

## FL-INSTALL-004：安装器退出码 `0xC0000005`

这是 NSIS 在 Windows 文件访问冲突时可能出现的瞬时退出码，不等同于“FocusLink 无法关闭”。先确认没有残留的安装器或 `FocusLink.exe` 进程，再从工作区 `release-v01222/` 重新运行一次；发布门禁只允许对这个退出码做最多 4 次、每次清理临时安装目录后的递增退避。其他退出码不能静默重试，应立即保留日志并停止。

## FL-INSTALL-006：生成 release EXE 后 `.git/lfs/tmp` 快速增长

典型现象是打包本身已结束，但 `.git/lfs/tmp` 仍持续出现几十到几百 MiB 的新文件；进程树可见桌面 Git/review watcher 执行 `git diff --no-index`，并派生 `git-lfs filter-process` 读取尚未暂存的 release EXE。2026-08-10 的实证触发源是 Codex desktop 自动 review，不是 electron-builder；约 3 分钟内临时文件增长到 1,094,854,656 B。

处理顺序必须固定：

1. 立即停止会重复发现 release EXE 的 review/status 扫描，记录命令行、PID、父 PID、文件数、字节数和最后写入时间。
2. 只把本轮生成的 EXE 暂移到工作区内忽略目录，禁止删除或改写候选；不得清理 `.git/lfs/objects`。
3. 确认所有 `git-lfs filter-process` 退出，且 `.git/lfs/tmp` 至少一个完整 watcher 周期不再增长；两项缺一不可。
4. 仅清理已确认的 `.git/lfs/tmp` 普通文件并回读 0 文件 / 0 B。
5. 在未提交的 `.git/info/exclude` 中精确排除本轮两个 EXE，并保留本地 attributes 防护；先恢复 installer、观察，再恢复 portable、观察。恢复后重新计算 SHA-256，必须与暂移前一致；任一文件不一致或 tmp 重新增长都立即停止晋级。
6. 正式暂存前移除 attributes 防护，运行 `git check-attr filter diff -- <installer> <portable>`，两者必须同时显示 `filter: lfs` 与 `diff: lfs`；使用显式路径一次性暂存，不运行无边界 GUI change scan。

只看“当前没有 git-lfs 进程”不够：filter-process 可能在两次采样之间完成一次大文件转换。必须同时保存稳定时间窗口和 tmp 字节数。历史大文件仍存在也不能直接判断当前仍在增长；按时间戳分别记录历史残留和当前进程事实。

## FL-INSTALL-007：packaged smoke 等待 renderer 时报告 `fetch failed`

先区分三类事实，不要把同一句 `fetch failed` 直接写成产品启动失败：

1. 用 smoke 的独立 `--user-data-dir` 检查 `logs/focuslink-YYYY-MM-DD.log`，确认候选 commit、数据库初始化和 `createMainWindow` 是否发生；日志在 profile 的 `logs/` 子目录，不在 profile 根目录。
2. 只列出 executable path 指向本轮 `release-v*/win-unpacked/FocusLink.exe`、且命令行包含该 profile 或 `--remote-debugging-port` 的候选进程；不得结束 `%LOCALAPPDATA%\Programs\FocusLink\FocusLink.exe` 的已安装实例。
3. 用明确空闲的 loopback 端口启动同一候选并读取 `http://127.0.0.1:<port>/json/list`。若可返回 `title=FocusLink` 的 page target，则产品 renderer 正常，优先检查 smoke 的 CDP 端口分配与清理；若日志有 `EADDRINUSE 127.0.0.1:18770`，则另行检查 Foxlink business API 是否在隔离 profile 中被禁用。

`mini-ui-smoke.cjs` 必须用 `net.Server.listen(0, '127.0.0.1')` 让 OS 分配端口，再关闭预留 socket并启动候选；不得回退为固定范围随机数。packaged smoke 的隔离环境还必须把 `FOXLINK_BUSINESS_API_TOKEN` 设为空，并把 token file 指向 profile 内不存在的文件，避免读取全局凭据或与已安装实例争用业务端口。修复后要复跑完整 smoke，而不是只验证 `/json/list`。

## 维护规则

- 新增安装错误时，先分配稳定错误编号，再补充触发条件、可逆处理和验证命令。
- 只记录当前账户、当前安装包和可复现的 Windows 状态；不记录用户数据内容。
- 安装器策略源文件是 `build/installer.nsh`，发布门禁是 `TEST_AND_RELEASE.md`；本页只提供查错入口。
