$ErrorActionPreference = "Stop"
Add-Type -AssemblyName PresentationCore

$root = Split-Path -Parent $PSScriptRoot
$screenshots = Join-Path $root "docs\screenshots\app"
$output = Join-Path $root "docs\public\demos"
New-Item -ItemType Directory -Force $output | Out-Null

$demos = [ordered]@{
  "first-function" = @("function-editor.png", "functions.png", "executions.png")
  "mcp-tool" = @("mcp-endpoints.png", "endpoint-details.png", "executions.png")
  "http-route" = @("http-apis.png", "endpoint-details.png", "endpoints.png")
  "secure-endpoint" = @("secrets.png", "authentication.png", "endpoint-details.png")
  "release-and-rollback" = @("deployments.png", "executions.png", "audit-log.png")
}

foreach ($demo in $demos.GetEnumerator()) {
  $encoder = [System.Windows.Media.Imaging.GifBitmapEncoder]::new()
  foreach ($sourceName in $demo.Value) {
    $source = Join-Path $screenshots $sourceName
    if (-not (Test-Path -LiteralPath $source)) {
      throw "Missing screenshot: $source"
    }

    $bitmap = [System.Windows.Media.Imaging.BitmapImage]::new()
    $bitmap.BeginInit()
    $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $bitmap.DecodePixelWidth = 960
    $bitmap.UriSource = [Uri]::new($source)
    $bitmap.EndInit()
    $bitmap.Freeze()

    $metadata = [System.Windows.Media.Imaging.BitmapMetadata]::new("gif")
    $metadata.SetQuery("/grctlext/Delay", [UInt16]150)
    $metadata.SetQuery("/grctlext/Disposal", [Byte]2)
    $frame = [System.Windows.Media.Imaging.BitmapFrame]::Create(
      $bitmap,
      $bitmap.Thumbnail,
      $metadata,
      $bitmap.ColorContexts
    )
    $encoder.Frames.Add($frame)
  }

  $target = Join-Path $output "$($demo.Key).gif"
  $stream = [System.IO.File]::Open($target, [System.IO.FileMode]::Create)
  try {
    $encoder.Save($stream)
  } finally {
    $stream.Dispose()
  }
  Write-Host "Generated $target"
}
