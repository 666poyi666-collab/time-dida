# 生成简约白色透明图标 v2
# 设计理念：透明背景 + 纯白细圆环 + 12点小圆点（时钟/焦点暗示）
# 应用图标：圆环 + 12点圆点 + 中心微点（精致焦点感）
# 托盘图标：纯圆环 + 中心点（template 风格，极简）
Add-Type -AssemblyName System.Drawing

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

# 应用图标：白色细圆环 + 12点小圆点 + 中心微点
function Draw-AppIcon($g, $size) {
  $cx = [int]($size / 2)
  $cy = [int]($size / 2)
  $white = [System.Drawing.Color]::FromArgb(250, 255, 255, 255)

  # 主圆环（细而精致）
  $ringR = [int]($size * 0.38)
  $ringWidth = [single][int]($size * 0.055)
  if ($ringWidth -lt 1.2) { $ringWidth = 1.2 }
  $ringPen = New-Object System.Drawing.Pen $white, $ringWidth
  $g.DrawEllipse($ringPen, $cx - $ringR, $cy - $ringR, $ringR * 2, $ringR * 2)

  # 12点位置小圆点（时钟刻度暗示）
  $dotR = [int]($size * 0.085)
  if ($dotR -lt 1) { $dotR = 1 }
  $dotY = [int]($cy - $ringR + $ringWidth * 0.5 + $dotR * 0.6)
  $dotBrush = New-Object System.Drawing.SolidBrush $white
  $g.FillEllipse($dotBrush, $cx - $dotR, $dotY - $dotR, $dotR * 2, $dotR * 2)

  # 中心微点（焦点核心）
  $coreR = [int]($size * 0.06)
  if ($coreR -lt 1) { $coreR = 1 }
  $g.FillEllipse($dotBrush, $cx - $coreR, $cy - $coreR, $coreR * 2, $coreR * 2)
}

# 托盘图标：纯白色圆环 + 中心点（极简 template 风格）
function Draw-TrayIcon($g, $size) {
  $cx = [int]($size / 2)
  $cy = [int]($size / 2)
  $white = [System.Drawing.Color]::FromArgb(245, 255, 255, 255)

  # 外环
  $ringR = [int]($size * 0.40)
  $ringWidth = [single][int]($size * 0.075)
  if ($ringWidth -lt 1.2) { $ringWidth = 1.2 }
  $ringPen = New-Object System.Drawing.Pen $white, $ringWidth
  $g.DrawEllipse($ringPen, $cx - $ringR, $cy - $ringR, $ringR * 2, $ringR * 2)

  # 中心圆点
  $coreR = [int]($size * 0.13)
  if ($coreR -lt 1) { $coreR = 1 }
  $coreBrush = New-Object System.Drawing.SolidBrush $white
  $g.FillEllipse($coreBrush, $cx - $coreR, $cy - $coreR, $coreR * 2, $coreR * 2)
}

# 生成 app icon
$appSizes = @(16, 24, 32, 48, 64, 128, 256)
$appImgs = New-IconSizes Draw-AppIcon $appSizes
Save-AsIco $appImgs "c:\Users\poyi\Desktop\time1\build\icon.ico"
$bmp512 = New-Object System.Drawing.Bitmap 512, 512
$g = [System.Drawing.Graphics]::FromImage($bmp512)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::Transparent)
Draw-AppIcon $g 512
$bmp512.Save("c:\Users\poyi\Desktop\time1\build\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "Generated build/icon.ico and build/icon.png"

# 生成 tray icon
$traySizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$trayImgs = New-IconSizes Draw-TrayIcon $traySizes
Save-AsIco $trayImgs "c:\Users\poyi\Desktop\time1\build\tray.ico"
$bmp256 = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp256)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
Draw-TrayIcon $g 256
$bmp256.Save("c:\Users\poyi\Desktop\time1\build\tray.png", [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "Generated build/tray.ico and build/tray.png"

# 更新 favicon.png
$bmpFav = New-Object System.Drawing.Bitmap 512, 512
$g = [System.Drawing.Graphics]::FromImage($bmpFav)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
Draw-AppIcon $g 512
$bmpFav.Save("c:\Users\poyi\Desktop\time1\public\favicon.png", [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "Updated public/favicon.png"

Write-Output "Done."
