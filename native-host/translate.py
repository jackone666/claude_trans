#!/usr/bin/env python3
"""Native messaging host for Immersive Translate Chrome extension.

DeepSeek flash model, parallel batch translation via thread pool.
"""

import sys
import os

_STARTUP_LOG = os.path.expanduser('~/.claude/immersive-translate.log')
with open(_STARTUP_LOG, 'a') as f:
    f.write(f'[{__import__("datetime").datetime.now().isoformat()}] STARTUP pid={os.getpid()}\n')
    f.flush()

import json
import struct
import urllib.request
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

LOG_FILE = os.path.expanduser('~/.claude/immersive-translate.log')
logging.basicConfig(
    filename=LOG_FILE, level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s'
)

BATCH_SIZE = 10
WORKERS = 10

_settings_path = os.path.expanduser('~/.claude/settings.json')
with open(_settings_path) as f:
    _settings = json.load(f)
_env = _settings.get('env', {})
API_KEY = _env.get('ANTHROPIC_AUTH_TOKEN', '')
API_URL = f"{_env.get('ANTHROPIC_BASE_URL', 'https://api.deepseek.com/anthropic')}/v1/messages"
MODEL = 'deepseek-v4-flash'

SYSTEM_PROMPT = (
    'You are a professional translator. Translate each text block to {target_lang}. '
    'Output ONLY a valid JSON array: [{{"id": 0, "text": "translated"}}, ...]. '
    'No markdown, no explanations — pure JSON only.'
)


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len:
        return None
    msg_len = struct.unpack('@I', raw_len)[0]
    msg_bytes = sys.stdin.buffer.read(msg_len)
    return json.loads(msg_bytes.decode('utf-8'))


def send_message(msg):
    data = json.dumps(msg, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('@I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def _call_api(batch, target_lang):
    """Call DeepSeek API for one batch (runs in thread pool)."""
    import time
    t0 = time.time()

    items = []
    for b in batch:
        text = b['text']
        if len(text) > 2000:
            text = text[:2000] + '...'
        items.append({'id': b['id'], 'text': text})

    body = json.dumps({
        'model': MODEL,
        'max_tokens': min(8192, len(batch) * 100 + 500),
        'thinking': {'type': 'disabled'},
        'system': SYSTEM_PROMPT.replace('{target_lang}', target_lang),
        'messages': [{'role': 'user', 'content': json.dumps(items, ensure_ascii=False)}]
    }).encode('utf-8')

    req = urllib.request.Request(API_URL, data=body, headers={
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
    })
    resp = urllib.request.urlopen(req, timeout=120)
    data = json.loads(resp.read())
    elapsed = time.time() - t0

    content_text = ''
    for block in data.get('content', []):
        if block.get('type') == 'text':
            content_text += block.get('text', '')

    try:
        translations = json.loads(content_text)
    except json.JSONDecodeError:
        import re
        m = re.search(r'\[\s*\{.*?\}\s*\]', content_text, re.DOTALL)
        translations = json.loads(m.group()) if m else []

    in_tok = data.get('usage', {}).get('input_tokens', 0)
    out_tok = data.get('usage', {}).get('output_tokens', 0)
    logging.info(f'  Batch {len(batch)}blk: {elapsed:.1f}s in={in_tok} out={out_tok}')
    return translations


def translate(blocks, target_lang):
    """Split blocks into batches, translate in parallel via thread pool."""
    import time
    t0 = time.time()

    batches = [blocks[i:i + BATCH_SIZE] for i in range(0, len(blocks), BATCH_SIZE)]
    logging.info(f'Translating {len(blocks)} blocks in {len(batches)} batches '
                 f'({WORKERS} workers, {MODEL})')

    all_translations = []
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(_call_api, batch, target_lang): idx
                   for idx, batch in enumerate(batches)}
        for future in as_completed(futures):
            result = future.result()
            if result:
                all_translations.extend(result)

    all_translations.sort(key=lambda x: x['id'])
    elapsed = time.time() - t0
    logging.info(f'Done: {len(all_translations)}/{len(blocks)} in {elapsed:.1f}s')
    return {'translations': all_translations}


def main():
    send_message({'status': 'ready', 'version': '5.1'})

    while True:
        try:
            msg = read_message()
            if msg is None:
                break

            request_id = msg.get('requestId', '')
            action = msg.get('action', '')

            if action == 'translate':
                blocks = msg.get('blocks', [])
                target_lang = msg.get('targetLang', 'Chinese')
                result = translate(blocks, target_lang)
                result['requestId'] = request_id
                send_message(result)
            else:
                send_message({'requestId': request_id, 'error': f'Unknown action: {action}'})

        except BrokenPipeError:
            break
        except Exception as e:
            logging.error(f'Main loop error: {e}', exc_info=True)
            send_message({'error': str(e)})


if __name__ == '__main__':
    sys.stdout.reconfigure(line_buffering=False)
    main()
