; FocusLink NSIS 自定义安装脚本
; 在安装新版前自动关闭运行中的 FocusLink 进程，避免用户手动操作

; 使用 nsProcess 做精确的进程探测与关闭；不依赖安装器进程的 PATH。
!include "nsProcess.nsh"
!ifndef BUILD_UNINSTALLER
Var focuslinkCloseAttempt
!endif

; electron-builder 的默认检查会再次竞态探测并弹出“无法关闭”。这里改为
; 已确认退出就直接放行；仍存在时再强杀并复查，只有权限确实不足才提示。
!ifndef BUILD_UNINSTALLER
!macro customCheckAppRunning
  ReadEnvStr $R9 "FOCUSLINK_INSTALLER_SKIP_CLOSE"
  StrCmp $R9 "1" focuslink_check_app_running_done

  focuslink_check_app_running_retry:
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  StrCmp $R0 "0" 0 focuslink_check_app_running_done

  ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  Sleep 900
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  StrCmp $R0 "0" 0 focuslink_check_app_running_done

  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY focuslink_check_app_running_retry
  Quit

  focuslink_check_app_running_done:
!macroend
!endif

; ── customInit：在 .onInit 中执行，早于 CHECK_APP_RUNNING ──
; 此钩子在安装器检查应用是否运行之前就强制结束 FocusLink 进程
!macro customInit
  ; 发布 smoke 可继承此临时环境变量，把安装到隔离目录的验证与
  ; 用户当前正在运行的 FocusLink 会话分开。正常安装不会设置它。
  ReadEnvStr $R9 "FOCUSLINK_INSTALLER_SKIP_CLOSE"
  StrCmp $R9 "1" focuslink_custom_init_done

  ; 1. 先向所有同名进程发送关闭请求。
  ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $0
  StrCpy $focuslinkCloseAttempt 0

  ; 2. 最多等待 2 秒，让 before-quit 完成持久化与数据库收尾。
  focuslink_wait_graceful:
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $0
  StrCmp $0 "0" 0 focuslink_custom_init_done
  IntOp $focuslinkCloseAttempt $focuslinkCloseAttempt + 1
  IntCmp $focuslinkCloseAttempt 8 focuslink_force_close 0 focuslink_force_close
  Sleep 250
  Goto focuslink_wait_graceful

  ; 3. 托盘模式拦截普通关闭时，使用插件强制结束全部同名进程。
  focuslink_force_close:
  ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $0
  Sleep 800

  focuslink_custom_init_done:
!macroend

; ── NSIS_HOOK_PREINSTALL：在文件安装前执行（备份机制）──
!macro NSIS_HOOK_PREINSTALL
  ReadEnvStr $R9 "FOCUSLINK_INSTALLER_SKIP_CLOSE"
  StrCmp $R9 "1" focuslink_preinstall_done

  ; 文件替换前最后一次无弹窗复查；customCheckAppRunning 已负责权限失败提示。
  ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $0
  Sleep 500


  focuslink_preinstall_done:
!macroend

; ── NSIS_HOOK_POSTINSTALL：安装完成后执行 ──
!macro NSIS_HOOK_POSTINSTALL
  ; 安装完成后不做额外操作，让用户自行启动
!macroend
