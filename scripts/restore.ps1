<#
.SYNOPSIS
    Restores the MuVi Rehab database from a backup made by backup.ps1 (Day 20).

.DESCRIPTION
    From the repository root:
        .\scripts\restore.ps1 -File backups\muvi-20261120-101500.db            # Docker
        .\scripts\restore.ps1 -File backups\muvi-20261120-101500.db -Native    # native install
    The server is stopped first and started again after. Everything since the backup is lost,
    so make a new backup first if in doubt.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$File,
    [switch]$Native
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = (Resolve-Path $File).Path

if ($Native) {
    Write-Host 'Stop the server first (scripts\stop.ps1 -Native), then press Enter.' -ForegroundColor Yellow
    [void][Console]::ReadLine()
    $python = Join-Path $root 'server\.venv\Scripts\python.exe'
    Push-Location (Join-Path $root 'server')
    try { & $python 'scripts\backup_db.py' restore $source } finally { Pop-Location }
} else {
    Push-Location $root
    try {
        docker compose stop server
        docker compose run --rm --no-deps -v "${source}:/restore/backup.db:ro" server python scripts/backup_db.py restore /restore/backup.db
        if ($LASTEXITCODE -ne 0) { throw 'The restore failed; the old database is unchanged.' }
        docker compose start server
    } finally { Pop-Location }
}
if ($LASTEXITCODE -eq 0) { Write-Host "Restored from $source" -ForegroundColor Green }
exit $LASTEXITCODE
