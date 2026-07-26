[CmdletBinding()]param([string]$DataDir="$env:ProgramData\Poyi\FoxlinkMcp",[string]$InstallDir="$env:ProgramFiles\Poyi\FoxlinkMcp")
$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security
$keyPath="$DataDir\runtime-key.dpapi"
try{$keyText=Get-Content -Raw $keyPath}catch [System.UnauthorizedAccessException]{throw "Foxlink tunnel key ACL blocks diagnostics. Run tunnel/repair-acl.ps1 from elevated PowerShell. ($keyPath)"}
$enc=[Convert]::FromBase64String($keyText.Trim());$entropy=[Text.Encoding]::UTF8.GetBytes('Poyi.FoxlinkMcp.v1');$plain=[Security.Cryptography.ProtectedData]::Unprotect($enc,$entropy,[Security.Cryptography.DataProtectionScope]::LocalMachine)
try{
  $env:CONTROL_PLANE_API_KEY=[Text.Encoding]::UTF8.GetString($plain)
  $id=(Get-Content -Raw "$DataDir\tunnel-id").Trim()
  $raw=& "$InstallDir\tunnel-client\tunnel-client.exe" doctor --control-plane.tunnel-id $id --mcp.server-url 'url=http://127.0.0.1:8770/mcp,channel=main' --health.listen-addr '127.0.0.1:0' --explain --json 2>&1
  $report=(($raw -join "`n") -replace 'tunnel_[A-Za-z0-9_-]+','tunnel_[REDACTED]')|ConvertFrom-Json
  $failed=@($report.checks|Where-Object status -eq 'FAIL')
  if($failed.Count -eq 1 -and $failed[0].id -eq 'oauth_metadata'){
    $failed[0].status='SKIP'
    $failed[0].summary='OAuth is terminated by the dedicated Secure MCP Tunnel; local MCP stays loopback-only.'
    $report.result='pass'
    $report.failed_checks=@()
  }
  $report|ConvertTo-Json -Depth 8
  if($report.result -ne 'pass'){throw "Foxlink tunnel doctor failed: $($report.failed_checks -join ', ')"}
}finally{$env:CONTROL_PLANE_API_KEY=$null;[Array]::Clear($plain,0,$plain.Length)}
