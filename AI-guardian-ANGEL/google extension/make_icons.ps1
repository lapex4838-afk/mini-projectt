Add-Type -AssemblyName System.Drawing

$outDir = "D:\HARSH\New folder\google extension\icons"

foreach ($size in @(16, 48, 128)) {

    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode   = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Black background
    $g.Clear([System.Drawing.Color]::Black)

    # ─── Draw "T" shape (TrustLayer AI logo style) ───
    $s = $size / 128.0

    # Top bar of T
    $barX = [int](16 * $s)
    $barY = [int](22 * $s)
    $barW = [int](96 * $s)
    $barH = [int](22 * $s)

    # Stem of T
    $stemX = [int](52 * $s)
    $stemY = [int](44 * $s)
    $stemW = [int](24 * $s)
    $stemH = [int](62 * $s)

    $whiteBrush = [System.Drawing.Brushes]::White

    $g.FillRectangle($whiteBrush, $barX,  $barY,  $barW, [math]::Max(1, $barH))
    $g.FillRectangle($whiteBrush, $stemX, $stemY, [math]::Max(1, $stemW), [math]::Max(1, $stemH))

    $g.Dispose()

    $outPath = Join-Path $outDir "icon${size}.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    Write-Output "Saved: $outPath"
}

Write-Output "ALL DONE"
