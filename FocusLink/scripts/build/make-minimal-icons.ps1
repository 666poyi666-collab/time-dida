# Generate FocusLink product icons.
# Design: a woven time ribbon crossing a fixed escapement needle.
# Outputs:
# - build/icon.ico, build/icon.png
# - build/tray.ico, build/tray.png
# - public/favicon.png
Add-Type -AssemblyName System.Drawing

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$BuildDir = Join-Path $Root "build"
$PublicDir = Join-Path $Root "public"
$MobileIconsDir = Join-Path $Root "mobile\public\icons"
$AndroidResDir = Join-Path $Root "android\app\src\main\res"
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
New-Item -ItemType Directory -Force -Path $PublicDir | Out-Null
New-Item -ItemType Directory -Force -Path $MobileIconsDir | Out-Null

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

function Save-RenderedPng($drawFn, [int]$size, $path) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  & $drawFn $graphics $size
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bmp.Dispose()
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
  $tile = $s * 0.07
  $tileSize = $s - ($tile * 2)
  $radius = $s * 0.19

  $shadowPath = New-RoundedRectPath ($tile + $s * 0.012) ($tile + $s * 0.02) $tileSize $tileSize $radius
  $shadowBrush = New-Object System.Drawing.SolidBrush (New-Color "#06110D" 105)
  $g.FillPath($shadowBrush, $shadowPath)

  $tilePath = New-RoundedRectPath $tile $tile $tileSize $tileSize $radius
  $tileBrush = New-Object System.Drawing.SolidBrush (New-Color "#12201B")
  $g.FillPath($tileBrush, $tilePath)
  $borderPen = New-Object System.Drawing.Pen (New-Color "#4B5B54" 225), ([Math]::Max(1.0, $s * 0.012))
  $g.DrawPath($borderPen, $tilePath)

  # F = elapsed time material: a broad, legible ribbon with engraved second ticks.
  $fBrush = New-Object System.Drawing.SolidBrush (New-Color "#F2F3ED")
  $g.FillRectangle($fBrush, $s * 0.22, $s * 0.20, $s * 0.13, $s * 0.60)
  $g.FillRectangle($fBrush, $s * 0.22, $s * 0.20, $s * 0.49, $s * 0.13)
  $g.FillRectangle($fBrush, $s * 0.22, $s * 0.43, $s * 0.38, $s * 0.13)

  # L = fixed reading ribbon. It crosses the F arm and becomes the current-time edge.
  $lBrush = New-Object System.Drawing.SolidBrush (New-Color "#28B17B")
  $g.FillRectangle($lBrush, $s * 0.55, $s * 0.35, $s * 0.13, $s * 0.34)
  $g.FillRectangle($lBrush, $s * 0.55, $s * 0.67, $s * 0.25, $s * 0.13)

  # Repaint a short F cap over L: a single over/under crossing turns the monogram into a weave.
  $g.FillRectangle($fBrush, $s * 0.49, $s * 0.43, $s * 0.11, $s * 0.13)
  $edgePen = New-Object System.Drawing.Pen (New-Color "#12201B" 92), ([Math]::Max(0.7, $s * 0.008))
  $g.DrawLine($edgePen, $s * 0.55, $s * 0.57, $s * 0.68, $s * 0.57)

  if ($size -ge 32) {
    $tickBrush = New-Object System.Drawing.SolidBrush (New-Color "#12201B" 185)
    foreach ($tx in @(0.42, 0.47, 0.52)) {
      $g.FillRectangle($tickBrush, $s * $tx, $s * 0.235, [Math]::Max(1.0, $s * 0.009), $s * 0.06)
    }
  }
}

function Draw-TrayIcon($g, $size) {
  $s = [single]$size
  $darkBrush = New-Object System.Drawing.SolidBrush (New-Color "#17221E")
  $greenBrush = New-Object System.Drawing.SolidBrush (New-Color "#28B17B")

  $fPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $fPath.AddRectangle([System.Drawing.RectangleF]::new($s * 0.13, $s * 0.12, $s * 0.18, $s * 0.76))
  $fPath.AddRectangle([System.Drawing.RectangleF]::new($s * 0.13, $s * 0.12, $s * 0.57, $s * 0.18))
  $fPath.AddRectangle([System.Drawing.RectangleF]::new($s * 0.13, $s * 0.42, $s * 0.45, $s * 0.18))
  $g.FillPath($darkBrush, $fPath)

  $lPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $lPath.AddRectangle([System.Drawing.RectangleF]::new($s * 0.57, $s * 0.34, $s * 0.18, $s * 0.42))
  $lPath.AddRectangle([System.Drawing.RectangleF]::new($s * 0.57, $s * 0.70, $s * 0.30, $s * 0.18))
  $g.FillPath($greenBrush, $lPath)

  # Restore the crossing cap so the two letters visibly interlock at tray scale.
  $g.FillRectangle($darkBrush, $s * 0.47, $s * 0.42, $s * 0.11, $s * 0.18)
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

# PWA and Android must use the exact same product mark as the desktop package.
Save-RenderedPng Draw-AppIcon 192 (Join-Path $MobileIconsDir "focuslink-192.png")
Save-RenderedPng Draw-AppIcon 512 (Join-Path $MobileIconsDir "focuslink-512.png")
Write-Output "Updated PWA 192/512 icons"

$androidLauncherSizes = @{
  "mipmap-mdpi" = 48
  "mipmap-hdpi" = 72
  "mipmap-xhdpi" = 96
  "mipmap-xxhdpi" = 144
  "mipmap-xxxhdpi" = 192
}
foreach ($entry in $androidLauncherSizes.GetEnumerator()) {
  $dir = Join-Path $AndroidResDir $entry.Key
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Save-RenderedPng Draw-AppIcon $entry.Value (Join-Path $dir "ic_launcher.png")
  Save-RenderedPng Draw-AppIcon $entry.Value (Join-Path $dir "ic_launcher_round.png")
}
Write-Output "Updated Android legacy launcher icons"

Write-Output "Done."
