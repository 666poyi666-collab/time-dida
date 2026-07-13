; FocusLink NSIS 自定义安装脚本
; 在安装新版前自动关闭运行中的 FocusLink 进程，避免用户手动操作

; electron-builder 在 install section 里还会执行内置 CHECK_APP_RUNNING。
; 隔离发布 smoke 必须同时绕过这一层，否则 /S 会在后台等待运行中提示框。
; 正常安装没有该进程级环境变量，仍完整执行默认关闭与占用检查。
!macro customCheckAppRunning
  ReadEnvStr $R9 "FOCUSLINK_INSTALLER_SKIP_CLOSE"
  StrCmp $R9 "1" focuslink_check_app_running_done

  !insertmacro _CHECK_APP_RUNNING

  focuslink_check_app_running_done:
!macroend

; ── customInit：在 .onInit 中执行，早于 CHECK_APP_RUNNING ──
; 此钩子在安装器检查应用是否运行之前就强制结束 FocusLink 进程
!macro customInit
  ; 发布 smoke 可继承此临时环境变量，把安装到隔离目录的验证与
  ; 用户当前正在运行的 FocusLink 会话分开。正常安装不会设置它。
  ReadEnvStr $R9 "FOCUSLINK_INSTALLER_SKIP_CLOSE"
  StrCmp $R9 "1" focuslink_custom_init_done

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

  focuslink_custom_init_done:
!macroend

; ── NSIS_HOOK_PREINSTALL：在文件安装前执行（备份机制）──
!macro NSIS_HOOK_PREINSTALL
  ReadEnvStr $R9 "FOCUSLINK_INSTALLER_SKIP_CLOSE"
  StrCmp $R9 "1" focuslink_preinstall_done

  ; 再次确保进程已关闭（防御性处理）
  nsExec::ExecToLog 'taskkill /F /IM FocusLink.exe /T'
  Pop $0
  Sleep 500


  focuslink_preinstall_done:
!macroend

; ── NSIS_HOOK_POSTINSTALL：安装完成后执行 ──
!macro NSIS_HOOK_POSTINSTALL
  ; 安装完成后不做额外操作，让用户自行启动
!macroend
