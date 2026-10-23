"""Read-only image inventory, bounded visual previews, and durable review receipts."""
import hashlib
import json
import math
import os
import re
import uuid
from datetime import datetime
from pathlib import Path

EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'}


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    temporary.replace(path)


def folder(root, identifier):
    if not re.fullmatch(r'[a-f0-9]{32}', str(identifier)):
        raise ValueError('需要 scan 返回的真实 catalog 编号')
    return root / 'photo-evidence' / identifier


def load(root, identifier):
    directory = folder(root, identifier)
    return directory, json.loads((directory / 'catalog.json').read_text(encoding='utf-8'))


def public(catalog):
    return {key: catalog[key] for key in ['id', 'root', 'createdAt', 'dateBasis', 'window', 'totalImages',
        'selectedCount', 'undatedCount', 'complete', 'errors', 'earliestName', 'latestName']}


def checked_image(catalog, item):
    path = Path(item['path'])
    actual = path.resolve()
    if not actual.is_relative_to(Path(catalog['root'])) or path.is_symlink() or not actual.is_file():
        raise ValueError('图片已移动或指向目录外，请重新 scan')
    stat = actual.stat()
    if stat.st_size != item['bytes'] or stat.st_mtime_ns != item['mtimeNs']:
        raise ValueError('图片已改变，旧看图记录无效，请重新 scan')
    return actual


