$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"

Write-Host "Starting FrCenter backend and frontend..." -ForegroundColor Cyan

$backendCommand = @"
Set-Location '$backendDir'
if (-not (Test-Path '.\.venv\Scripts\python.exe')) {
  Write-Host 'Backend virtualenv not found: backend\.venv' -ForegroundColor Red
  Write-Host 'Create it first: py -m venv backend\.venv && backend\.venv\Scripts\pip install -r backend\requirements.txt'
  exit 1
}
if (-not (Test-Path '..\.env')) {
  Write-Host 'File .env was not found in repo root. Create it from .env.example first.' -ForegroundColor Yellow
}
& '.\.venv\Scripts\python.exe' -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"@

$frontendCommand = @"
Set-Location '$frontendDir'
`$env:VITE_BACKEND_URL='http://localhost:8000'
npm run dev -- --host localhost --port 5173
"@

Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand) | Out-Null
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $frontendCommand) | Out-Null

Write-Host "Backend: http://localhost:8000" -ForegroundColor Green
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host "Done. Two windows were opened: backend and frontend." -ForegroundColor Cyan
