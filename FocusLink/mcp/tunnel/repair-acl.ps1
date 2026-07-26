[CmdletBinding()]param([string]$DataDir="$env:ProgramData\Poyi\FoxlinkMcp")
$ErrorActionPreference='Stop'

$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  throw 'Run this Foxlink ACL repair from an elevated PowerShell window.'
}
if(-not (Test-Path -LiteralPath "$DataDir\runtime-key.dpapi")){
  throw "Foxlink tunnel runtime key is missing from $DataDir."
}
$expectedDataDir=[IO.Path]::GetFullPath("$env:ProgramData\Poyi\FoxlinkMcp")
$resolvedDataDir=[IO.Path]::GetFullPath($DataDir)
if($resolvedDataDir -ne $expectedDataDir){throw "Refusing to repair an unexpected data path: $resolvedDataDir"}
$logDir=Join-Path $resolvedDataDir 'service-logs\tunnel'

$service=Get-Service FoxlinkSecureMcpTunnel -ErrorAction SilentlyContinue
if($null -ne $service -and $service.Status -ne 'Stopped'){
  Stop-Service FoxlinkSecureMcpTunnel -Force
  $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))
}

# A previous WinSW crash can leave its PowerShell/tunnel-client descendants alive. Only terminate
# the listener after proving it is the Foxlink tunnel command rooted in the Foxlink install tree.
$listener=Get-NetTCPConnection -LocalPort 8878 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if($null -ne $listener){
  $child=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  $parent=Get-CimInstance Win32_Process -Filter "ProcessId=$($child.ParentProcessId)"
  $installedRoot=[IO.Path]::GetFullPath("$env:ProgramFiles\Poyi\FoxlinkMcp")
  $healthSignature=$null
  try{$healthSignature=Invoke-RestMethod http://127.0.0.1:8878/readyz -TimeoutSec 2}catch{}
  $hasVerifiedCommandLine=-not [string]::IsNullOrWhiteSpace($parent.CommandLine) -and
    $parent.CommandLine -like "*$installedRoot*tunnel*run-service.ps1*"
  # LocalSystem process command lines may be withheld even from an elevated interactive token.
  # In that case the dedicated Foxlink port, exact child/parent process types, stopped SCM service,
  # and the tunnel's ready signature jointly identify the orphan without inspecting other tunnels.
  $hasVerifiedFallback=[string]::IsNullOrWhiteSpace($parent.CommandLine) -and $healthSignature -eq 'ready'
  $isFoxlinkChild=$child.Name -eq 'tunnel-client.exe' -and $parent.Name -eq 'powershell.exe' -and
    ($hasVerifiedCommandLine -or $hasVerifiedFallback)
  if(-not $isFoxlinkChild){throw "Port 8878 is owned by an unverified process (PID $($listener.OwningProcess))."}
  Stop-Process -Id $child.ProcessId -Force
  Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue
}

$desktopUserSid=$identity.User.Value
& takeown /F $logDir /A /R /D Y | Out-Null
if($LASTEXITCODE -ne 0){throw 'Foxlink tunnel log ownership repair failed.'}
& icacls $logDir /reset /T /C | Out-Null
if($LASTEXITCODE -ne 0){throw 'Foxlink tunnel log ACL reset failed.'}
Get-ChildItem -LiteralPath $logDir -File -Filter 'FoxlinkSecureMcpTunnel.*.log' -ErrorAction SilentlyContinue |
  Remove-Item -Force
& icacls $DataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*$desktopUserSid`:(OI)(CI)R" /T /C | Out-Null
if($LASTEXITCODE -ne 0){throw 'Foxlink tunnel data ACL repair failed.'}
foreach($secretPath in @("$DataDir\runtime-key.dpapi","$DataDir\tunnel-id")){
  & icacls $secretPath /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' "*$desktopUserSid`:R" | Out-Null
  if($LASTEXITCODE -ne 0){throw "Foxlink tunnel secret ACL repair failed: $secretPath"}
}

Start-Service FoxlinkSecureMcpTunnel
(Get-Service FoxlinkSecureMcpTunnel).WaitForStatus('Running',[TimeSpan]::FromSeconds(30))
Start-Sleep -Seconds 10
$finalService=Get-Service FoxlinkSecureMcpTunnel
if($finalService.Status -ne 'Running'){throw "Foxlink tunnel service did not remain running: $($finalService.Status)"}
$ready=Invoke-RestMethod http://127.0.0.1:8878/readyz -TimeoutSec 5
if($null -eq $ready){throw 'Foxlink tunnel health endpoint did not return a response.'}
'Foxlink tunnel ACL repaired and service is ready.'
