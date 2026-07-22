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

## 维护规则

- 新增安装错误时，先分配稳定错误编号，再补充触发条件、可逆处理和验证命令。
- 只记录当前账户、当前安装包和可复现的 Windows 状态；不记录用户数据内容。
- 安装器策略源文件是 `build/installer.nsh`，发布门禁是 `TEST_AND_RELEASE.md`；本页只提供查错入口。
