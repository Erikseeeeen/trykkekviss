$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "public"
$target = Join-Path $root "cloudflare-upload"
$resolvedRoot = (Resolve-Path $root).Path

if (-not (Test-Path $source)) {
  throw "Missing public directory: $source"
}

if (Test-Path $target) {
  $resolvedTarget = (Resolve-Path $target).Path
  if (-not $resolvedTarget.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clear target outside workspace: $resolvedTarget"
  }
  Remove-Item -LiteralPath $target -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force
