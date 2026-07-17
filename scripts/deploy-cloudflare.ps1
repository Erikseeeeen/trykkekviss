$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  & (Join-Path $PSScriptRoot "prepare-cloudflare-upload.ps1")
  if (-not $?) {
    exit 1
  }

  & npx wrangler deploy --config wrangler.worker.jsonc @args
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
finally {
  Pop-Location
}
