[CmdletBinding()]
param([string]$InstallDir = "$env:ProgramW6432\Poyi\FoxlinkMcp", [string]$DataDir = "$env:ProgramData\Poyi\FoxlinkMcp")
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($env:ProgramW6432)) {
  $InstallDir = "$env:ProgramFiles\Poyi\FoxlinkMcp"
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run from an elevated PowerShell session.' }
$root = Split-Path -Parent $PSScriptRoot
$runtime = 'C:\Program Files\Poyi\PersonalMcpGateway\python\cpython-3.12.13-windows-x86_64-none'
if (-not (Test-Path $runtime)) { throw 'Verified private Python runtime is missing.' }
New-Item -ItemType Directory -Force -Path $InstallDir,$DataDir,"$DataDir\service-logs\mcp" | Out-Null
$existing=Get-Service PoyiFoxlinkMcp -ErrorAction SilentlyContinue
if($null -ne $existing){
  if($existing.Status -ne 'Stopped'){
    Stop-Service PoyiFoxlinkMcp -Force
    $existing.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
  }
  $installedPython = "$InstallDir\python\python.exe"
  if ((Test-Path $installedPython) -and (Test-Path "$InstallDir\foxlink_mcp\windows_service.py")) {
    & $installedPython -m foxlink_mcp.windows_service remove
  } elseif (Test-Path "$InstallDir\PoyiFoxlinkMcp.exe") {
    & "$InstallDir\PoyiFoxlinkMcp.exe" uninstall
  } else {
    & sc.exe delete PoyiFoxlinkMcp | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw 'Existing PoyiFoxlinkMcp service removal failed.' }
}
$listeners = @(Get-NetTCPConnection -LocalPort 8770 -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  $installedProcess = $null -ne $process -and
    -not [string]::IsNullOrWhiteSpace($process.ExecutablePath) -and
    $process.ExecutablePath.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase)
  $foxlinkHealth = $false
  if ($listener.LocalAddress -in @('127.0.0.1', '::1')) {
    try {
      $identity = Invoke-RestMethod http://127.0.0.1:8770/healthz -TimeoutSec 2
      $foxlinkHealth = $identity.service -eq 'PoyiFoxlinkMcp'
    } catch {}
  }
  if (-not $installedProcess -and -not $foxlinkHealth) {
    throw "Port 8770 is owned by a process outside the Foxlink MCP install directory (PID $($listener.OwningProcess))."
  }
  Stop-Process -Id $listener.OwningProcess -Force
}
Copy-Item "$root\foxlink_mcp" $InstallDir -Recurse -Force
Copy-Item $runtime "$InstallDir\python" -Recurse -Force
Copy-Item "$root\foxlink_mcp" "$InstallDir\python\Lib\site-packages" -Recurse -Force
$tokenPath = "$DataDir\business-api-token"
if (-not (Test-Path $tokenPath)) {
  $bytes = New-Object byte[] 48
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  [IO.File]::WriteAllText($tokenPath, [Convert]::ToBase64String($bytes), [Text.UTF8Encoding]::new($false))
  [Array]::Clear($bytes, 0, $bytes.Length)
}
$desktopUser = "$env:USERDOMAIN\$env:USERNAME"
& icacls $DataDir /inheritance:r /grant:r 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\SYSTEM:(OI)(CI)F' "$desktopUser`:(OI)(CI)R" /T /C | Out-Null
& icacls $tokenPath /inheritance:r /grant:r 'BUILTIN\Administrators:F' 'NT AUTHORITY\SYSTEM:F' "$desktopUser`:R" | Out-Null
& "$InstallDir\python\python.exe" -m foxlink_mcp.windows_service --startup delayed install
if ($LASTEXITCODE -ne 0) { throw 'PoyiFoxlinkMcp native service installation failed.' }
Start-Service PoyiFoxlinkMcp
(Get-Service PoyiFoxlinkMcp).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
$healthy = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  try {
    $health = Invoke-RestMethod http://127.0.0.1:8770/healthz -TimeoutSec 2
    if ($health.status -eq 'alive') { $healthy = $true; break }
  } catch {}
  Start-Sleep -Milliseconds 500
}
if (-not $healthy) { throw 'PoyiFoxlinkMcp started but /healthz did not become ready.' }
Write-Host 'PoyiFoxlinkMcp installed. Restart Foxlink once so its business API reads the new credential.'
