param([string]$Runtime = (Join-Path $env:USERPROFILE '.local-ai-tools\classroom'), [switch]$DownloadModels, [switch]$Engineering)
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path $PSScriptRoot -Parent
$pythonExe = Join-Path $Runtime 'Scripts\python.exe'
if (!(Test-Path -LiteralPath $pythonExe)) {
    & uv venv --python 3.12 $Runtime
    if ($LASTEXITCODE -ne 0) { throw '创建 Python 环境失败' }
}
& uv pip install --python $pythonExe -r (Join-Path $packageRoot 'backend\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw '安装语音运行时失败' }
if ($Engineering) {
    & uv pip install --python $pythonExe -r (Join-Path $packageRoot 'backend\engineering-requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw '安装工程格式解析器失败' }
}
if ($DownloadModels) {
    & $pythonExe (Join-Path $packageRoot 'backend\download_models.py') (Join-Path $Runtime 'models')
    if ($LASTEXITCODE -ne 0) { throw '下载模型失败；已有文件已保留，可重新运行' }
}
Write-Output "Python: $pythonExe"
Write-Output ('Models: ' + (Join-Path $Runtime 'models'))
