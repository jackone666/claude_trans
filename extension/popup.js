const translateBtn = document.getElementById('translate-btn');
const restoreBtn = document.getElementById('restore-btn');
const langSelect = document.getElementById('lang');
const apikeyInput = document.getElementById('apikey');
const apikeyRow = document.getElementById('apikey-row');
const apikeyToggle = document.getElementById('apikey-toggle');
const statusEl = document.getElementById('status');
const progressBar = document.getElementById('progress-bar');
const progressInner = document.getElementById('progress-inner');

// Load saved preferences
chrome.storage.local.get(['targetLang', 'deepseekApiKey'], ({ targetLang, deepseekApiKey }) => {
  if (targetLang) langSelect.value = targetLang;
  if (deepseekApiKey) apikeyInput.value = deepseekApiKey;
});

langSelect.addEventListener('change', () => {
  chrome.storage.local.set({ targetLang: langSelect.value });
});

apikeyInput.addEventListener('change', () => {
  chrome.storage.local.set({ deepseekApiKey: apikeyInput.value.trim() });
});

apikeyToggle.addEventListener('click', () => {
  const show = apikeyRow.classList.toggle('show');
  apikeyToggle.textContent = show ? '设置 API Key ▴' : '设置 API Key ▾';
});

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = cls || '';
}

function setProgress(pct) {
  if (pct >= 0) {
    progressBar.style.display = 'block';
    progressInner.style.width = pct + '%';
  } else {
    progressBar.style.display = 'none';
    progressInner.style.width = '0%';
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

translateBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;

  if (!tab.url || /^(chrome|chrome-extension|about|edge):/.test(tab.url)) {
    setStatus('此页面无法翻译（系统页面限制）', 'error');
    return;
  }

  translateBtn.disabled = true;
  setStatus('正在翻译...');
  setProgress(0);

  try {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'translate',
      targetLang: langSelect.value
    });
  } catch (err) {
    if (err.message.includes('Could not establish connection')) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }).then(() => new Promise(r => setTimeout(r, 100)));
        await chrome.tabs.sendMessage(tab.id, {
          action: 'translate',
          targetLang: langSelect.value
        });
      } catch (e2) {
        setStatus('请刷新页面后重试', 'error');
        translateBtn.disabled = false;
        setProgress(-1);
        return;
      }
    } else {
      setStatus('翻译出错: ' + err.message, 'error');
      translateBtn.disabled = false;
      setProgress(-1);
      return;
    }
  }
});

restoreBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'restore' });
    setStatus('已恢复原文');
  } catch (err) {
    setStatus('恢复失败: ' + err.message, 'error');
  }
});

// Progress updates from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'progress') {
    setStatus(msg.status);
    if (msg.progress >= 0) setProgress(msg.progress);
  }
  if (msg.action === 'done') {
    setStatus('翻译完成', 'success');
    setProgress(100);
    setTimeout(() => setProgress(-1), 1500);
    translateBtn.disabled = false;
  }
  if (msg.action === 'error') {
    setStatus(msg.error, 'error');
    setProgress(-1);
    translateBtn.disabled = false;
  }
});
