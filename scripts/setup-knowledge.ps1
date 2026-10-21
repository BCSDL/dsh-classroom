param([string]$Runtime=(Join-Path $env:USERPROFILE '.local-ai-tools\classroom'))
$ErrorActionPreference = 'Stop'
$runtimePath = $Runtime
$pythonPath = Join-Path $runtimePath 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw '请先运行 setup.ps1 准备课堂 Python 环境。' }
$env:DSH_CLASSROOM_EMBED_MODELS = Join-Path $runtimePath 'models\multilingual-e5-small'
$downloadCode = @'
import os
from pathlib import Path
from huggingface_hub import hf_hub_download
target = Path(os.environ['DSH_CLASSROOM_EMBED_MODELS'])
target.mkdir(parents=True, exist_ok=True)
revision = '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
for remote, local in [('tokenizer.json', 'tokenizer.json'), ('onnx/model_quantized.onnx', 'model_quantized.onnx')]:
    source = Path(hf_hub_download('Xenova/multilingual-e5-small', remote, revision=revision))
    import shutil
    shutil.copyfile(source, target / local)
print('CPU multilingual embedding model ready:', target)
'@
& $pythonPath -c $downloadCode
if ($LASTEXITCODE -ne 0) { throw '语义模型准备失败；现有课堂插件保持可用。' }
