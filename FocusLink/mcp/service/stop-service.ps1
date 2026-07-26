$owners=@(Get-NetTCPConnection -LocalPort 8770 -State Listen -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess -Unique)
foreach($owner in $owners){Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue}
