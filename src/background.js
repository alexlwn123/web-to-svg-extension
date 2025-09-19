import satori, { init as initSatori } from 'satori';
import { html as parseHtml } from 'satori-html';
import initYoga from 'yoga-wasm-web';
import wasm from '../assets/yoga.wasm';
import font from '../assets/fonts/Inter-Regular.ttf';

const STORAGE_KEY = 'lastResult';

let yogaReadyPromise = null;
let fontDataPromise = null;

async function storeResult(result) {
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: result });
  } catch (error) {
    console.warn('Failed to persist render result', error);
  }
}

async function notifyContexts(result, sender) {
  try {
    await chrome.runtime.sendMessage(result);
  } catch (error) {
    if (chrome.runtime.lastError) {
      // Popup might be closed; ignore.
      console.warn('Popup might be closed; error', error);
    } else {
      console.warn('Failed to post result to runtime', error);
    }
  }

  if (sender?.tab?.id) {
    try {
      await chrome.tabs.sendMessage(sender.tab.id, result);
    } catch (error) {
      if (!chrome.runtime.lastError) {
        console.warn('Failed to post result to tab', error);
      }
    }
  }
}

async function reopenPopup() {
  try {
    await chrome.action.openPopup();
  } catch (error) {
    if (!chrome.runtime.lastError) {
      console.warn('Failed to reopen popup', error);
    }
  }
}

async function ensureYoga() {
  if (!yogaReadyPromise) {
    yogaReadyPromise = (async () => {
      const response = await fetch(wasm);
      if (!response.ok) {
        throw new Error('Failed to load Yoga WASM from assets/yoga.wasm');
      }
      const buffer = await response.arrayBuffer();
      const yoga = await initYoga(buffer);
      await initSatori(yoga);
      return yoga;
    })();
  }
  return yogaReadyPromise;
}

async function ensureFont() {
  if (!fontDataPromise) {
    const response = await fetch(font);
    if (!response.ok) {
      throw new Error('Font file assets/fonts/Inter-Regular.ttf is missing.');
    }
    fontDataPromise = response.arrayBuffer();
  }
  return fontDataPromise;
}

async function renderSvg(payload) {
  if (!payload || !payload.html) {
    throw new Error('No HTML payload received.');
  }

  await ensureYoga();
  const fontData = await ensureFont();

  const width = Math.max(1, Math.round(payload.width || 600));
  const height = Math.max(1, Math.round(payload.height || 400));
  const backgroundColor = payload.backgroundColor || '#ffffff';
  const markup = typeof payload.html === 'string' ? payload.html : String(payload.html);
  const limitedMarkup = markup.length > 200_000 ? markup.slice(0, 200_000) : markup;

  const tree = parseHtml(limitedMarkup);
  return satori(tree, {
    width,
    height,
    backgroundColor,
    fonts: [
      {
        name: 'Inter',
        data: fontData,
        weight: 400,
        style: 'normal'
      }
    ]
  });
}

async function buildResult(base, extra = {}) {
  const result = {
    ...base,
    ...extra
  };
  await storeResult(result);
  return result;
}

async function handleElementSelected(message, sender) {
  try {
    const svg = await renderSvg(message.payload);
    const result = await buildResult({ type: 'render-complete', requestId: message.requestId }, { svg });
    await notifyContexts(result, sender);
    await reopenPopup();
    return { ok: true };
  } catch (error) {
    const details = error && error.message ? error.message : String(error);
    const result = await buildResult({ type: 'render-complete', requestId: message.requestId }, { error: details });
    await notifyContexts(result, sender);
    await reopenPopup();
    return { ok: false, error: details };
  }
}

async function handleSelectionCancelled(message, sender) {
  const result = await buildResult({ type: 'selection-cancelled', requestId: message.requestId });
  await notifyContexts(result, sender);
  await reopenPopup();
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'element-selected') {
    handleElementSelected(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'selection-cancelled') {
    handleSelectionCancelled(message, sender)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
