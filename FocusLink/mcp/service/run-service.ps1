$ErrorActionPreference='Stop'
$python=Join-Path (Split-Path -Parent $PSScriptRoot) 'python\python.exe'
Start-Process -FilePath $python -ArgumentList @('-s','-m','foxlink_mcp.main','serve') -WorkingDirectory (Split-Path -Parent $PSScriptRoot) -NoNewWindow | Out-Null
$deadline=(Get-Date).AddSeconds(30)
do { Start-Sleep -Milliseconds 250; $listener=Get-NetTCPConnection -LocalPort 8770 -State Listen -ErrorAction SilentlyContinue } until($listener -or (Get-Date)-ge $deadline)
if(-not $listener){throw 'Foxlink MCP listener did not start.'}
while(Get-NetTCPConnection -LocalPort 8770 -State Listen -ErrorAction SilentlyContinue){Start-Sleep -Seconds 1}
exit 1
