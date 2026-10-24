$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$nodeExecutable = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExecutable) { $nodeExecutable = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
if (-not (Test-Path -LiteralPath $nodeExecutable)) { throw 'Install Node.js 22.13 or newer.' }
& $nodeExecutable scripts/create-demo-data.mjs
& $nodeExecutable node_modules/vite/bin/vite.js build
if ($LASTEXITCODE -ne 0) { throw 'Install dependencies with npm install first.' }
& $nodeExecutable --env-file-if-exists=.env src/server/server.js
