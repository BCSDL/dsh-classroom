param([string]$Runtime = (Join-Path $env:USERPROFILE '.local-ai-tools\classroom'), [switch]$DownloadModels, [switch]$Engineering)
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path $PSScriptRoot -Parent
$pythonExe = Join-Path $Runtime 'Scripts\python.exe'
if (!(Test-Path -LiteralPath $pythonExe)) {
    & uv venv --python 3.12 $Runtime
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create the Python environment' }
}
& uv pip install --python $pythonExe -r (Join-Path $packageRoot 'backend\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Failed to install the speech runtime' }
if ($Engineering) {
    & uv pip install --python $pythonExe -r (Join-Path $packageRoot 'backend\engineering-requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install engineering format readers' }
}
if ($DownloadModels) {
    & $pythonExe (Join-Path $packageRoot 'backend\download_models.py') (Join-Path $Runtime 'models')
    if ($LASTEXITCODE -ne 0) { throw 'Model download failed; existing files are preserved for retry' }
}
Write-Output "Python: $pythonExe"
Write-Output ('Models: ' + (Join-Path $Runtime 'models'))
