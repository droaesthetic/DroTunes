$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$jarPath = Join-Path $PSScriptRoot "Lavalink.jar"
if (-not (Test-Path $jarPath)) {
  Write-Host "Lavalink.jar is missing." -ForegroundColor Yellow
  Write-Host "Run .\\download-lavalink.ps1 first." -ForegroundColor Yellow
  exit 1
}

Write-Host "Starting local Lavalink on http://127.0.0.1:2333" -ForegroundColor Green
& java -jar $jarPath
