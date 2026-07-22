; FocusLink NSIS process policy.
;
; Never enumerate every process named FocusLink.exe. Smoke builds and another
; Windows account may legitimately run the same filename. Instead, ask only the
; current user's instances to exit, then force-close that user's remaining
; Electron children. This also covers the inner process of a portable build.

!macro closeCurrentUserFocusLink
  DetailPrint `Closing current-user "${PRODUCT_NAME}" processes...`
  ; The old uninstaller can run elevated and may not match TASKKILL's textual
  ; USERNAME filter. Resolve the current user's profile and stop only FocusLink
  ; processes whose executable path is inside that profile (including temp smoke
  ; installs). Other Windows accounts and unrelated paths are untouched.
  nsExec::Exec `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$profileRoot=[Environment]::GetFolderPath('UserProfile').TrimEnd('\')+'\'; Get-Process -Name 'FocusLink' -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$profileRoot, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $$_.CloseMainWindow() | Out-Null }"`
  Pop $R1
  Sleep 1200

  nsExec::Exec `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$profileRoot=[Environment]::GetFolderPath('UserProfile').TrimEnd('\')+'\'; Get-Process -Name 'FocusLink' -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$profileRoot, [System.StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force"`
  Pop $R1
  Sleep 1200

  ; TASKKILL reports process owners as DOMAIN\user (or COMPUTER\user). A bare
  ; %USERNAME% filter can miss every Electron process and leave the stock
  ; installer to show its misleading "end process and retry" page.
  nsExec::Exec `$SYSDIR\cmd.exe /d /c taskkill /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERDOMAIN%\%USERNAME%"`
  Pop $R1
  ; Electron has a main process, tray/mini windows and Chromium children.
  ; Give the graceful close enough time to flush SQLite before forcing it.
  Sleep 1200

  ; /IM targets every Electron child with the same image name. Do not add /T:
  ; walking the Chromium process tree can hang while children are exiting.
  nsExec::Exec `$SYSDIR\cmd.exe /d /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERDOMAIN%\%USERNAME%"`
  Pop $R1
  Sleep 1200

  ; A renderer can respawn while the main process is leaving. One bounded
  ; second pass prevents the old uninstaller from opening its retry dialog.
  nsExec::Exec `$SYSDIR\cmd.exe /d /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERDOMAIN%\%USERNAME%"`
  Pop $R1
  Sleep 800

  ; Tray shutdown and Chromium teardown can briefly respawn a same-user child.
  ; Keep draining only executables under the current profile until the process
  ; set is stable, before the bundled old uninstaller gets a chance to run its
  ; own less reliable process check.
  nsExec::Exec `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$profileRoot=[Environment]::GetFolderPath('UserProfile').TrimEnd('\')+'\'; for($$attempt=0; $$attempt -lt 8; $$attempt++){ $$remaining=@(Get-Process -Name 'FocusLink' -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$profileRoot, [System.StringComparison]::OrdinalIgnoreCase) }); if($$remaining.Count -eq 0){ break }; $$remaining | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 400 }"`
  Pop $R1
  Sleep 800
!macroend

; Assisted installers can execute the install section inside a UAC inner
; instance, where CHECK_APP_RUNNING is deliberately skipped. customInit runs in
; both paths, so this is the mandatory close point.
!macro customInit
  ReadEnvStr $R9 "FOCUSLINK_INSTALLER_SKIP_CLOSE"
  StrCmp $R9 "1" focuslink_init_done

  !insertmacro closeCurrentUserFocusLink

  ; v0.12.17's old uninstaller performs a broken global nsProcess scan. Make
  ; only descendants of this setup process bypass that legacy check. The
  ; environment change disappears with setup and is never persisted.
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("FOCUSLINK_INSTALLER_SKIP_CLOSE", "1").r0'

  focuslink_init_done:
!macroend

!macro customCheckAppRunning
  ReadEnvStr $R9 "FOCUSLINK_INSTALLER_SKIP_CLOSE"
  StrCmp $R9 "1" focuslink_check_done

  ; Standalone uninstallers do not run customInit.
  !insertmacro closeCurrentUserFocusLink

  focuslink_check_done:
!macroend

; Electron Builder retries a failing old uninstaller five times and normally
; shows MB_RETRYCANCEL before customUnInstallCheck runs. Our reproducible legacy
; failure is exit code 2 after all payloads were already removed while the old
; process still held the empty installation root as its working directory.
; This hook is injected at retry exhaustion so that known-safe recovery happens
; before any misleading Retry dialog is displayed.
!macro customUninstallRetryExhausted
  ${if} $R0 == 2
  ${andIf} $installationDir != ""
  ${andIf} $installationDir == $INSTDIR
  ${andIf} $uninstallerFileName != ""
    Push $uninstallerFileName
    Call GetFileParent
    Pop $R7
    ${if} $R7 == $installationDir
      !insertmacro closeCurrentUserFocusLink
      ClearErrors
      RMDir /r "$installationDir"
      ; An empty root may remain locked by the old uninstaller and is harmless:
      ; the new package writes back into the same verified installation path.
      IfFileExists "$installationDir\*.*" focuslink_retry_recovery_failed 0
      StrCpy $R0 0
      ClearErrors
    ${endif}
  ${endif}
  Goto focuslink_retry_recovery_done

  focuslink_retry_recovery_failed:
  DetailPrint `Legacy uninstall recovery left files in "$installationDir".`

  focuslink_retry_recovery_done:
!macroend

; The stock result handler delegates to this macro whenever it exists, so it
; must preserve launch failures and all unknown non-zero exit codes.
!macro customUnInstallCheck
  IfErrors focuslink_uninstall_launch_failed 0
  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${endif}
  Goto focuslink_uninstall_check_done

  focuslink_uninstall_launch_failed:
  DetailPrint `Uninstall was not successful. Not able to launch uninstaller.`
  SetErrorLevel 2
  Quit

  focuslink_uninstall_check_done:
!macroend
