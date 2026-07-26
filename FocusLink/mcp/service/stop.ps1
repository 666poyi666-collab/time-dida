$ErrorActionPreference = 'Stop'
Stop-Service PoyiFoxlinkMcp
(Get-Service PoyiFoxlinkMcp).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))

