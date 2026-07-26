$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security
$data="$env:ProgramData\Poyi\FoxlinkMcp"; $root=Split-Path -Parent $PSScriptRoot
$enc=[Convert]::FromBase64String((Get-Content -Raw "$data\runtime-key.dpapi").Trim())
$entropy=[Text.Encoding]::UTF8.GetBytes('Poyi.FoxlinkMcp.v1')
$plain=[Security.Cryptography.ProtectedData]::Unprotect($enc,$entropy,[Security.Cryptography.DataProtectionScope]::LocalMachine)
try {
 $env:CONTROL_PLANE_API_KEY=[Text.Encoding]::UTF8.GetString($plain)
 $tunnelId=(Get-Content -Raw "$data\tunnel-id").Trim()
 & "$root\tunnel-client\tunnel-client.exe" run --control-plane.tunnel-id $tunnelId --mcp.server-url 'url=http://127.0.0.1:8770/mcp,channel=main' --health.listen-addr '127.0.0.1:8878' --log.format json
 exit $LASTEXITCODE
} finally { $env:CONTROL_PLANE_API_KEY=$null; [Array]::Clear($plain,0,$plain.Length); [Array]::Clear($enc,0,$enc.Length) }

