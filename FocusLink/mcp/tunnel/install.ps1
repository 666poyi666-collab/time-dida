[CmdletBinding()]param([Parameter(Mandatory)][string]$TunnelId,[Security.SecureString]$RuntimeApiKey,[string]$EncryptedRuntimeKeyPath,[string]$InstallDir="$env:ProgramFiles\Poyi\FoxlinkMcp",[string]$DataDir="$env:ProgramData\Poyi\FoxlinkMcp")
$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security
if($TunnelId -notmatch '^tunnel_[A-Za-z0-9_-]+$'){throw 'Invalid TunnelId.'}
$existing=Get-Service FoxlinkSecureMcpTunnel -ErrorAction SilentlyContinue
if($null -ne $existing -and $existing.Status -ne 'Stopped'){
  Stop-Service FoxlinkSecureMcpTunnel -Force
  $existing.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))
}
New-Item -ItemType Directory -Force -Path "$InstallDir\tunnel","$InstallDir\tunnel-client","$DataDir\service-logs\tunnel"|Out-Null
Copy-Item "$PSScriptRoot\run-service.ps1" "$InstallDir\tunnel\run-service.ps1" -Force
Copy-Item "$PSScriptRoot\service.xml" "$InstallDir\FoxlinkSecureMcpTunnel.xml" -Force
Copy-Item 'C:\Program Files\Poyi\PersonalMcpGateway\tunnel-client\tunnel-client.exe' "$InstallDir\tunnel-client\tunnel-client.exe" -Force
Copy-Item 'C:\Program Files\Poyi\PersonalMcpGateway\OpenAISecureMcpTunnel.exe' "$InstallDir\FoxlinkSecureMcpTunnel.exe" -Force
if(-not [string]::IsNullOrWhiteSpace($EncryptedRuntimeKeyPath)){
  Copy-Item $EncryptedRuntimeKeyPath "$DataDir\runtime-key.dpapi" -Force
}elseif($null -ne $RuntimeApiKey){
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($RuntimeApiKey)
  try{$raw=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr);$bytes=[Text.Encoding]::UTF8.GetBytes($raw);$entropy=[Text.Encoding]::UTF8.GetBytes('Poyi.FoxlinkMcp.v1');$enc=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::LocalMachine);[IO.File]::WriteAllText("$DataDir\runtime-key.dpapi",[Convert]::ToBase64String($enc));[Array]::Clear($bytes,0,$bytes.Length)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
}else{throw 'RuntimeApiKey or EncryptedRuntimeKeyPath is required.'}
Set-Content "$DataDir\tunnel-id" $TunnelId -Encoding ascii
$desktopUserSid=([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
$logDir=[IO.Path]::GetFullPath("$DataDir\service-logs\tunnel")
& takeown /F $logDir /A /R /D Y | Out-Null
if($LASTEXITCODE -ne 0){throw 'Foxlink tunnel log ownership repair failed.'}
& icacls $logDir /reset /T /C | Out-Null
if($LASTEXITCODE -ne 0){throw 'Foxlink tunnel log ACL reset failed.'}
& icacls $DataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*$desktopUserSid`:(OI)(CI)R" /T /C | Out-Null
if($LASTEXITCODE -ne 0){throw 'Foxlink tunnel data ACL repair failed.'}
foreach($secretPath in @("$DataDir\runtime-key.dpapi","$DataDir\tunnel-id")){
  & icacls $secretPath /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' "*$desktopUserSid`:R" | Out-Null
  if($LASTEXITCODE -ne 0){throw "Foxlink tunnel secret ACL repair failed: $secretPath"}
}
& "$InstallDir\FoxlinkSecureMcpTunnel.exe" install; if($LASTEXITCODE -ne 0){throw 'Tunnel service installation failed.'}
& "$InstallDir\FoxlinkSecureMcpTunnel.exe" start
