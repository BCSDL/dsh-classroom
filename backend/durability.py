"""Recover an acknowledged file even when a process stops before its job metadata commit."""
import hashlib
import math
import os
import re
import shutil
from pathlib import Path


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while block := stream.read(1024 * 1024): value.update(block)
    return value.hexdigest()


def accept(w, job, index, source, offset):
    if not math.isfinite(offset) or offset < 0:
        raise ValueError('音频时间必须是非负有限秒数')
    inputs = w.job_dir(job['id']) / 'inputs'
    suffix = source.suffix.lower()
    if not re.fullmatch(r'\.[a-z0-9]{1,8}', suffix):
        raise ValueError('音频片段后缀无效')
    target = inputs / (f'live-{index:08d}' + suffix)
    receipt = inputs / f'pending-live-{index:08d}.json'
    item = {'target': target.name, 'bytes': source.stat().st_size, 'sha256': digest(source), 'offset': offset, 'index': index}
    w.atomic_json(receipt, item)
    temporary = target.with_name(target.name + '.part')
    try:
        with source.open('rb') as incoming, temporary.open('wb') as output:
            shutil.copyfileobj(incoming, output, 1024 * 1024)
            output.flush(); os.fsync(output.fileno())
        temporary.replace(target)
        job['chunks'][str(index)] = {'path': str(target), 'offset': offset, 'sha256': item['sha256']}
        w.save_job(job)
        receipt.unlink(missing_ok=True)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def recover(w, identifier):
    job = w.read_job(identifier)
    for receipt in (w.job_dir(identifier) / 'inputs').glob('pending-live-*.json'):
        try:
            item = __import__('json').loads(receipt.read_text(encoding='utf-8'))
            if not re.fullmatch(r'live-\d{8,12}\.[a-z0-9]{1,8}', item.get('target', '')):
                continue
            if not isinstance(item.get('index'),int) or not 0 <= item['index'] < 10**12 or not math.isfinite(item.get('offset',-1)) or item.get('offset',-1)<0:
                continue
            target = receipt.parent / item['target']
            if not target.is_file() or target.stat().st_size != item.get('bytes') or digest(target) != item.get('sha256'):
                continue
            if str(item['index']) not in job['chunks']:
                job['chunks'][str(item['index'])] = {'path': str(target), 'offset': item['offset'], 'sha256': item['sha256']}
                w.save_job(job)
            receipt.unlink(missing_ok=True)
        except Exception as error:
            print('classroom pending audio recovery: '+str(error), file=__import__('sys').stderr)
