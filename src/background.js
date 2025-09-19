import satori, { init as initSatori } from 'satori';
import { html as parseHtml } from 'satori-html';
import initYoga from 'yoga-wasm-web';
import wasm from '../assets/yoga.wasm';
import font from '../assets/fonts/Inter-Regular.ttf';

const STORAGE_KEY = 'lastResult';

let yogaReadyPromise = null;
let fontDataPromise = null;
const remoteFontCache = new Map();
const MAX_STYLE_ENTRIES = 200;
const MAX_SELECTOR_LENGTH = 300;
const MAX_CSS_TEXT_LENGTH = 4000;
const MAX_FONT_ENTRIES = 30;
const MAX_FONT_NAME_LENGTH = 120;
const FONT_SIGNATURE_WOFF = 'wOFF';
const FONT_SIGNATURE_WOFF2 = 'wOF2';

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

function sanitizeStyles(styles) {
  if (!Array.isArray(styles) || !styles.length) {
    return [];
  }

  return styles.slice(0, MAX_STYLE_ENTRIES).map((entry) => {
    const selector = typeof entry.selector === 'string' ? entry.selector.slice(0, MAX_SELECTOR_LENGTH) : 'unknown';
    const cssText = typeof entry.cssText === 'string' ? entry.cssText.slice(0, MAX_CSS_TEXT_LENGTH) : '';
    return { selector, cssText };
  });
}

function sanitizeFonts(fonts) {
  if (!Array.isArray(fonts) || !fonts.length) {
    return [];
  }

  return fonts.slice(0, MAX_FONT_ENTRIES).map((fontEntry) => {
    const name = typeof fontEntry.name === 'string' ? fontEntry.name.slice(0, MAX_FONT_NAME_LENGTH) : 'unknown';
    const weight = typeof fontEntry.weight === 'number' && Number.isFinite(fontEntry.weight) ? fontEntry.weight : normalizeFontWeight(fontEntry.weight);
    const style = typeof fontEntry.style === 'string' ? fontEntry.style.slice(0, 40) : 'normal';
    return {
      name,
      weight,
      style
    };
  });
}

function sanitizeSystemFonts(systemFonts) {
  if (!Array.isArray(systemFonts) || !systemFonts.length) {
    return [];
  }

  return systemFonts.slice(0, MAX_FONT_ENTRIES).map((fontEntry) => {
    const name = typeof fontEntry.family === 'string' ? fontEntry.family.slice(0, MAX_FONT_NAME_LENGTH) : 'unknown';
    const weight = typeof fontEntry.weight === 'number' && Number.isFinite(fontEntry.weight)
      ? fontEntry.weight
      : normalizeFontWeight(fontEntry.weight);
    const style = typeof fontEntry.style === 'string' ? fontEntry.style.slice(0, 40) : 'normal';
    return {
      name,
      weight,
      style
    };
  });
}

function normalizeFontWeight(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(900, Math.max(100, Math.round(value)));
  }

  const stringValue = (value || '').toString().trim().toLowerCase();
  if (!stringValue) {
    return 400;
  }
  if (stringValue === 'normal') {
    return 400;
  }
  if (stringValue === 'bold') {
    return 700;
  }

  const numeric = parseInt(stringValue, 10);
  if (Number.isFinite(numeric)) {
    return Math.min(900, Math.max(100, numeric));
  }

  return 400;
}

function getFontUrlScore(url) {
  if (!url || typeof url !== 'string') {
    return 0;
  }
  const lower = url.toLowerCase();
  if (lower.endsWith('.ttf') || lower.endsWith('.otf')) {
    return 4;
  }
  if (lower.includes('format=truetype') || lower.includes('format=opentype')) {
    return 3;
  }
  if (lower.endsWith('.woff')) {
    return 2;
  }
  if (lower.endsWith('.woff2')) {
    return 1;
  }
  return 0;
}

function sortFontUrls(urls = []) {
  return Array.from(new Set(urls)).sort((a, b) => getFontUrlScore(b) - getFontUrlScore(a));
}

function isUnsupportedFontData(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4) {
    return false;
  }
  const view = new Uint8Array(buffer, 0, 4);
  const signature = String.fromCharCode(view[0], view[1], view[2], view[3]);
  return signature === FONT_SIGNATURE_WOFF || signature === FONT_SIGNATURE_WOFF2;
}

