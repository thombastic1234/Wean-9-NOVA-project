# Synthetic label cards, not food photographs or saved model outputs.
# Recreate with: powershell -File scripts/vision-fixtures.ps1
Add-Type -AssemblyName System.Drawing
$fixtureDir = Join-Path $PSScriptRoot '../tests/fixtures/vision'
New-Item -ItemType Directory -Force -Path $fixtureDir | Out-Null
$cases = @{
  correct = @('BURGER', 'FRIES', 'COLA')
  missing = @('BURGER', 'COLA')
  extra = @('BURGER', 'FRIES', 'COLA', 'COOKIE')
  unclear = @('BURGER', 'FRIES', 'COLA', '???')
}
$font = New-Object System.Drawing.Font('Arial', 30, [System.Drawing.FontStyle]::Bold)
$smallFont = New-Object System.Drawing.Font('Arial', 18)
try {
  foreach ($case in $cases.GetEnumerator()) {
    $bitmap = New-Object System.Drawing.Bitmap(1000, 600)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::WhiteSmoke)
      $graphics.DrawString('SYNTHETIC LABEL-CARD FIXTURE - NOT FOOD', $smallFont, [System.Drawing.Brushes]::Black, 24, 20)
      for ($i = 0; $i -lt $case.Value.Count; $i++) {
        $x = 30 + ($i % 2) * 490
        $y = 90 + [math]::Floor($i / 2) * 240
        $graphics.FillRectangle([System.Drawing.Brushes]::White, $x, $y, 440, 200)
        $graphics.DrawRectangle([System.Drawing.Pens]::Black, $x, $y, 440, 200)
        $graphics.DrawString($case.Value[$i], $font, [System.Drawing.Brushes]::Black, $x + 55, $y + 65)
      }
      $bitmap.Save((Join-Path $fixtureDir ($case.Key + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
} finally { $font.Dispose(); $smallFont.Dispose() }
