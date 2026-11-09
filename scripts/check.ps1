<#
.SYNOPSIS
    Runs every MotionLab check and prints PASS or FAIL for each, then a summary.

.DESCRIPTION
    From the repository root, in Windows PowerShell 5.1 or PowerShell 7:

        .\scripts\check.ps1

    Steps, in order (all run, even after a failure):
      1. Backend tests with coverage   (server: pytest --cov)
      2. Frontend tests                (web: npm test)
      3. Frontend lint                 (web: npm run lint)
      4. Frontend build                (web: npm run build)
      5. Smoke test                    (server/scripts/smoke_test.py against a backend this
                                        script starts on its own port)

    The smoke test's backend uses a temporary SQLite database and a temporary admin login,
    both deleted afterwards, so your own database and server/.env are never changed. It needs
    port 8765 free (change it with -Port).

    Needs server/.venv with the requirements installed and web/node_modules (npm install).
    The exit code is 0 when every step passes and 1 otherwise.

.PARAMETER Port
    Port for the smoke test's backend. Default 8765.

.PARAMETER SkipBuild
    Leave out the frontend build, which is the slowest step.
#>
[CmdletBinding()]
param(
    [int]$Port = 8765,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root 'server'
$web = Join-Path $root 'web'
$python = Join-Path $server '.venv\Scripts\python.exe'
$results = New-Object System.Collections.Generic.List[object]

function Write-Banner([string]$text) {
    Write-Host ''
    Write-Host ('=== ' + $text + ' ===') -ForegroundColor Cyan
}

function Add-Result([string]$name, [bool]$passed, [string]$detail, [double]$seconds) {
    $results.Add([pscustomobject]@{
        Step    = $name
        Result  = $(if ($passed) { 'PASS' } else { 'FAIL' })
        Seconds = [math]::Round($seconds, 1)
        Detail  = $detail
    })
    if ($passed) {
        Write-Host ('PASS  ' + $name) -ForegroundColor Green
    } else {
        Write-Host ('FAIL  ' + $name + $(if ($detail) { ': ' + $detail } else { '' })) -ForegroundColor Red
    }
}

# Runs a native command in a folder; passes when its exit code is 0.
function Invoke-Step([string]$name, [string]$folder, [scriptblock]$command) {
    Write-Banner $name
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $folder
    try {
        & $command
        $code = $LASTEXITCODE
        Add-Result $name ($code -eq 0) $(if ($code -ne 0) { "exit code $code" } else { '' }) $timer.Elapsed.TotalSeconds
    } catch {
        Add-Result $name $false $_.Exception.Message $timer.Elapsed.TotalSeconds
    } finally {
        Pop-Location
    }
}

# Prerequisites: without these, nothing else can run.
$missing = @()
if (-not (Test-Path $python)) { $missing += 'server\.venv (see README: How to run)' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { $missing += 'npm (install Node.js 22 or newer)' }
if (-not (Test-Path (Join-Path $web 'node_modules'))) { $missing += 'web\node_modules (run npm install in web)' }
if ($missing.Count -gt 0) {
    Write-Host 'FAIL  Prerequisites missing:' -ForegroundColor Red
    $missing | ForEach-Object { Write-Host ('      - ' + $_) -ForegroundColor Red }
    exit 1
}

Invoke-Step 'Backend tests with coverage' $server {
    & $python -m pytest -q --cov=app --cov=scripts --cov-report=term
}
Invoke-Step 'Frontend tests' $web { npm test }
Invoke-Step 'Frontend lint' $web { npm run lint }
if ($SkipBuild) {
    Write-Host ''
    Write-Host 'SKIP  Frontend build (-SkipBuild)' -ForegroundColor Yellow
} else {
    Invoke-Step 'Frontend build' $web { npm run build }
}

# Smoke test against a backend started here, with its own temporary database and admin.
Write-Banner 'Smoke test'
$timer = [System.Diagnostics.Stopwatch]::StartNew()
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ('motionlab-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir | Out-Null
$database = Join-Path $tempDir 'smoke.db'
$serverLog = Join-Path $tempDir 'server.log'
$serverErrors = Join-Path $tempDir 'server-errors.log'
$envNames = 'DATABASE_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_NAME', 'JWT_SECRET'
$savedEnv = @{}
foreach ($name in $envNames) { $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$backend = $null
try {
    # Environment variables take precedence over server/.env, for this process and its children.
    $env:DATABASE_URL = 'sqlite:///' + ($database -replace '\\', '/')
    $env:ADMIN_EMAIL = 'check-admin@example.com'
    $env:ADMIN_PASSWORD = [guid]::NewGuid().ToString('N')
    $env:ADMIN_NAME = 'Check Admin'
    $env:JWT_SECRET = ([guid]::NewGuid().ToString('N')) + ([guid]::NewGuid().ToString('N'))

    $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listening) { throw "port $Port is already in use; choose another with -Port" }

    $backend = Start-Process -FilePath $python -WorkingDirectory $server -PassThru -WindowStyle Hidden `
        -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$Port" `
        -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrors

    $baseUrl = "http://127.0.0.1:$Port"
    $ready = $false
    for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
        if ($backend.HasExited) { throw 'the backend stopped while starting; see the log below' }
        try {
            $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 2
            $ready = $health.status -eq 'ok'
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $ready) { throw 'the backend did not answer /api/health within 30 seconds' }

    Push-Location $server
    try {
        & $python 'scripts\smoke_test.py' $baseUrl
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    Add-Result 'Smoke test' ($code -eq 0) $(if ($code -ne 0) { "exit code $code" } else { '' }) $timer.Elapsed.TotalSeconds
} catch {
    Add-Result 'Smoke test' $false $_.Exception.Message $timer.Elapsed.TotalSeconds
    foreach ($log in $serverLog, $serverErrors) {
        if (Test-Path $log) {
            Write-Host ('--- ' + (Split-Path -Leaf $log) + ' (last 20 lines) ---') -ForegroundColor Yellow
            Get-Content $log -Tail 20 | ForEach-Object { Write-Host $_ }
        }
    }
} finally {
    if ($backend -and -not $backend.HasExited) {
        Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
        $backend.WaitForExit(5000) | Out-Null
    }
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $savedEnv[$name], 'Process') }
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}

# Summary
Write-Banner 'Summary'
$results | Format-Table -AutoSize Step, Result, Seconds, Detail | Out-String | Write-Host
$failed = @($results | Where-Object { $_.Result -eq 'FAIL' })
if ($failed.Count -eq 0) {
    Write-Host ("ALL PASSED ($($results.Count) steps)") -ForegroundColor Green
    exit 0
}
Write-Host ("$($failed.Count) of $($results.Count) steps FAILED: " + (($failed | ForEach-Object { $_.Step }) -join ', ')) -ForegroundColor Red
exit 1
