; FocusLink NSIS process policy.
;
; Never enumerate every process named FocusLink.exe. Smoke builds and another
; Windows account may legitimately run the same filename. Instead, ask only the
; current user's instances to exit, then force-close that user's remaining
; Electron children. This also covers the inner process of a portable build.

!macro closeCurrentUserFocusLink
  DetailPrint `Closing current-user "${PRODUCT_NAME}" processes...`
  nsExec::Exec `$SYSDIR\cmd.exe /c taskkill /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
  Pop $R1
  Sleep 900

  ; /IM targets every Electron child with the same image name. Do not add /T:
  ; walking the Chromium process tree can hang while children are exiting.
  nsExec::Exec `$SYSDIR\cmd.exe /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
  Pop $R1
  Sleep 400
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
