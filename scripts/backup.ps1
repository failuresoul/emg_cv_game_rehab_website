<#
.SYNOPSIS
    Backs up the MuVi Rehab database to backups\muvi-<date-time>.db (Day 20).

.DESCRIPTION
    From the repository root:
        .\scripts\backup.ps1            # Docker (docker compose), the server running
        .\scripts\backup.ps1 -Native    # the native Windows install (server\.venv)
    It uses SQLite's own backup, so it is safe while the server runs. Keep the copies somewhere
    safe: they hold patients' data (by code, without video).
#>
[CmdletBinding()]
param([switch]$Native)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backups = Join-Path $root 'backups'
New-Item -ItemType Directory -Force -Path $backups | Out-Null
$name = 'muvi-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.db'
$target = Join-Path $backups $name

if ($Native) {
    $python = Join-Path $root 'server\.venv\Scripts\python.exe'
    Push-Location (Join-Path $root 'server')
    try { & $python 'scripts\backup_db.py' backup $target } finally { Pop-Location }
} else {
    Push-Location $root
    try {
        docker compose exec -T server python scripts/backup_db.py backup "/data/$name"
        if ($LASTEXITCODE -ne 0) { throw 'The backup inside the container failed (is the server running?)' }
        docker compose cp "server:/data/$name" $target
        docker compose exec -T server rm "/data/$name"
    } finally { Pop-Location }
}
if ($LASTEXITCODE -eq 0) { Write-Host "Saved $target" -ForegroundColor Green }
exit $LASTEXITCODE
