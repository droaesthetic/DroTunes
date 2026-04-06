$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Test-Path ".env")) {
  Write-Host "Missing .env file. Copy .env.example to .env and fill in your Discord token first." -ForegroundColor Yellow
  exit 1
}

function Get-NextFreePort {
  param(
    [int]$StartPort = 3000,
    [int]$EndPort = 3100
  )

  for ($port = $StartPort; $port -le $EndPort; $port++) {
    $inUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $inUse) {
      return $port
    }
  }

  throw "No free port found between $StartPort and $EndPort."
}

$port = Get-NextFreePort
$env:DASHBOARD_PORT = "$port"
$env:DASHBOARD_PUBLIC_URL = "http://localhost:$port"

Write-Host "Starting Dro Tunes locally..." -ForegroundColor Green
Write-Host "Dashboard: http://localhost:$port" -ForegroundColor Cyan

& "C:\Program Files\nodejs\npm.cmd" run dev:local
