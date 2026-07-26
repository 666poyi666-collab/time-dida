$service = Get-Service PoyiFoxlinkMcp -ErrorAction SilentlyContinue
$health = try { Invoke-RestMethod http://127.0.0.1:8770/healthz -TimeoutSec 3 } catch { $null }
$ready = try { Invoke-RestMethod http://127.0.0.1:8770/readyz -TimeoutSec 3 } catch { $null }
[pscustomobject]@{ Service = $service.Status; Health = $health.status; Ready = $ready.status; Foxlink = $ready.foxlink }

