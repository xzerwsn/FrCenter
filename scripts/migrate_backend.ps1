$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\..\backend"
alembic upgrade head
