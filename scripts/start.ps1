<#
.SYNOPSIS
    Starts MuVi Rehab (Day 20), then open http://localhost:8080 in Chrome or Edge.

.DESCRIPTION
    From the repository root:
        .\scripts\start.ps1                     # Docker; the model as server\.env says
        .\scripts\start.ps1 -Model ollama       # Docker, with Ollama in Docker (CPU)
        .\scripts\start.ps1 -Model gpu          # Docker, with Ollama on an NVIDIA GPU
        .\scripts\start.ps1 -Native             # native Windows: server\.venv and web\node_modules
    The native start builds the web app, then runs the server on port 8000 and the web app on
    port 8080 in the background; scripts\stop.ps1 -Native stops them.
#>
[CmdletBinding()]
param(
    [ValidateSet('none', 'ollama', 'gpu')][string]$Model = 'none',
    [switch]$Native
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $root 'server\.env'))) {
    throw 'server\.env is missing: copy server\.env.example to server\.env and set the admin password and JWT secret (docs\install.md).'
}

if ($Native) {
    $python = Join-Path $root 'server\.venv\Scripts\python.exe'
    if (-not (Test-Path $python)) { throw 'server\.venv is missing (docs\install.md, native install).' }
    Push-Location (Join-Path $root 'web')
    try { npm run build; if ($LASTEXITCODE -ne 0) { throw 'The web build failed.' } } finally { Pop-Location }
    $server = Start-Process -FilePath $python -WorkingDirectory (Join-Path $root 'server') -PassThru -WindowStyle Hidden `
        -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'
    $web = Start-Process -FilePath 'npx.cmd' -WorkingDirectory (Join-Path $root 'web') -PassThru -WindowStyle Hidden `
        -ArgumentList 'vite', 'preview', '--port', '8080', '--strictPort'
    @{ server = $server.Id; web = $web.Id } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $root '.muvi-pids.json')
    Write-Host 'Started: http://localhost:8080 (server on 8000). Stop with .\scripts\stop.ps1 -Native' -ForegroundColor Green
    exit 0
}

Push-Location $root
try {
    if ($Model -eq 'none') { docker compose up --build -d } else { docker compose --profile $Model up --build -d }
    if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed.' }
    Write-Host 'Started: http://localhost:8080 (the first start can take minutes; the model download longer).' -ForegroundColor Green
} finally { Pop-Location }
