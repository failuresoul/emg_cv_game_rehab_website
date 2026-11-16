<#
.SYNOPSIS
  Builds the manual testing guide, docs/MuVi_Rehab_Testing_Guide.docx, in one command (Day 20).

.DESCRIPTION
  1. Uses the report's own environment, tools/docs/.venv (created with tools/docs/requirements.txt
     if missing; the server's dependencies are not touched).
  2. Runs tools/docs/build_testing_guide.py: every on-screen label comes from web/src/i18n/en.ts by
     its key (the build fails if a key is missing), numbers from the code and configs, thumbnails
     from docs/images/screens/.
  3. If Microsoft Word is installed: fills the table of contents, saves, prints the page count.
  4. Reads the guide back (sections, tables, tests, images).

  For up-to-date screenshots, run scripts/docs/make_screenshots.ps1 first.

.EXAMPLE
  .\scripts\docs\make_testing_guide.ps1
#>
param(
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$venv = Join-Path $root "tools\docs\.venv"
$venvPython = Join-Path $venv "Scripts\python.exe"
$guide = Join-Path $root "docs\MuVi_Rehab_Testing_Guide.docx"
$builder = Join-Path $root "tools\docs\build_testing_guide.py"

Write-Host "1/4 The docs Python environment (tools\docs\.venv)..." -ForegroundColor Cyan
if (-not (Test-Path $venvPython)) {
    & $Python -m venv $venv
    if ($LASTEXITCODE -ne 0) { Write-Host "Could not create $venv" -ForegroundColor Red; exit 1 }
}
& $venvPython -m pip install --quiet --disable-pip-version-check -r (Join-Path $root "tools\docs\requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Host "Could not install tools\docs\requirements.txt" -ForegroundColor Red; exit 1 }

Write-Host "2/4 Building the testing guide..." -ForegroundColor Cyan
& $venvPython $builder
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: the build reported a problem (a missing label key or image)" -ForegroundColor Red; exit 1 }

Write-Host "3/4 Table of contents and page count (Microsoft Word)..." -ForegroundColor Cyan
$pages = $null
$word = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $document = $word.Documents.Open([string]$guide)
    foreach ($toc in $document.TablesOfContents) { $toc.Update() }
    $document.Fields.Update() | Out-Null
    $document.Repaginate()
    foreach ($toc in $document.TablesOfContents) { $toc.UpdatePageNumbers() }
    $pages = $document.ComputeStatistics(2)   # wdStatisticPages
    $document.Save()
    $document.Close()
    Write-Host ("  {0} pages, contents filled in" -f $pages)
} catch {
    Write-Host "  Word is not available ($($_.Exception.Message)); the contents fill in when the file is opened." -ForegroundColor Yellow
} finally {
    if ($word) { $word.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
}

Write-Host "4/4 Reading the guide back..." -ForegroundColor Cyan
& $venvPython $builder --check
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: the read-back found a problem" -ForegroundColor Red; exit 1 }

if ($pages) { Write-Host ("PASS: docs\MuVi_Rehab_Testing_Guide.docx, {0} pages" -f $pages) -ForegroundColor Green }
else { Write-Host "PASS: docs\MuVi_Rehab_Testing_Guide.docx" -ForegroundColor Green }
