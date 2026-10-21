"""Portable knowledge backups; restore always extracts into a new bounded staging directory."""
import json
import shutil
import stat
import time
import uuid
import zipfile
from pathlib import Path, PurePosixPath


def backup(root):
    knowledge = root / 'knowledge'
    if not (knowledge / 'classroom-sources.json').is_file():
        raise ValueError('知识库尚未初始化')
    outputs = root / 'exports'
    outputs.mkdir(exist_ok=True)
    destination = outputs / ('knowledge-' + str(time.time_ns()) + '.zip')
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        for path in knowledge.rglob('*'):
            if path.is_symlink():
                raise ValueError('知识库中有符号链接，已停止备份')
            if path.is_file() and not path.name.endswith(('.tmp', '.part')):
                if not path.resolve().is_relative_to(knowledge.resolve()):
                    raise ValueError('知识库路径越界')
                archive.write(path, path.relative_to(knowledge).as_posix())
    return {'path': str(destination), 'bytes': destination.stat().st_size}


def restore(root, source):
    destination = root / 'restore-staging' / uuid.uuid4().hex
    destination.mkdir(parents=True)
    maximum = min(64 * 1024 ** 3, shutil.disk_usage(destination).free - 128 * 1024 ** 2)
    try:
        with zipfile.ZipFile(source) as archive:
            total = 0
            if len(archive.infolist()) > 200000:
                raise ValueError('备份条目数量过多')
            for entry in archive.infolist():
                name = PurePosixPath(entry.filename.replace('\\', '/'))
                if name.is_absolute() or '..' in name.parts or ':' in entry.filename or stat.S_ISLNK(entry.external_attr >> 16):
                    raise ValueError('备份包含越界或链接条目')
                target = destination.joinpath(*name.parts).resolve()
                if not target.is_relative_to(destination.resolve()):
                    raise ValueError('备份路径越界')
                total += entry.file_size
                if total > maximum:
                    raise ValueError('备份展开后超过可用空间或 64 GiB 限制')
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(entry) as incoming, target.open('xb') as output:
                        shutil.copyfileobj(incoming, output, 1024 * 1024)
        json.loads((destination / 'classroom-sources.json').read_text(encoding='utf-8'))
        return {'path': str(destination), 'bytes': total}
    except Exception:
        if destination.resolve().is_relative_to((root / 'restore-staging').resolve()):
            shutil.rmtree(destination)
        raise
