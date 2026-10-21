param([string]$Commit, [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$Profile='web')
$ErrorActionPreference='Stop'
if (-not $Commit) { $Commit=Read-Host '粘贴已审核的 BCSDL/dsh-classroom 完整提交 SHA（40 位）' }
if ($Commit -notmatch '^[a-f0-9]{40}$') { throw '需要完整的固定提交 SHA，不安装浮动 main。' }
$dshHomePath=if($env:DSH_HOME){$env:DSH_HOME}else{Join-Path $env:USERPROFILE '.dsh'}
$profilePath=Join-Path $dshHomePath ('profiles\'+$Profile)
$packagePath=Join-Path $profilePath 'package.json'
if (-not (Test-Path -LiteralPath $packagePath)) { throw 'Profile 不存在，请先正常安装并运行 DSH；此脚本不会替换启动入口。' }
$before=Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$backupPath=Join-Path $env:USERPROFILE ('.local-ai-tools\backups\classroom-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupPath | Out-Null
foreach($name in @('package.json','pnpm-lock.yaml','cordis.patch.yml')) { $path=Join-Path $profilePath $name; if(Test-Path -LiteralPath $path){Copy-Item -LiteralPath $path -Destination (Join-Path $backupPath $name)} }
@{profile=$Profile;profilePath=$profilePath;previous=$before.dependencies.'dsh-classroom';next=$Commit} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupPath 'classroom-release.json') -Encoding UTF8
& dsh plugin --profile $Profile add ('https://codeload.github.com/BCSDL/dsh-classroom/tar.gz/'+$Commit) --ignore-scripts
if($LASTEXITCODE -ne 0){throw ('安装失败；备份保留在 '+$backupPath)}
& dsh --profile $Profile --dump-config | Out-Null
if($LASTEXITCODE -ne 0){throw ('配置校验未通过，请使用 rollback-release.ps1；备份：'+$backupPath)}
$after=Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
foreach($dependency in $before.dependencies.PSObject.Properties){if($dependency.Name -ne 'dsh-classroom' -and $after.dependencies.($dependency.Name) -ne $dependency.Value){throw ('其他依赖发生变化，请检查备份：'+$backupPath)}}
Write-Output ('安装和配置校验完成。备份：'+$backupPath)
Write-Output '请在原 DSH 终端正常退出后重启；脚本没有启动后台服务、修改 CLI 或结束现有进程。'
