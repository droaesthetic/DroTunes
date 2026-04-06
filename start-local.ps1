$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Test-Path ".env")) {
  Write-Host "Missing .env file. Copy .env.example to .env and fill in your Discord token first." -ForegroundColor Yellow
  exit 1
}

Write-Host "Starting Dro Tunes locally..." -ForegroundColor Green
Write-Host "Dashboard: http://localhost:3000" -ForegroundColor Cyan

& "C:\Program Files\nodejs\npm.cmd" run dev:local
