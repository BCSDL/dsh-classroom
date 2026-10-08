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
    {'name': 'read_document', 'description': 'Read PDF, scans, PPTX, DOCX, XLSX, images and text/code files. Returns source/page references and bounded text, plus page images for vision. PPTX complete layout requires PDF export. Binary proprietary files need a converter. limit defaults to 3; explicit truncation is reported.',
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
                          'capabilities': {'tools': {}}, 'serverInfo': {'name': 'dsh-classroom', 'version': '0.1.0'}}
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
                    value = worker.dispatch('document', args)
                    content = [{'type': 'text', 'text': json.dumps(value, ensure_ascii=False)}]
                    if args.get('images', True):
                        for page in value['pages'][:3]:
                            if page.get('image'):
                                data = Path(page['image']).read_bytes()
                                mime = 'image/png' if data.startswith(b'\x89PNG') else 'image/jpeg'
                                content.append({'type': 'image', 'mimeType': mime, 'data': base64.b64encode(data).decode()})
                else:
                    raise ValueError('Unknown tool')
                result = {'content': content, 'isError': False}
            else:
                raise ValueError('Unsupported method')
            response = {'jsonrpc': '2.0', 'id': identifier, 'result': result}
        except Exception as error:
            response = {'jsonrpc': '2.0', 'id': identifier, 'result': {'content': [{'type': 'text', 'text': str(error)}], 'isError': True}}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
