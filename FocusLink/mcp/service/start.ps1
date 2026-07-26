$ErrorActionPreference = 'Stop'
Start-Service PoyiFoxlinkMcp
(Get-Service PoyiFoxlinkMcp).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))

