import satori, { init as initSatori } from 'satori';
import { html as parseHtml } from 'satori-html';
import initYoga from 'yoga-wasm-web';

let yogaReadyPromise = null;
let fontDataPromise = null;

async function ensureYoga() {
  if (!yogaReadyPromise) {
    yogaReadyPromise = (async () => {
      const response = await fetch(chrome.runtime.getURL('assets/yoga.wasm'));
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
    const response = await fetch(chrome.runtime.getURL('assets/fonts/Inter-Regular.ttf'));
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

async function handleElementSelected(message) {
  try {
    const svg = await renderSvg(message.payload);
    await chrome.runtime.sendMessage({
      type: 'render-complete',
      requestId: message.requestId,
      svg
    });
    return { ok: true };
  } catch (error) {
    const details = error && error.message ? error.message : String(error);
    await chrome.runtime.sendMessage({
      type: 'render-complete',
      requestId: message.requestId,
      error: details
    });
    return { ok: false, error: details };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'element-selected') {
    handleElementSelected(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'selection-cancelled') {
    chrome.runtime.sendMessage(message);
    sendResponse({ ok: true });
  }
});
