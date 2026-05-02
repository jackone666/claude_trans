(function () {
  'use strict';

  let originalTexts = new Map(); // id → original text
  let allTranslatedNodes = new Map(); // id → text node (persistent across incremental batches)
  let blockElements = [];
  let isTranslating = false;
  let translatedNodes = new WeakSet();

  const BLOCK_ELEMENTS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'TD', 'TH', 'DT', 'DD', 'FIGCAPTION', 'BLOCKQUOTE',
    'A', 'SPAN', 'BUTTON', 'LABEL', 'LEGEND',
    'STRONG', 'EM', 'B', 'I', 'U', 'SMALL', 'MARK'
  ]);

  const SKIP_ELEMENTS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
    'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'INPUT', 'TEXTAREA',
    'SELECT', 'OPTION', 'MATH', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR'
  ]);

  function isCodeDescendant(el) {
    let cur = el;
    while (cur) {
      if (SKIP_ELEMENTS.has(cur.tagName)) return true;
      if (cur.isContentEditable) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function isVisible(elem) {
    if (!elem) return false;
    const style = window.getComputedStyle(elem);
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      elem.offsetWidth > 0 &&
      elem.offsetHeight > 0;
  }

  function extractTextBlocks(skipTranslated) {
    const blocks = [];
    blockElements = [];

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          if (!node.parentElement) return NodeFilter.FILTER_REJECT;
          if (isCodeDescendant(node.parentElement)) return NodeFilter.FILTER_REJECT;
          if (skipTranslated && translatedNodes.has(node)) return NodeFilter.FILTER_REJECT;
          const text = node.textContent.trim();
          if (!text || text.length < 2) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      if (!isVisible(node.parentElement)) continue;
      const text = node.textContent.trim();
      if (text.length < 2) continue;

      blocks.push({ id: blocks.length, text: text });
      blockElements.push(node);
    }

    return blocks;
  }

  function restoreOriginal() {
    if (!originalTexts.size) return;
    for (const [id, original] of originalTexts) {
      const el = allTranslatedNodes.get(id);
      if (el && document.contains(el)) {
        el.textContent = original;
      }
    }
    originalTexts.clear();
    allTranslatedNodes.clear();
    blockElements = [];
    translatedNodes = new WeakSet();
  }

  function applyTranslation(translations) {
    if (!translations) return;
    for (const t of translations) {
      const el = blockElements[t.id];
      if (!el) continue;
      if (!originalTexts.has(t.id)) {
        originalTexts.set(t.id, el.textContent);
        allTranslatedNodes.set(t.id, el);
      }
      el.textContent = t.text;
      translatedNodes.add(el);
    }
  }

  function sendToBackground(blocks, targetLang) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'translateBlocks', blocks, targetLang },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response?.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  function notifyProgress(status, progress) {
    chrome.runtime.sendMessage({ action: 'progress', status, progress }).catch(() => {});
  }

  function detectIsEnglish() {
    const lang = (document.documentElement.lang || '').toLowerCase();
    if (lang.startsWith('zh') || lang.startsWith('ja') || lang.startsWith('ko')) return false;
    if (lang.startsWith('en')) return true;

    // Sample visible text content without TreeWalker overhead
    const text = (document.body.innerText || '').slice(0, 2000);
    if (text.length < 30) return false;

    let ascii = 0, cjk = 0;
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code < 128) ascii++;
      else if ((code >= 0x4e00 && code <= 0x9fff) ||
               (code >= 0x3040 && code <= 0x30ff) ||
               (code >= 0xac00 && code <= 0xd7af)) cjk++;
    }
    if (cjk / text.length > 0.3) return false;
    return ascii / text.length > 0.55;
  }

  let autoIndicator = null;

  function showAutoIndicator(msg) {
    if (!autoIndicator) {
      autoIndicator = document.createElement('div');
      autoIndicator.style.cssText =
        'position:fixed;top:12px;right:12px;z-index:2147483647;' +
        'background:#1a1a2e;color:#fff;padding:6px 14px;border-radius:20px;' +
        'font-size:13px;font-family:sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.3);' +
        'pointer-events:none;transition:opacity .3s;';
      document.body.appendChild(autoIndicator);
    }
    autoIndicator.textContent = msg;
    autoIndicator.style.opacity = '1';
    // Mark current text node so indicator itself is never translated
    if (autoIndicator.firstChild) translatedNodes.add(autoIndicator.firstChild);
  }

  function hideAutoIndicator() {
    if (autoIndicator) {
      autoIndicator.style.opacity = '0';
      // Never remove — removal triggers MutationObserver causing infinite loop
    }
  }

  function doTranslate(targetLang, showProgress, incremental, silent) {
    if (isTranslating) return;
    isTranslating = true;

    (async () => {
      try {
        const allBlocks = extractTextBlocks(!!incremental);
        if (allBlocks.length === 0) {
          isTranslating = false;
          return;
        }

        if (showProgress) {
          notifyProgress(`找到 ${allBlocks.length} 个文本段，翻译中...`, 10);
        } else if (!silent) {
          showAutoIndicator(`翻译中 (${allBlocks.length} 段)...`);
        }

        const TRANSLATE_TIMEOUT = 60000;
        const result = await Promise.race([
          sendToBackground(allBlocks, targetLang),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('翻译超时，请刷新页面重试')), TRANSLATE_TIMEOUT)
          )
        ]);

        applyTranslation(result.translations);
        pageTranslated = true;

        if (showProgress) {
          notifyProgress('翻译完成', 100);
          chrome.runtime.sendMessage({ action: 'done' }).catch(() => {});
        } else if (!silent) {
          showAutoIndicator('翻译完成');
          setTimeout(hideAutoIndicator, 1500);
        }
      } catch (err) {
        if (!silent) {
          showAutoIndicator('错误: ' + err.message);
          setTimeout(hideAutoIndicator, 4000);
        }
        if (showProgress) {
          chrome.runtime.sendMessage({ action: 'error', error: err.message }).catch(() => {});
        }
      } finally {
        isTranslating = false;
      }
    })();
  }

  function autoTranslate(incremental, silent) {
    if (isTranslating) return;
    if (!incremental && !detectIsEnglish()) return;
    doTranslate('Chinese', false, incremental, silent);
  }

  let lastUrl = location.href;
  let pageTranslated = false;
  let confirmDialog = null;

  function getSiteDomain() {
    const parts = location.hostname.split('.');
    if (parts.length <= 2) return location.hostname;
    return parts.slice(-2).join('.');
  }

  function resetForNewPage() {
    originalTexts.clear();
    allTranslatedNodes.clear();
    blockElements = [];
    translatedNodes = new WeakSet();
    isTranslating = false;
    pageTranslated = false;
    removeConfirmDialog();
    hideAutoIndicator();
  }

  function removeConfirmDialog() {
    if (confirmDialog) { confirmDialog.remove(); confirmDialog = null; }
  }

  function showConfirmDialog() {
    if (confirmDialog) return;
    if (!detectIsEnglish()) return;

    confirmDialog = document.createElement('div');
    confirmDialog.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
      'background:#1a1a2e;color:#e0e0e0;padding:16px 20px;border-radius:12px;' +
      'font-size:14px;font-family:sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.5);' +
      'display:flex;flex-direction:column;gap:12px;min-width:320px;';

    confirmDialog.innerHTML =
      '<div style="font-size:14px;color:#fff;">检测到英文页面，是否翻译为中文？</div>' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#999;cursor:pointer;">' +
      '<input type="checkbox" id="imm-checkbox" style="accent-color:#4caf50;">' +
      '该网站一律翻译</label>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button id="imm-close" style="padding:6px 16px;border:1px solid #555;border-radius:6px;' +
      'background:transparent;color:#aaa;cursor:pointer;font-size:13px;">关闭</button>' +
      '<button id="imm-translate" style="padding:6px 16px;border:none;border-radius:6px;' +
      'background:#4caf50;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">翻译</button>' +
      '</div>';

    document.body.appendChild(confirmDialog);

    confirmDialog.querySelector('#imm-translate').onclick = () => {
      const always = confirmDialog.querySelector('#imm-checkbox').checked;
      removeConfirmDialog();
      if (always) {
        chrome.storage.local.get('autoDomains', ({ autoDomains }) => {
          const domains = autoDomains || [];
          const site = getSiteDomain();
          if (!domains.includes(site)) {
            domains.push(site);
            chrome.storage.local.set({ autoDomains: domains });
          }
        });
      }
      doTranslate('Chinese', false, false, true);
    };

    confirmDialog.querySelector('#imm-close').onclick = () => {
      removeConfirmDialog();
    };
  }

  async function checkAndTranslate() {
    if (pageTranslated || isTranslating) return;

    // Check if this site is in always-translate list
    const { autoDomains } = await chrome.storage.local.get('autoDomains');
    const site = getSiteDomain();
    if (autoDomains && autoDomains.includes(site)) {
      if (detectIsEnglish()) {
        doTranslate('Chinese', false, false, true);
      }
      return;
    }

    // Show confirmation dialog
    showConfirmDialog();
  }

  // Initial check when page has content
  let initTimer = null;
  function scheduleInitCheck() {
    clearTimeout(initTimer);
    initTimer = setTimeout(() => {
      if ((document.body.innerText || '').length > 200) {
        checkAndTranslate();
      } else {
        scheduleInitCheck();
      }
    }, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInitCheck);
  } else {
    scheduleInitCheck();
  }

  // Incremental DOM changes: only translate new nodes on already-translated pages
  let autoRetryTimer = null;
  new MutationObserver(() => {
    if (isTranslating) return;
    if (location.href !== lastUrl) {
      onUrlChange();
      return;
    }
    if (!pageTranslated) return;
    clearTimeout(autoRetryTimer);
    autoRetryTimer = setTimeout(() => doTranslate('Chinese', false, true), 300);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // SPA navigation
  function onUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    resetForNewPage();
    setTimeout(checkAndTranslate, 800);
  }

  const origPushState = history.pushState;
  history.pushState = function () {
    origPushState.apply(this, arguments);
    setTimeout(onUrlChange, 300);
  };
  const origReplaceState = history.replaceState;
  history.replaceState = function () {
    origReplaceState.apply(this, arguments);
    setTimeout(onUrlChange, 300);
  };
  window.addEventListener('popstate', () => setTimeout(onUrlChange, 300));

  // Popup message handler
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'translate') {
      doTranslate(msg.targetLang, true);
    } else if (msg.action === 'restore') {
      restoreOriginal();
      pageTranslated = false;
    }
  });
})();
