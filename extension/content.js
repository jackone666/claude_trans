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

  function resetForNewPage() {
    originalTexts.clear();
    allTranslatedNodes.clear();
    blockElements = [];
    translatedNodes = new WeakSet();
    isTranslating = false;
    hideAutoIndicator();
  }

  function onUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    resetForNewPage();
    setTimeout(() => autoTranslate(false, true), 800);
  }

  // Start translation when DOM has meaningful content
  let initTimer = null;
  function scheduleInitCheck() {
    clearTimeout(initTimer);
    initTimer = setTimeout(() => {
      if (isTranslating || originalTexts.size > 0) return;
      // Only auto-translate if page has enough content to be worth it
      const sample = (document.body.innerText || '').length;
      if (sample > 200) {
        autoTranslate();
      } else {
        // Not enough content yet, check again later
        scheduleInitCheck();
      }
    }, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInitCheck);
  } else {
    scheduleInitCheck();
  }

  // Detect incremental DOM changes and translate new text nodes
  let autoRetryTimer = null;
  new MutationObserver(() => {
    if (isTranslating) return;
    if (location.href !== lastUrl) {
      onUrlChange();
      return;
    }
    clearTimeout(autoRetryTimer);
    autoRetryTimer = setTimeout(() => autoTranslate(true), 300);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Detect SPA navigation: history API
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

  // Message handler for popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'translate') {
      doTranslate(msg.targetLang, true);
    } else if (msg.action === 'restore') {
      restoreOriginal();
    }
  });
})();
