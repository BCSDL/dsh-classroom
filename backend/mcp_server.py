"""Standalone MCP adapter; a separate CLI config/store is supplied by the launcher."""
import base64
import json
import sys
import threading
from pathlib import Path
import worker

TOOLS = [
    {'name': 'classroom', 'description': 'Local speech jobs: status,list,get,start_file,create_live,finish,enhance,cancel,resume. args is JSON text. start_file:{path,title,options:{language:en|zh|auto,quality:turbo|large-v3,translate,summarize},materials:[{kind:document|video,path}]}. get:{id,offset,limit}. Jobs are durable; poll get. No microphone capture through this tool; use the DSH UI.',
     'inputSchema': {'type': 'object', 'properties': {'operation': {'type': 'string'}, 'args': {'type': 'string'}}, 'required': ['operation']}},
    {'name': 'read_document', 'description': 'Read PDF, scans, PPTX, DOCX, XLSX, images and text/code files; optional readers support DXF, STEP, IGES, STL, OBJ, PLY and glTF. Returns source/page references and bounded text, plus page images for vision. PPTX complete layout requires PDF export. Binary proprietary files need a converter. limit defaults to 3; explicit truncation is reported.',
     'inputSchema': {'type': 'object', 'properties': {'path': {'type': 'string'}, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 100}, 'images': {'type': 'boolean'}}, 'required': ['path']}}
]


def main():
    worker.recover()
    threading.Thread(target=worker.runner, daemon=True).start()
    for line in sys.stdin:
        identifier = None
        try:
            request = json.loads(line)
            identifier = request.get('id')
            if identifier is None:
                continue
            method = request.get('method')
            params = request.get('params', {})
            if method == 'initialize':
                result = {'protocolVersion': params.get('protocolVersion', '2024-11-05'),
                          'capabilities': {'tools': {}}, 'serverInfo': {'name': 'dsh-classroom', 'version': '0.1.2'}}
            elif method == 'ping':
                result = {}
            elif method == 'tools/list':
                result = {'tools': TOOLS}
            elif method == 'tools/call':
                name, args = params['name'], params.get('arguments', {})
                if name == 'classroom':
                    value = worker.dispatch(args['operation'], json.loads(args.get('args', '{}')))
                    content = [{'type': 'text', 'text': json.dumps(value, ensure_ascii=False)}]
                elif name == 'read_document':
                    value = worker.dispatch('document', {'limit': 3, **args})
                    content = [{'type': 'text', 'text': json.dumps(value, ensure_ascii=False)}]
                    if args.get('images', True):
                        for page in value['pages'][:3]:
                            if page.get('image'):
                                import io
                                from PIL import Image
                                with Image.open(page['image']) as image:
                                    output = io.BytesIO()
                                    image.convert('RGB').save(output, format='JPEG', quality=85)
                                content.append({'type': 'image', 'mimeType': 'image/jpeg',
                                                'data': base64.b64encode(output.getvalue()).decode()})
                else:
                    raise ValueError('Unknown tool')
                result = {'content': content, 'isError': False}
            else:
                print(json.dumps({'jsonrpc': '2.0', 'id': identifier,
                                  'error': {'code': -32601, 'message': 'Unsupported method'}}), flush=True)
                continue
            response = {'jsonrpc': '2.0', 'id': identifier, 'result': result}
        except Exception as error:
            response = {'jsonrpc': '2.0', 'id': identifier, 'result': {'content': [{'type': 'text', 'text': str(error)}], 'isError': True}}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
