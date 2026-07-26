$mcp=Invoke-RestMethod http://127.0.0.1:8770/readyz -TimeoutSec 3
$tunnel=Invoke-RestMethod http://127.0.0.1:8878/readyz -TimeoutSec 3
if($mcp.status -ne 'ready'){throw 'Foxlink MCP is not ready.'};if($null -eq $tunnel){throw 'Foxlink tunnel is not ready.'}
'Foxlink MCP and independent tunnel are ready.'