async function fetchFontFromUrl(url) {
  if (!url) {
    return null;
  }

  if (!remoteFontCache.has(url)) {
    remoteFontCache.set(
      url,
      (async () => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch font from ${url}`);
        }
        return response.arrayBuffer();
      })()
    );
  }

  try {
    return await remoteFontCache.get(url);
  } catch (error) {
    remoteFontCache.delete(url);
    throw error;
  }
}

async function resolveFontPayload(fontPayload) {
  if (!fontPayload || typeof fontPayload !== 'object') {
    return null;
  }

  const name = typeof fontPayload.name === 'string' && fontPayload.name.trim() ? fontPayload.name.trim() : null;
  if (!name) {
    return null;
  }

  const style = typeof fontPayload.style === 'string' && fontPayload.style.trim() ? fontPayload.style.trim().toLowerCase() : 'normal';
  const weight = normalizeFontWeight(fontPayload.weight);

  let data = null;

  if (fontPayload.data instanceof ArrayBuffer) {
    data = fontPayload.data;
  } else if (fontPayload.data && ArrayBuffer.isView(fontPayload.data)) {
    data = fontPayload.data.buffer.slice(0);
  }

  if (data && isUnsupportedFontData(data)) {
    data = null;
  }

  const urlCandidatesRaw = Array.isArray(fontPayload.urls)
    ? fontPayload.urls
    : Array.isArray(fontPayload.sources)
      ? fontPayload.sources
      : [];
  const urlCandidates = sortFontUrls(urlCandidatesRaw);

  if (!data) {
    for (const candidate of urlCandidates) {
      try {
        const fetched = await fetchFontFromUrl(candidate);
        if (fetched && !isUnsupportedFontData(fetched)) {
          data = fetched;
          break;
        }
        if (fetched && isUnsupportedFontData(fetched)) {
          console.warn('Skipping unsupported font format', { candidate });
        }
      } catch (error) {
        console.warn('Failed to fetch remote font', { candidate, error });
      }
    }
  }

  if (!data) {
    return null;
  }

  if (!data) {
    return null;
  }

  return {
    name,
    data,
    weight,
    style
  };
}

async function resolveFonts(fontsPayload = []) {
  const resolved = [];
  const seen = new Set();

  if (Array.isArray(fontsPayload)) {
    for (const fontPayload of fontsPayload) {
      try {
        const fontResult = await resolveFontPayload(fontPayload);
        if (!fontResult) {
          continue;
        }
        const key = `${fontResult.name.toLowerCase()}__${fontResult.style}__${fontResult.weight}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        resolved.push(fontResult);
      } catch (error) {
        console.warn('Failed to resolve font payload', { fontPayload, error });
      }
    }
  }

  if (!resolved.length) {
    const fallbackData = await ensureFont();
    resolved.push({
      name: 'Inter',
      data: fallbackData,
      weight: 400,
      style: 'normal'
    });
  }

  return resolved;
}

async function renderSvg(payload) {
  if (!payload || !payload.html) {
    throw new Error('No HTML payload received.');
  }

  await ensureYoga();
  const fonts = await resolveFonts(payload.fonts);
  const systemFonts = await resolveFonts(payload.systemFonts);
  const fontSummary = [...systemFonts, ...fonts].map((fontEntry) => ({
    name: fontEntry.name,
    weight: fontEntry.weight,
    style: fontEntry.style
  }));

  const width = Math.max(1, Math.round(payload.width || 600));
  const height = Math.max(1, Math.round(payload.height || 400));
  const backgroundColor = payload.backgroundColor || '#ffffff';
  const markup = typeof payload.html === 'string' ? payload.html : String(payload.html);
  const limitedMarkup = markup.length > 200_000 ? markup.slice(0, 200_000) : markup;

  const tree = parseHtml(limitedMarkup);
  const svg = await satori(tree, {
    width,
    height,
    backgroundColor,
    fonts
  });

  return { svg, fontSummary };
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
    const { svg, fontSummary } = await renderSvg(message.payload);
    const styles = sanitizeStyles(message.payload?.styles);
    const fonts = sanitizeFonts(fontSummary);
    const systemFonts = sanitizeSystemFonts(message.payload?.systemFonts);
    const result = await buildResult(
      { type: 'render-complete', requestId: message.requestId },
      {
        svg,
        styles,
        fonts,
        systemFonts
      }
    );
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
