let nativePort = null;
let isReady = false;
let pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }

const REQUEST_TIMEOUT = 60000;

function connectNative() {
  return new Promise((resolve, reject) => {
    if (nativePort && isReady) {
      resolve(nativePort);
      return;
    }

    const connectTimeout = setTimeout(() => {
      reject(new Error('无法连接 native host，请确认已安装'));
    }, 5000);

    nativePort = chrome.runtime.connectNative('com.immersive.translate');

    nativePort.onMessage.addListener((msg) => {
      // Handle ready signal
      if (msg.status === 'ready') {
        isReady = true;
        clearTimeout(connectTimeout);
        resolve(nativePort);
        return;
      }

      // Handle translation response
      const reqId = msg.requestId;
      if (reqId && pendingRequests.has(reqId)) {
        const { resolve: res, reject: rej, timeout } = pendingRequests.get(reqId);
        clearTimeout(timeout);
        pendingRequests.delete(reqId);

        if (msg.error) {
          rej(new Error(msg.error));
        } else if (msg.translations) {
          res(msg);
        } else {
          rej(new Error('翻译返回格式异常'));
        }
      }
    });

    nativePort.onDisconnect.addListener(() => {
      isReady = false;
      nativePort = null;
      // Reject all pending requests
      for (const [id, { reject: rej, timeout }] of pendingRequests) {
        clearTimeout(timeout);
        rej(new Error('Native host 连接断开，请确认已运行 install.sh 安装'));
      }
      pendingRequests.clear();
    });
  });
}

// Initialize connection when service worker starts
connectNative().catch(() => {});

// Handle translation requests from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'translateBlocks') {
    handleTranslate(msg.blocks, msg.targetLang)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

async function handleTranslate(blocks, targetLang) {
  const port = await connectNative();

  return new Promise((resolve, reject) => {
    const reqId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const timeout = setTimeout(() => {
      pendingRequests.delete(reqId);
      reject(new Error('翻译超时'));
    }, REQUEST_TIMEOUT);

    pendingRequests.set(reqId, { resolve, reject, timeout });

    port.postMessage({
      requestId: reqId,
      action: 'translate',
      blocks: blocks,
      targetLang: targetLang
    });
  });
}
