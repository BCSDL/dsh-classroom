param([string]$BackupPath)
$ErrorActionPreference='Stop'
if(-not $BackupPath){$BackupPath=Read-Host '输入 install-release.ps1 输出的完整备份目录'}
$metadata=Get-Content -LiteralPath (Join-Path $BackupPath 'classroom-release.json') -Raw | ConvertFrom-Json
if($metadata.profile -notmatch '^[a-zA-Z0-9_-]+$' -or -not $metadata.previous){throw '备份中没有有效的旧课堂版本'}
& dsh plugin --profile $metadata.profile add $metadata.previous --ignore-scripts
if($LASTEXITCODE -ne 0){throw '恢复旧依赖失败；未替换其他配置'}
$patch=Join-Path $BackupPath 'cordis.patch.yml'
if(Test-Path -LiteralPath $patch){Copy-Item -LiteralPath $patch -Destination (Join-Path $metadata.profilePath 'cordis.patch.yml')}
& dsh --profile $metadata.profile --dump-config | Out-Null
if($LASTEXITCODE -ne 0){throw '旧版本配置仍未通过，请检查原备份'}
Write-Output '已恢复旧课堂插件。录音和知识资料保留；请在原终端正常重启 DSH。'
