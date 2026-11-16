<#
.SYNOPSIS
  The README's screenshots and diagrams in one command (Day 20).

.DESCRIPTION
  1. Playwright (web/playwright.docs.config.ts) starts the API in test mode (its own database,
     the mock model) and the web app in test mode, then captures every screen at 1440 x 900, 2x,
     into docs/images/screens/, and renders the Mermaid diagrams of docs/architecture.md into
     docs/images/diagrams/ (the diagrams need an internet connection for Mermaid).
  2. scripts/docs/optimise_images.py makes the warm-up and games grids and shrinks every PNG
     below about 400 KB (needs Pillow: Anaconda's python has it).
  3. scripts/docs/check_readme_links.py checks that every link and image in README.md exists.

  The servers stop by themselves at the end. Your own database is never touched.

.EXAMPLE
  .\scripts\docs\make_screenshots.ps1
  .\scripts\docs\make_screenshots.ps1 -Python C:\Users\me\anaconda3\python.exe
#>
param(
    # A Python with Pillow, for the optimisation step.
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")

Write-Host "1/3 Capturing screens and diagrams (about 15 minutes)..." -ForegroundColor Cyan
Push-Location (Join-Path $root "web")
try {
    npx playwright test -c playwright.docs.config.ts
    $captureCode = $LASTEXITCODE
} finally {
    Pop-Location
}

Write-Host "2/3 Making the grids and optimising the PNGs..." -ForegroundColor Cyan
& $Python (Join-Path $root "scripts\docs\optimise_images.py")
$optimiseCode = $LASTEXITCODE

Write-Host "3/3 Checking the README's links and images..." -ForegroundColor Cyan
& $Python (Join-Path $root "scripts\docs\check_readme_links.py")
$linksCode = $LASTEXITCODE

$manifest = Join-Path $root "docs\images\screens\manifest.json"
if (Test-Path $manifest) {
    $data = Get-Content $manifest -Raw | ConvertFrom-Json
    Write-Host ("Captured {0} screens; skipped {1}." -f $data.captured.Count, $data.missed.Count)
    foreach ($item in $data.missed) { Write-Host ("  skipped {0}: {1}" -f $item.name, $item.why) -ForegroundColor Yellow }
}

if ($captureCode -ne 0 -or $optimiseCode -ne 0 -or $linksCode -ne 0) {
    Write-Host "FAIL (capture $captureCode, optimise $optimiseCode, links $linksCode)" -ForegroundColor Red
    exit 1
}
Write-Host "PASS" -ForegroundColor Green
