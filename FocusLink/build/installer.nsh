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
  nsExec::Exec `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$profile=[Environment]::GetFolderPath('UserProfile'); Get-Process -Name 'FocusLink' -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$profile, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $$_.CloseMainWindow() | Out-Null }"`
  Pop $R1
  Sleep 1200

  nsExec::Exec `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$profile=[Environment]::GetFolderPath('UserProfile'); Get-Process -Name 'FocusLink' -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$profile, [System.StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force"`
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
  Sleep 1600
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
