<#
.SYNOPSIS
  Builds the technical report, docs/MuVi_Rehab_Technical_Report.docx, in one command (Day 20).

.DESCRIPTION
  1. Creates tools/docs/.venv (once) and installs tools/docs/requirements.txt (python-docx).
     This environment is only for the report: the server's dependencies are not touched.
  2. Runs tools/docs/build_report.py, which reads the code, configs, docs and docs/images/.
  3. If Microsoft Word is installed: opens the report, fills the table of contents and the page
     numbers, saves it and prints the page count. Without Word, the contents fill in when you open
     the file (right-click the table of contents, Update Field).
  4. Reads the report back (tools/docs/build_report.py --check): chapters, appendices, images,
     captions and the number of questions.

  For up-to-date screenshots, run scripts/docs/make_screenshots.ps1 first.

.EXAMPLE
  .\scripts\docs\make_report.ps1
  .\scripts\docs\make_report.ps1 -Python C:\Python313\python.exe
#>
param(
    # The Python used to create the report's own environment (3.10 or newer).
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$venv = Join-Path $root "tools\docs\.venv"
$venvPython = Join-Path $venv "Scripts\python.exe"
$report = Join-Path $root "docs\MuVi_Rehab_Technical_Report.docx"

Write-Host "1/4 The report's Python environment (tools\docs\.venv)..." -ForegroundColor Cyan
if (-not (Test-Path $venvPython)) {
    & $Python -m venv $venv
    if ($LASTEXITCODE -ne 0) { Write-Host "Could not create $venv" -ForegroundColor Red; exit 1 }
}
& $venvPython -m pip install --quiet --disable-pip-version-check -r (Join-Path $root "tools\docs\requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Host "Could not install tools\docs\requirements.txt" -ForegroundColor Red; exit 1 }

Write-Host "2/4 Building the report..." -ForegroundColor Cyan
& $venvPython (Join-Path $root "tools\docs\build_report.py")
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: the build reported a problem" -ForegroundColor Red; exit 1 }

Write-Host "3/4 Table of contents and page count (Microsoft Word)..." -ForegroundColor Cyan
$pages = $null
$word = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $document = $word.Documents.Open([string]$report)
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

Write-Host "4/4 Reading the report back..." -ForegroundColor Cyan
& $venvPython (Join-Path $root "tools\docs\build_report.py") --check
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: the read-back found a problem" -ForegroundColor Red; exit 1 }

if ($pages) { Write-Host ("PASS: docs\MuVi_Rehab_Technical_Report.docx, {0} pages" -f $pages) -ForegroundColor Green }
else { Write-Host "PASS: docs\MuVi_Rehab_Technical_Report.docx" -ForegroundColor Green }
