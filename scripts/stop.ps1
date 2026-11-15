<#
.SYNOPSIS
    Stops MuVi Rehab (Day 20). The data is kept.

.DESCRIPTION
        .\scripts\stop.ps1           # Docker (every profile)
        .\scripts\stop.ps1 -Native   # the native start (scripts\start.ps1 -Native)
#>
[CmdletBinding()]
param([switch]$Native)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if ($Native) {
    $file = Join-Path $root '.muvi-pids.json'
    if (-not (Test-Path $file)) { Write-Host 'Nothing to stop (no .muvi-pids.json).'; exit 0 }
    $pids = Get-Content $file -Raw | ConvertFrom-Json
    foreach ($id in @($pids.server, $pids.web)) {
        # The process and its children (npx starts node).
        & taskkill /pid $id /t /f 2>$null | Out-Null
    }
    Remove-Item $file
    Write-Host 'Stopped.' -ForegroundColor Green
    exit 0
}

Push-Location $root
try { docker compose --profile ollama --profile gpu down } finally { Pop-Location }
