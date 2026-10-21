"""Pinned multilingual E5 ONNX embeddings, CPU only, independent of the GPU queue."""
import json
import os
import sys
from pathlib import Path

CONFIG = json.loads(os.environ.get('DSH_CLASSROOM_CONFIG', '{}'))
DIRECTORY = Path(CONFIG['modelsDirectory']) / 'multilingual-e5-small'
SESSION = None
TOKENIZER = None


def call(operation, args):
    global SESSION, TOKENIZER
    available = all((DIRECTORY / name).is_file() for name in ['tokenizer.json', 'model_quantized.onnx'])
    if operation == 'status':
        return {'ready': available, 'provider': 'CPUExecutionProvider', 'model': 'multilingual-e5-small-int8'}
    if not available:
        raise RuntimeError('中英语义模型未准备好；请运行 scripts/setup-knowledge.ps1')
    import numpy as np
    if SESSION is None:
        import onnxruntime as ort
        from tokenizers import Tokenizer
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        SESSION = ort.InferenceSession(str(DIRECTORY / 'model_quantized.onnx'), options,
                                      providers=['CPUExecutionProvider'])
        TOKENIZER = Tokenizer.from_file(str(DIRECTORY / 'tokenizer.json'))
        TOKENIZER.enable_truncation(max_length=512, stride=96)
        TOKENIZER.enable_padding(length=512, pad_id=1, pad_token='<pad>')
    texts = [str(x)[:6000] for x in args.get('texts', [])[:12]]
    prefix = 'query: ' if args.get('query') else 'passage: '
    original = TOKENIZER.encode_batch([prefix + text for text in texts])
    groups, tokens = [], []
    for token in original:
        group = [token] + token.overflowing
        groups.append((len(tokens), len(group)))
        tokens.extend(group)
    if not tokens:
        return {'vectors': []}
    inputs = {'input_ids': np.array([t.ids for t in tokens], dtype=np.int64),
              'attention_mask': np.array([t.attention_mask for t in tokens], dtype=np.int64)}
    names = {item.name for item in SESSION.get_inputs()}
    if 'token_type_ids' in names:
        inputs['token_type_ids'] = np.zeros_like(inputs['input_ids'])
    outputs = SESSION.run(None, {k: v for k, v in inputs.items() if k in names})[0]
    mask = inputs['attention_mask'][..., None]
    vectors = (outputs * mask).sum(axis=1) / np.maximum(mask.sum(axis=1), 1)
    vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-8)
    pooled = np.stack([vectors[start:start + count].mean(axis=0) for start, count in groups])
    pooled /= np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-8)
    return {'vectors': pooled.tolist(), 'model': 'multilingual-e5-small-int8', 'provider': 'CPUExecutionProvider',
            'windows': [count for _, count in groups]}


for line in sys.stdin:
    try:
        request = json.loads(line)
        result = call(request['operation'], request.get('args', {}))
        response = {'id': request['id'], 'result': result}
    except Exception as error:
        response = {'id': locals().get('request', {}).get('id'), 'error': str(error)}
    print(json.dumps(response, ensure_ascii=False), flush=True)