def dispatch(root, operation, args):
    from PIL import Image, ImageDraw, ImageFont, ImageOps
    if operation == 'scan':
        source = Path(args['path']).resolve(strict=True)
        if not source.is_dir():
            raise ValueError('path 必须是实际图片目录')
        window = args.get('window') or {'kind': 'all', 'start': None, 'end': None}
        rows, errors = [], []
        def visit(directory):
            try:
                with os.scandir(directory) as scan:
                    entries = sorted(scan, key=lambda e: e.name.casefold())
                for entry in entries:
                    path = Path(entry.path)
                    if entry.is_symlink() or getattr(path, 'is_junction', lambda: False)():
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        if args.get('recursive', False):
                            visit(path)
                        continue
                    if not entry.is_file(follow_symlinks=False) or path.suffix.lower() not in EXTENSIONS:
                        continue
                    stat = entry.stat(follow_symlinks=False)
                    stamp = None
                    if args.get('dateBasis', 'filename') == 'mtime':
                        stamp = datetime.fromtimestamp(stat.st_mtime).date().isoformat()
                    elif re.fullmatch(r'\d{14}', path.stem):
                        try:
                            stamp = datetime.strptime(path.stem, '%Y%m%d%H%M%S').date().isoformat()
                        except ValueError:
                            pass
                    relative = str(path.relative_to(source))
                    identifier = hashlib.sha256(relative.casefold().encode()).hexdigest()[:16]
                    selected = window['kind'] == 'all' or bool(stamp and window['start'] <= stamp <= window['end'])
                    rows.append({'id': identifier, 'name': relative, 'path': str(path), 'date': stamp,
                        'bytes': stat.st_size, 'mtimeNs': stat.st_mtime_ns, 'selected': selected})
            except OSError as error:
                errors.append({'path': str(directory), 'error': str(error)})
        visit(source)
        if len({x['id'] for x in rows}) != len(rows):
            raise ValueError('清单编号冲突，未保存不完整目录')
        rows.sort(key=lambda r: (r['date'] or '', r['name'].casefold()), reverse=True)
        identifier = uuid.uuid4().hex
        directory = folder(root, identifier); directory.mkdir(parents=True)
        catalog = {'id': identifier, 'root': str(source), 'scope': args.get('scope'), 'createdAt': args['now'],
            'dateBasis': args.get('dateBasis', 'filename'), 'window': window, 'totalImages': len(rows),
            'selectedCount': sum(x['selected'] for x in rows), 'undatedCount': sum(x['date'] is None for x in rows),
            'complete': not errors, 'errors': errors, 'earliestName': rows[-1]['name'] if rows else None,
            'latestName': rows[0]['name'] if rows else None, 'rows': rows, 'delivered': {}, 'reviews': {}}
        write_json(directory / 'catalog.json', catalog)
        return {**public(catalog), 'manifestPath': str(directory / 'catalog.json'),
            'notice': '清单是完整枚举后的日期筛选；尚未看图。filename 日期来自文件名，不等于验证拍摄时间。'}
    directory, catalog = load(root, args['catalog'])
    if catalog.get('scope') != args.get('scope'):
        raise ValueError('图片清单不属于当前项目，请重新 scan')
    rows = [r for r in catalog['rows'] if r['selected']]
    if operation == 'list':
        offset = max(0, int(args.get('offset', 0))); limit = min(100, max(1, int(args.get('limit', 30))))
        return {**public(catalog), 'offset': offset, 'items': [{k: r[k] for k in ['id', 'name', 'date', 'bytes']} for r in rows[offset:offset+limit]],
            'nextOffset': offset+limit if offset+limit < len(rows) else None,
            'pageTruncated': offset+limit < len(rows), 'inventoryComplete': catalog['complete']}
    if operation in {'sheet', 'inspect'}:
        by_id = {r['id']: r for r in rows}
        if operation == 'sheet':
            offset = max(0, int(args.get('offset', 0)))
            selected = rows[offset:offset+12]
        else:
            ids = list(dict.fromkeys(args.get('ids', [])))
            if not 1 <= len(ids) <= 3 or any(i not in by_id for i in ids):
                raise ValueError('inspect 需要 list/sheet 中 1–3 个真实图片编号')
            selected = [by_id[i] for i in ids]
        if not selected:
            raise ValueError('该页没有图片')
        outputs, items = [], []
        font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 16) if os.name == 'nt' else ImageFont.load_default()
        sheet = Image.new('RGB', (1080, math.ceil(len(selected)/3)*258), '#eeeeee') if operation == 'sheet' else None
        draw = ImageDraw.Draw(sheet) if sheet else None
        for index, item in enumerate(selected):
            path = checked_image(catalog, item)
            with Image.open(path) as original:
                image = ImageOps.exif_transpose(original).convert('RGB')
                width, height = image.size
                image.thumbnail((350, 210) if sheet else (1600, 1600))
                if sheet:
                    x, y = index % 3 * 360, index // 3 * 258
                    sheet.paste(image, (x+(360-image.width)//2, y+(210-image.height)//2))
                    draw.text((x+5, y+212), item['id'], fill='black', font=font)
                    draw.text((x+5, y+233), Path(item['name']).name[:34], fill='black', font=font)
                else:
                    output = directory / (item['id']+'.jpg'); image.save(output, quality=91)
                    outputs.append(str(output))
            items.append({'id': item['id'], 'name': item['name'], 'width': width, 'height': height})
        if sheet:
            output = directory / ('sheet-'+str(offset)+'.jpg'); sheet.save(output, quality=91); outputs.append(str(output))
        return {**public(catalog), 'items': items, 'imagePaths': outputs, 'viewKind': operation,
            'nextOffset': offset+12 if sheet and offset+12 < len(rows) else None,
            'notice': '缩略图仅用于初筛；最终候选应 inspect。图片成功交付给模型后才登记为可用视觉证据。'}
    if operation == 'delivered':
        ids = args.get('ids', []); by_id = {r['id']: r for r in rows}
        for identifier in ids:
            if identifier not in by_id:
                raise ValueError('交付编号不属于本次筛选')
            checked_image(catalog, by_id[identifier])
            old = catalog['delivered'].get(identifier)
            if old != 'inspect': catalog['delivered'][identifier] = args['viewKind']
        write_json(directory/'catalog.json', catalog)
        return {'delivered': len(ids)}
    if operation == 'review':
        reviews = args.get('reviews', [])
        if not 1 <= len(reviews) <= 12:
            raise ValueError('一次登记 1–12 张图片的实际评语')
        by_id = {r['id']: r for r in rows}
        for review in reviews:
            identifier = review['id']
            if identifier not in by_id or identifier not in catalog['delivered']:
                raise ValueError('不能给未实际交付图片的文件评分，请先 sheet/inspect')
            checked_image(catalog, by_id[identifier])
            score = float(review['score']); reason = str(review['reason']).strip()
            if not math.isfinite(score) or not 0 <= score <= 10 or not 8 <= len(reason) <= 1500:
                raise ValueError('score 应为 0–10，reason 需为具体可见内容（8–1500 字符）')
        for review in reviews:
            catalog['reviews'][review['id']] = {**review, 'viewKind': catalog['delivered'][review['id']]}
        write_json(directory/'catalog.json', catalog)
    if operation in {'review', 'result'}:
        by_id = {r['id']: r for r in rows}
        for identifier in catalog['delivered']:
            checked_image(catalog, by_id[identifier])
        ranked = sorted(catalog['reviews'].values(), key=lambda r: float(r['score']), reverse=True)
        candidates = [{**review, 'name': by_id[review['id']]['name'], 'path': by_id[review['id']]['path'],
            'fullPreviewDelivered': catalog['delivered'].get(review['id']) == 'inspect'} for review in ranked[:min(10, max(1, int(args.get('limit', 5))))]]
        eligible = bool(catalog['complete'] and rows and len(catalog['reviews']) == len(rows)
            and all(c['fullPreviewDelivered'] for c in candidates))
        result = {**public(catalog), 'visualDelivered': len(catalog['delivered']), 'reviewed': len(catalog['reviews']),
            'unreviewed': len(rows)-len(catalog['reviews']), 'eligibleForCompleteSelection': eligible,
            'selectionLabel': '本次日期/目录范围内的主观评选' if eligible else '已审阅候选中的暂定推荐，不是全目录最佳',
            'candidates': candidates, 'reportPath': str(directory/'review-report.json')}
        write_json(directory/'review-report.json', result)
        return result
    raise ValueError('未知图片证据操作')
