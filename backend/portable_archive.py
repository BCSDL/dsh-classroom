"""Versioned backups, verified before target data can be merged."""
import hashlib
from contextlib import closing
import json
import os
import shutil
import stat
import sqlite3
import time
import uuid
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath

MANIFEST = '.classroom/manifest.json'


def linked(path):
    return path.is_symlink() or getattr(path, 'is_junction', lambda: False)()


def backup(root):
    root = root.resolve()
    knowledge = root / 'knowledge'
    if not (knowledge / 'classroom-sources.json').is_file():
        raise ValueError('知识库尚未初始化')
    records, sources = [], [(knowledge, '')]
    for directory in sorted((root / 'jobs').glob('*')):
        if not directory.is_dir() or not (directory / 'job.json').is_file():
            continue
        job = json.loads((directory / 'job.json').read_text(encoding='utf-8'))
        if job.get('state') not in {'complete', 'paused', 'cancelled', 'error'} or job.get('nativeCapture'):
            raise ValueError('请先结束录音并暂停或完成后台分析，再导出完整备份')
        records.append({'id': directory.name, 'deleted': False})
        sources.append((directory, '.classroom/records/' + directory.name + '/'))
    for directory in sorted((root / 'recycle-bin').glob('*/cache')):
        if (directory / 'job.json').is_file():
            job = json.loads((directory / 'job.json').read_text(encoding='utf-8'))
            records.append({'id': job['id'], 'deleted': True})
            sources.append((directory, '.classroom/records/' + job['id'] + '/'))
    files = []
    for base, prefix in sources:
        if linked(base) or not base.resolve().is_relative_to(root):
            raise ValueError('备份源目录出现链接或越界')
        for path in base.rglob('*'):
            if linked(path) or not path.resolve().is_relative_to(base.resolve()):
                raise ValueError('备份源中有链接，已停止导出')
            if path.is_file() and not path.name.endswith(('.tmp', '.part', '-wal', '-shm')):
                if path.suffix == '.sqlite':
                    with closing(sqlite3.connect(path, timeout=15)) as db:
                        if db.execute('PRAGMA wal_checkpoint(FULL)').fetchone()[0]:
                            raise ValueError('播放器时间轴仍在保存，请稍后重试备份')
                files.append((path, prefix + path.relative_to(base).as_posix()))
    if sum(p.stat().st_size for p, _ in files) + 128 * 1024 ** 2 > shutil.disk_usage(root).free:
        raise ValueError('磁盘空间不足以生成完整备份，现有数据保持')
    outputs = root / 'exports'
    outputs.mkdir(exist_ok=True)
    if linked(outputs) or not outputs.resolve().is_relative_to(root):
        raise ValueError('备份输出目录越界')
    destination = outputs / ('knowledge-' + str(time.time_ns()) + '.zip')
    partial = destination.with_suffix('.zip.part')
    hashes = {}
    try:
        with zipfile.ZipFile(partial, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            for path, name in files:
                before = path.stat()
                digest, size = hashlib.sha256(), 0
                with path.open('rb') as incoming, archive.open(name, 'w', force_zip64=True) as output:
                    while block := incoming.read(1024 * 1024):
                        output.write(block)
                        digest.update(block)
                        size += len(block)
                after = path.stat()
                if size != before.st_size or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise ValueError('备份时文件发生修改，请等待任务停止后重试')
                hashes[name] = {'sha256': digest.hexdigest(), 'bytes': size}
            archive.writestr(MANIFEST, json.dumps({'format': 2, 'created': time.time(),
                'sourceRoot': str(root), 'records': records, 'files': hashes}, ensure_ascii=False))
        partial.replace(destination)
        return {'path': str(destination), 'bytes': destination.stat().st_size,
                'format': 2, 'files': len(hashes), 'records': len(records), 'integrity': 'SHA-256'}
    except Exception:
        partial.unlink(missing_ok=True)
        raise


def restore(root, source):
    parent = root / 'restore-staging'
    parent.mkdir(parents=True, exist_ok=True)
    if linked(parent) or not parent.resolve().is_relative_to(root.resolve()):
        raise ValueError('恢复暂存目录越界')
    destination = root / 'restore-staging' / uuid.uuid4().hex
    destination.mkdir(parents=True)
    maximum = max(0, shutil.disk_usage(destination).free - 256 * 1024 ** 2)
    try:
        with zipfile.ZipFile(source) as archive:
            total, seen = 0, set()
            if len(archive.infolist()) > 200000:
                raise ValueError('备份条目数量过多')
            for entry in archive.infolist():
                name = PurePosixPath(entry.filename.replace('\\', '/'))
                if not name.parts or name.is_absolute() or '..' in name.parts or ':' in entry.filename or stat.S_ISLNK(entry.external_attr >> 16):
                    raise ValueError('备份包含越界或链接条目')
                normalized = name.as_posix().casefold() if os.name == 'nt' else name.as_posix()
                if normalized in seen or entry.flag_bits & 1:
                    raise ValueError('备份有重复名称或加密条目')
                seen.add(normalized)
                target = destination.joinpath(*name.parts).resolve()
                if not target.is_relative_to(destination.resolve()):
                    raise ValueError('备份路径越界')
                total += entry.file_size
                if total > maximum:
                    raise ValueError('备份展开后超过磁盘可用空间')
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(entry) as incoming, target.open('xb') as output:
                        shutil.copyfileobj(incoming, output, 1024 * 1024)
        manifest_path = destination / MANIFEST
        verified = 0
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            if manifest.get('format') != 2:
                raise ValueError('不支持的备份版本')
            actual = {p.relative_to(destination).as_posix() for p in destination.rglob('*') if p.is_file() and p != manifest_path}
            if actual != set(manifest.get('files', {})):
                raise ValueError('备份清单与文件不一致')
            for name, expected in manifest['files'].items():
                path = destination / name
                digest = hashlib.sha256()
                with path.open('rb') as stream:
                    while block := stream.read(1024 * 1024):
                        digest.update(block)
                if path.stat().st_size != expected['bytes'] or digest.hexdigest() != expected['sha256']:
                    raise ValueError('备份完整性校验失败：' + name)
                verified += 1
        json.loads((destination / 'classroom-sources.json').read_text(encoding='utf-8'))
        return {'path': str(destination), 'bytes': total, 'verifiedFiles': verified,
                'format': 2 if manifest_path.exists() else 1,
                'warning': None if manifest_path.exists() else '旧版备份没有完整性清单，仅恢复其中存在的知识资料'}
    except Exception:
        if destination.resolve().is_relative_to((root / 'restore-staging').resolve()):
            shutil.rmtree(destination)
        raise


def restore_records(w, staging, scope='unbound'):
    """Rebase stopped records into new IDs. Never execute or overwrite local jobs."""
    staging = Path(staging).resolve()
    if not staging.is_relative_to((w.ROOT / 'restore-staging').resolve()):
        raise ValueError('无效恢复暂存目录')
    path = staging / MANIFEST
    if not path.is_file():
        return {'mapping': {}, 'records': []}
    manifest = json.loads(path.read_text(encoding='utf-8'))
    map_path = w.ROOT / 'restored-records.json'
    saved = json.loads(map_path.read_text(encoding='utf-8')) if map_path.exists() else {}
    mapping, pending, records = {}, [], []
    for entry in manifest.get('records', []):
        old = entry['id']
        if not __import__('re').fullmatch(r'[a-f0-9]{32}', old):
            raise ValueError('备份记录编号无效')
        source = staging / '.classroom' / 'records' / old
        raw = (source / 'job.json').read_bytes()
        key = hashlib.sha256((manifest['sourceRoot'] + ':' + scope + ':' + old).encode() + raw).hexdigest()
        existing = saved.get(key)
        if existing and ((w.ROOT / 'jobs' / existing / 'job.json').is_file() or any((w.ROOT / 'recycle-bin').glob(existing+'-*/cache/job.json'))):
            mapping[old] = existing
            records.append({'id': existing, 'deleted': bool(entry.get('deleted')), 'reused': True})
        else:
            identifier = uuid.uuid4().hex
            mapping[old] = identifier
            pending.append((entry, source, identifier, key))
    source_root = manifest['sourceRoot'].replace('\\', '/').rstrip('/')
    def rebase(value):
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                normalized = item.replace('\\', '/') if isinstance(item, str) else ''
                if key in {'path', 'image', 'source'} and isinstance(item, str) and (Path(item).is_absolute() or PureWindowsPath(item).is_absolute() or '://' in item) and not normalized.casefold().startswith((source_root + '/').casefold()):
                    result[key] = None
                else:
                    result[key] = rebase(item)
            return result
        if isinstance(value, list):
            return [rebase(item) for item in value]
        if not isinstance(value, str):
            return value
        if value in mapping:
            return mapping[value]
        normalized = value.replace('\\', '/')
        if normalized.casefold().startswith((source_root + '/').casefold()):
            parts = PurePosixPath(normalized[len(source_root) + 1:]).parts
            if '..' in parts:
                raise ValueError('备份记录内路径越界')
            if len(parts) > 1 and parts[0] == 'jobs' and parts[1] in mapping:
                parts = ('jobs', mapping[parts[1]], *parts[2:])
            return str(w.ROOT.joinpath(*parts))
        return value
    for entry, source, identifier, key in pending:
        target = w.ROOT / 'jobs' / identifier
        temporary = w.ROOT / 'jobs' / (identifier + '.restore-part')
        shutil.copytree(source, temporary)
        try:
            for name in ['inputs', 'audio', 'results']:
                (temporary / name).mkdir(exist_ok=True)
            for p in temporary.rglob('*'):
                if p.suffix == '.json':
                    p.write_text(json.dumps(rebase(json.loads(p.read_text(encoding='utf-8'))), ensure_ascii=False), encoding='utf-8')
                elif p.suffix == '.jsonl':
                    rows = [json.dumps(rebase(json.loads(line)), ensure_ascii=False) for line in p.read_text(encoding='utf-8').splitlines() if line.strip()]
                    p.write_text('\n'.join(rows) + '\n', encoding='utf-8')
                elif p.suffix == '.sqlite':
                    with closing(sqlite3.connect(p)) as db, db:
                        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                        if 'frames' in tables:
                            for index, old_path in db.execute('SELECT idx,path FROM frames').fetchall():
                                db.execute('UPDATE frames SET path=? WHERE idx=?', (rebase(old_path), index))
                            columns = {row[1] for row in db.execute('PRAGMA table_info(frames)')}
                            if 'result' in columns:
                                for index, old_result in db.execute('SELECT idx,result FROM frames').fetchall():
                                    if old_result:
                                        db.execute('UPDATE frames SET result=? WHERE idx=?', (rebase(old_result), index))
            job_path = temporary / 'job.json'
            job = json.loads(job_path.read_text(encoding='utf-8'))
            job.update(id=identifier, deleted=False, nativeCapture=False, titlePending=False,
                       titleAttempted=True, restoredFrom=entry['id'], cancelRequested=False, deferredImport=False)
            if job.get('kind') in {'live', 'watch'}:
                job['recordingFinished'] = True
            job['materials'] = [m for m in job.get('materials', []) if m.get('path') and Path(m['path']).is_relative_to(w.ROOT)]
            if job.get('state') not in {'complete', 'paused', 'cancelled', 'error'}:
                job.update(state='paused', phase='从备份恢复，等待人工继续')
            if job.get('source') and not Path(job['source']).is_relative_to(w.ROOT):
                job.update(source=None, missingOriginal=True)
            job_path.write_text(json.dumps(job, ensure_ascii=False), encoding='utf-8')
            temporary.replace(target)
            saved[key] = identifier
            w.atomic_json(map_path, saved)
            records.append({'id': identifier, 'deleted': bool(entry.get('deleted')), 'reused': False})
        except Exception:
            if temporary.exists():
                shutil.rmtree(temporary)
            raise
    return {'mapping': mapping, 'records': records}
