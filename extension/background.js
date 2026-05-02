const API_BASE = 'https://api.deepseek.com/anthropic/v1/messages';
const MODEL = 'deepseek-v4-flash';
const BATCH_SIZE = 10;
const WORKERS = 10;

const SYSTEM_PROMPT = 'You are a professional translator. Translate each text block to {target_lang}. Output ONLY a valid JSON array: [{"id": 0, "text": "translated"}, ...]. No markdown, no explanations — pure JSON only.';

async function getApiKey() {
  const { deepseekApiKey } = await chrome.storage.local.get('deepseekApiKey');
  if (!deepseekApiKey) {
    throw new Error('请先在插件弹窗中设置 DeepSeek API Key');
  }
  return deepseekApiKey;
}

async function callApi(batch, targetLang, apiKey) {
  const items = batch.map(b => {
    const text = b.text.length > 2000 ? b.text.slice(0, 2000) + '...' : b.text;
    return { id: b.id, text };
  });

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: Math.min(8192, batch.length * 100 + 500),
    thinking: { type: 'disabled' },
    system: SYSTEM_PROMPT.replace('{target_lang}', targetLang),
    messages: [{ role: 'user', content: JSON.stringify(items) }]
  });

  const resp = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  let contentText = '';
  for (const block of data.content || []) {
    if (block.type === 'text') contentText += block.text;
  }

  try {
    return JSON.parse(contentText);
  } catch {
    // Try regex extraction as fallback
    const m = contentText.match(/\[\s*\{.*?\}\s*\]/s);
    return m ? JSON.parse(m[0]) : [];
  }
}

async function translateAll(blocks, targetLang) {
  const apiKey = await getApiKey();

  const batches = [];
  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    batches.push(blocks.slice(i, i + BATCH_SIZE));
  }

  // Parallel API calls with concurrency limit
  const results = new Array(batches.length);
  let idx = 0;

  async function worker() {
    while (idx < batches.length) {
      const i = idx++;
      results[i] = await callApi(batches[i], targetLang, apiKey);
    }
  }

  const workers = Array(Math.min(WORKERS, batches.length)).fill(null).map(() => worker());
  await Promise.all(workers);

  const allTranslations = results.flat();
  allTranslations.sort((a, b) => a.id - b.id);
  return { translations: allTranslations };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'translateBlocks') {
    translateAll(msg.blocks, msg.targetLang)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});
