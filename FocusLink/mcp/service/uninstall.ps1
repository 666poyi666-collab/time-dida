[CmdletBinding()]
param([string]$InstallDir = "$env:ProgramW6432\Poyi\FoxlinkMcp")
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($env:ProgramW6432)) {
  $InstallDir = "$env:ProgramFiles\Poyi\FoxlinkMcp"
}
$service = Get-Service PoyiFoxlinkMcp -ErrorAction SilentlyContinue
if ($null -eq $service) { return }
if ($service.Status -ne 'Stopped') {
  Stop-Service PoyiFoxlinkMcp -Force
  $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
}
$python = "$InstallDir\python\python.exe"
if (Test-Path $python) {
  & $python -m foxlink_mcp.windows_service remove
  if ($LASTEXITCODE -ne 0) { throw 'PoyiFoxlinkMcp native service removal failed.' }
} else {
  & sc.exe delete PoyiFoxlinkMcp | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'PoyiFoxlinkMcp service removal failed.' }
}
