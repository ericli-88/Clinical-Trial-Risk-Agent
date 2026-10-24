param(
    [Parameter(Mandatory=$true)][string]$Workbook,
    [int]$Port = 3002
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$sourcePath = (Resolve-Path -LiteralPath $Workbook).Path
if ([IO.Path]::GetExtension($sourcePath) -ne '.xlsx') { throw 'Provide an XLSX workbook.' }
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
$pythonExecutable = if ($pythonCommand) { $pythonCommand.Source } else { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' }
if (-not (Test-Path -LiteralPath $nodeExecutable)) { throw 'Node.js is unavailable.' }
if (-not (Test-Path -LiteralPath $pythonExecutable)) { throw 'Python with openpyxl is required for XLSX import.' }
$hash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLower()
$dataDirectory = Join-Path $projectRoot 'data'
New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null
$databasePath = Join-Path $dataDirectory ('private-' + $hash + '.sqlite')
if (-not (Test-Path -LiteralPath $databasePath)) {
    & $pythonExecutable -X utf8 'scripts/import_edc_workbook.py' --source $sourcePath --output $databasePath --report (Join-Path $dataDirectory ('private-' + $hash + '-import-report.json'))
    if ($LASTEXITCODE -ne 0) { throw 'Workbook import failed.' }
}
& $nodeExecutable 'node_modules/vite/bin/vite.js' build
if ($LASTEXITCODE -ne 0) { throw 'Build failed. Install dependencies first.' }
$env:EDC_DB_PATH = $databasePath
$env:PORT = [string]$Port
$env:AI_PROVIDER = 'ollama'
Write-Host "Private local agent: http://127.0.0.1:$Port/assistant/" -ForegroundColor Green
& $nodeExecutable 'src/server/server.js'
