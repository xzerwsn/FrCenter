$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\..\backend"
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
