"""Download public upstream assets; model licenses stay with their assets."""
import hashlib
import json
import sys
import tarfile
import urllib.request
from pathlib import Path


def download(url, dest):
    if dest.exists():
        return
    temporary = dest.with_suffix(dest.suffix + '.part')
    urllib.request.urlretrieve(url, temporary)
    temporary.replace(dest)


def main():
    from huggingface_hub import snapshot_download
    root = Path(sys.argv[1]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    for name, repo, revision in [
            ('turbo', 'mobiuslabsgmbh/faster-whisper-large-v3-turbo', '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf'),
            ('large-v3', 'Systran/faster-whisper-large-v3', 'edaa852ec7e145841d8ffdb056a99866b5f0a478')]:
        print('Downloading', name, flush=True)
        snapshot_download(repo, revision=revision, local_dir=root / name,
                          allow_patterns=['*.json', '*.bin', '*.txt', '*.md'])
    segmentation = root / 'segmentation.tar.bz2'
    download('https://github.com/k2-fsa/sherpa-onnx/releases/download/'
             'speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2', segmentation)
    with tarfile.open(segmentation) as archive:
        archive.extractall(root, filter='data')
    embedding = root / 'wespeaker_en_voxceleb_resnet34_LM.onnx'
    download('https://github.com/k2-fsa/sherpa-onnx/releases/download/'
             'speaker-recongition-models/' + embedding.name, embedding)
    chinese_embedding = root / '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'
    download('https://github.com/k2-fsa/sherpa-onnx/releases/download/'
             'speaker-recongition-models/' + chinese_embedding.name, chinese_embedding)
    manifest = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in root.rglob('*.onnx')}
    (root / 'speaker-sha256.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('Models ready:', root, flush=True)


if __name__ == '__main__':
    main()
