# Generate FocusLink product icons.
# Design: Lumen ink-navy porcelain tile + iris focus ring + task-link dots.
# Outputs:
# - build/icon.ico, build/icon.png
# - build/tray.ico, build/tray.png
# - public/favicon.png
Add-Type -AssemblyName System.Drawing

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$BuildDir = Join-Path $Root "build"
$PublicDir = Join-Path $Root "public"
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
New-Item -ItemType Directory -Force -Path $PublicDir | Out-Null

function New-Color($hex, [int]$alpha = 255) {
  $clean = $hex.TrimStart("#")
  $r = [Convert]::ToInt32($clean.Substring(0, 2), 16)
  $g = [Convert]::ToInt32($clean.Substring(2, 2), 16)
  $b = [Convert]::ToInt32($clean.Substring(4, 2), 16)
  return [System.Drawing.Color]::FromArgb($alpha, $r, $g, $b)
}

function New-RoundedRectPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-IconSizes($drawFn, $sizes) {
  $imgs = @()
  foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    & $drawFn $g $size
    $imgs += $bmp
  }
  return $imgs
}

function Save-AsIco($images, $path) {
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $ms
  $bw.Write([UInt16]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]$images.Count)
  $dataOffset = 6 + 16 * $images.Count
  $imgDataList = @()
  foreach ($img in $images) {
    $pngMs = New-Object System.IO.MemoryStream
    $img.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes = $pngMs.ToArray()
    $imgDataList += , $pngBytes
    $w = if ($img.Width -ge 256) { 0 } else { $img.Width }
    $h = if ($img.Height -ge 256) { 0 } else { $img.Height }
    $bw.Write([byte]$w)
    $bw.Write([byte]$h)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$pngBytes.Length)
    $bw.Write([UInt32]$dataOffset)
    $dataOffset += $pngBytes.Length
  }
  foreach ($bytes in $imgDataList) {
    $bw.Write($bytes)
  }
  [System.IO.File]::WriteAllBytes($path, $ms.ToArray())
  $bw.Close()
  $ms.Close()
}

function Draw-AppIcon($g, $size) {
  $s = [single]$size
  $tile = $s * 0.08
  $tileSize = $s - ($tile * 2)
  $radius = $s * 0.21
  $cx = $s / 2
  $cy = $s / 2

  $shadowPath = New-RoundedRectPath ($tile + $s * 0.012) ($tile + $s * 0.018) $tileSize $tileSize $radius
  $shadowBrush = New-Object System.Drawing.SolidBrush (New-Color "#0B0E1D" 96)
  $g.FillPath($shadowBrush, $shadowPath)

  $tilePath = New-RoundedRectPath $tile $tile $tileSize $tileSize $radius
  $tileBrush = New-Object System.Drawing.SolidBrush (New-Color "#181C33")
  $g.FillPath($tileBrush, $tilePath)
  $borderPen = New-Object System.Drawing.Pen (New-Color "#8D98F6" 150), ([Math]::Max(1.0, $s * 0.012))
  $g.DrawPath($borderPen, $tilePath)

  # Focus + link glyph. The same geometry is used in the renderer wordmark.
  $ringR = $s * 0.235
  $trackW = [Math]::Max(1.7, $s * 0.044)
  $trackPen = New-Object System.Drawing.Pen (New-Color "#E9EDFA" 104), $trackW
  $trackPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $trackPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($trackPen, $cx - $ringR, $cy - $ringR, $ringR * 2, $ringR * 2, 198, 202)

  $progressPen = New-Object System.Drawing.Pen (New-Color "#8D98F6" 255), ([Math]::Max(2.0, $s * 0.056))
  $progressPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $progressPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($progressPen, $cx - $ringR, $cy - $ringR, $ringR * 2, $ringR * 2, 18, 202)

  $linkPen = New-Object System.Drawing.Pen (New-Color "#F2F4FC" 235), ([Math]::Max(1.4, $s * 0.035))
  $linkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($linkPen, $cx - $s * 0.13, $cy, $cx + $s * 0.13, $cy)

  $nodeBrush = New-Object System.Drawing.SolidBrush (New-Color "#DCE1FF")
  $nodeR = $s * 0.052
  $g.FillEllipse($nodeBrush, $cx + $s * 0.19 - $nodeR, $cy - $s * 0.19 - $nodeR, $nodeR * 2, $nodeR * 2)
}

function Draw-TrayIcon($g, $size) {
  $s = [single]$size
  $cx = $s / 2
  $cy = $s / 2
  $ringR = $s * 0.32
  $ringW = [Math]::Max(1.6, $s * 0.115)
  $ringPen = New-Object System.Drawing.Pen (New-Color "#3E4460"), $ringW
  $ringPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $ringPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawEllipse($ringPen, $cx - $ringR, $cy - $ringR, $ringR * 2, $ringR * 2)

  $arcPen = New-Object System.Drawing.Pen (New-Color "#4C58D0"), $ringW
  $arcPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $arcPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($arcPen, $cx - $ringR, $cy - $ringR, $ringR * 2, $ringR * 2, -90, 210)

  $coreR = $s * 0.105
  $coreBrush = New-Object System.Drawing.SolidBrush (New-Color "#4C58D0")
  $g.FillEllipse($coreBrush, $cx - $coreR, $cy - $coreR, $coreR * 2, $coreR * 2)
}

$appSizes = @(16, 24, 32, 48, 64, 128, 256)
$appImgs = New-IconSizes Draw-AppIcon $appSizes
Save-AsIco $appImgs (Join-Path $BuildDir "icon.ico")
$bmp512 = New-Object System.Drawing.Bitmap 512, 512
$g = [System.Drawing.Graphics]::FromImage($bmp512)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::Transparent)
Draw-AppIcon $g 512
$bmp512.Save((Join-Path $BuildDir "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "Generated build/icon.ico and build/icon.png"

$traySizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$trayImgs = New-IconSizes Draw-TrayIcon $traySizes
Save-AsIco $trayImgs (Join-Path $BuildDir "tray.ico")
$bmp256 = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp256)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
Draw-TrayIcon $g 256
$bmp256.Save((Join-Path $BuildDir "tray.png"), [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "Generated build/tray.ico and build/tray.png"

$bmpFav = New-Object System.Drawing.Bitmap 512, 512
$g = [System.Drawing.Graphics]::FromImage($bmpFav)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
Draw-AppIcon $g 512
$bmpFav.Save((Join-Path $PublicDir "favicon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "Updated public/favicon.png"

Write-Output "Done."
