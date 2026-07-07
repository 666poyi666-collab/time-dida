; FocusLink NSIS 自定义安装脚本
; 在安装新版前自动关闭运行中的 FocusLink 进程，避免用户手动操作

; ── customInit：在 .onInit 中执行，早于 CHECK_APP_RUNNING ──
; 此钩子在安装器检查应用是否运行之前就强制结束 FocusLink 进程
!macro customInit
  ; 1. 先尝试优雅关闭（发送 WM_CLOSE）
  nsExec::ExecToLog 'taskkill /IM FocusLink.exe'
  Pop $0

  ; 2. 等待进程退出（最多 2 秒）
  Sleep 2000

  ; 3. 如果仍然存在，强制结束
  nsExec::ExecToLog 'taskkill /F /IM FocusLink.exe /T'
  Pop $0

  ; 4. 额外等待确保文件句柄释放
  Sleep 500
!macroend

; ── NSIS_HOOK_PREINSTALL：在文件安装前执行（备份机制）──
!macro NSIS_HOOK_PREINSTALL
  ; 再次确保进程已关闭（防御性处理）
  nsExec::ExecToLog 'taskkill /F /IM FocusLink.exe /T'
  Pop $0
  Sleep 500
!macroend

; ── NSIS_HOOK_POSTINSTALL：安装完成后执行 ──
!macro NSIS_HOOK_POSTINSTALL
  ; 安装完成后不做额外操作，让用户自行启动
!macroend
