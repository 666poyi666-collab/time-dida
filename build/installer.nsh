; FocusLink NSIS 自定义安装脚本
; 在安装新版前自动关闭运行中的 FocusLink 进程，避免用户手动操作

!macro NSIS_HOOK_PREINSTALL
  ; 尝试优雅关闭 FocusLink（发送 WM_CLOSE）
  nsExec::ExecToLog 'taskkill /IM FocusLink.exe'
  Pop $0

  ; 等待进程退出（最多 3 秒）
  Sleep 1000

  ; 如果仍然存在，强制结束
  nsExec::ExecToLog 'taskkill /F /IM FocusLink.exe /T'
  Pop $0

  ; 额外等待确保文件句柄释放
  Sleep 500
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 安装完成后可选：自动启动新版本
  ; 目前不自动启动，让用户自行打开
!macroend
