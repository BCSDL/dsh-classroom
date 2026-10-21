param([switch]$CheckOnly,[switch]$InstallPrerequisites,[string]$Commit,[string]$Runtime=(Join-Path $env:USERPROFILE '.local-ai-tools\classroom'))
$ErrorActionPreference='Stop'
function Refresh-TaskPath {
    $env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')+';'+(Join-Path $env:APPDATA 'npm')
}
$requirements=@(
    @{command='node';id='OpenJS.NodeJS.LTS';url='https://nodejs.org/en/download'},
    @{command='uv';id='astral-sh.uv';url='https://docs.astral.sh/uv/getting-started/installation/'},
    @{command='ffmpeg';id='Gyan.FFmpeg';url='https://ffmpeg.org/download.html'},
    @{command='ollama';id='Ollama.Ollama';url='https://ollama.com/download/windows'}
)
$report=@();foreach($item in $requirements){$found=Get-Command $item.command -ErrorAction SilentlyContinue;$report+=@{name=$item.command;present=[bool]$found;path=if($found){$found.Source}else{$null};installer=$item.id;source=$item.url}}
if($CheckOnly){@{prerequisites=$report;pythonReady=(Test-Path -LiteralPath (Join-Path $Runtime 'Scripts/python.exe'));dshPresent=[bool](Get-Command dsh -ErrorAction SilentlyContinue);doesNotChangeLaunchers=$true} | ConvertTo-Json -Depth 4;return}
$missing=@($report | Where-Object {-not $_.present})
if($missing.Count){
    Write-Output ('缺少：'+(($missing | ForEach-Object {$_.name}) -join ', '))
    if(-not $InstallPrerequisites){$reply=Read-Host '是否通过 WinGet 安装上列组件？输入 INSTALL 继续';if($reply -ne 'INSTALL'){throw '安装未执行。可查看脚本的 -CheckOnly 报告及官方安装链接。'}}
    if(-not(Get-Command winget -ErrorAction SilentlyContinue)){throw '需要 Windows 应用安装程序 / WinGet；请从 Microsoft Store 安装后重试。'}
    foreach($item in $missing){& winget install --exact --id $item.installer --source winget --accept-source-agreements --accept-package-agreements;if($LASTEXITCODE -ne 0){throw ('组件安装失败：'+$item.name)};Refresh-TaskPath}
}
$nodeVersion=& node --version;if([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22){throw 'DSH 需要 Node.js 22 以上。请先升级 Node.js。'}
if(-not(Get-Command dsh -ErrorAction SilentlyContinue)){
    & npm install -g '@deepseek-ai/dsh@0.2.0-rc.2' '--allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs'
    if($LASTEXITCODE -ne 0){throw 'DSH 安装失败，未修改启动入口或其他 CLI。'}
    Refresh-TaskPath
}
$profileHome=if($env:DSH_HOME){$env:DSH_HOME}else{Join-Path $env:USERPROFILE '.dsh'}
& dsh --profile web --dump-config | Out-Null
if($LASTEXITCODE -ne 0){throw '请先按官方流程初始化 DSH web profile；脚本保留当前配置。'}
& (Join-Path $PSScriptRoot 'setup.ps1') -Runtime $Runtime -DownloadModels
if(-not $Commit){$lock=Join-Path (Split-Path $PSScriptRoot -Parent) 'installed-release.json';if(Test-Path -LiteralPath $lock){$Commit=(Get-Content -LiteralPath $lock -Raw | ConvertFrom-Json).commit}else{$Commit=Read-Host '输入已审核的 BCSDL/dsh-classroom 完整提交 SHA（40 位）'}}
& (Join-Path $PSScriptRoot 'install-release.ps1') -Commit $Commit
Write-Output '课堂运行时、语音/语义模型及固定版本插件准备完成。未自动启动后台 DSH。'
Write-Output '首次使用请在 DSH 模型设置连接本机 Ollama；本脚本不覆盖现有模型、上下文或账号配置。'
Write-Output '接下来正常运行 dsh web，在 Chrome 的对话里点击“课堂”。'
