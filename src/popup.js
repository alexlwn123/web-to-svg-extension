const startButton = document.getElementById('start-selection');
const cancelButton = document.getElementById('cancel-selection');
const statusEl = document.getElementById('status');
const resultSection = document.querySelector('.result');
const svgOutput = document.getElementById('svg-output');
const preview = document.getElementById('svg-preview');
const downloadButton = document.getElementById('download-svg');
const styleDebug = document.getElementById('style-debug');
const styleDebugSection = document.getElementById('style-debug-section');
const fontDebugSection = document.getElementById('font-debug-section');
const systemFontDebugSection = document.getElementById('system-font-debug-section');
const styleDebugList = document.getElementById('compiled-styles');
const fontDebugList = document.getElementById('compiled-fonts');
const systemFontDebugList = document.getElementById('compiled-system-fonts');

const STORAGE_KEY = 'lastResult';

let currentRequestId = null;
let activeTabId = null;

async function clearStoredResult() {
  try {
    await chrome.storage.session.remove(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear stored result', error);
  }
}

async function restoreLastResult() {
  try {
    const stored = await chrome.storage.session.get(STORAGE_KEY);
    const result = stored?.[STORAGE_KEY];
    if (!result) {
      return false;
    }
    if (result.type === 'render-complete') {
      handleRenderComplete(result);
      return true;
    }
    if (result.type === 'selection-cancelled') {
      handleSelectionCancelled(result);
      return true;
    }
  } catch (error) {
    console.warn('Failed to restore stored result', error);
  }
  return false;
}

function shouldHandleMessage(message) {
  if (!message) {
    return false;
  }
  if (message.requestId && currentRequestId && message.requestId !== currentRequestId) {
    return false;
  }
  return true;
}

function setStatus(message) {
  statusEl.textContent = message ?? '';
}

function setLoading(isLoading) {
  startButton.disabled = isLoading;
  cancelButton.disabled = !isLoading;
}

function renderDebugData({ styles = [], fonts = [], systemFonts = [] } = {}) {
  if (!styleDebug || !styleDebugList || !fontDebugList || !systemFontDebugList) {
    return;
  }

  styleDebugList.innerHTML = '';
  fontDebugList.innerHTML = '';
  systemFontDebugList.innerHTML = '';

  const styleEntries = Array.isArray(styles)
    ? styles.filter((entry) => entry && typeof entry === 'object' && (entry.selector || entry.cssText))
    : [];
  const fontEntries = Array.isArray(fonts)
    ? fonts.filter((font) => font && typeof font === 'object' && (font.name || font.style))
    : [];
  const systemFontEntries = Array.isArray(systemFonts)
    ? systemFonts.filter((font) => font && typeof font === 'object' && (font.name || font.style))
    : [];

  if (styleDebugSection) {
    styleDebugSection.hidden = styleEntries.length === 0;
  }
  if (fontDebugSection) {
    fontDebugSection.hidden = fontEntries.length === 0;
  }
  if (systemFontDebugSection) {
    systemFontDebugSection.hidden = systemFontEntries.length === 0;
  }

  styleEntries.forEach((entry) => {
    const container = document.createElement('div');
    container.className = 'debug-entry';

    const selector = document.createElement('div');
    selector.className = 'debug-selector';
    selector.textContent = entry.selector || 'unknown';
    container.appendChild(selector);

    const pre = document.createElement('pre');
    pre.className = 'debug-css';
    pre.textContent = entry.cssText || '/* No inline styles captured */';
    container.appendChild(pre);

    styleDebugList.appendChild(container);
  });

  fontEntries.forEach((font) => {
    const item = document.createElement('div');
    item.className = 'debug-font';
    const name = font.name || 'unknown';
    const style = font.style || 'normal';
    const weight = typeof font.weight === 'number' ? font.weight : String(font.weight || 'unknown');
    item.textContent = `${name} - ${style}, ${weight}`;
    fontDebugList.appendChild(item);
  });

  systemFontEntries.forEach((font) => {
    const item = document.createElement('div');
    item.className = 'debug-font';
    const name = font.name || 'unknown';
    const style = font.style || 'normal';
    const weight = typeof font.weight === 'number' ? font.weight : String(font.weight || 'unknown');
    item.textContent = `${name} - ${style}, ${weight}`;
    systemFontDebugList.appendChild(item);
  });

  styleDebug.hidden =
    styleEntries.length === 0 && fontEntries.length === 0 && systemFontEntries.length === 0;
}

async function withActiveTab(callback) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) {
    throw new Error('Unable to determine active tab');
  }
  activeTabId = tab.id;
  return callback(tab.id);
}

async function startSelection() {
  await clearStoredResult();
  currentRequestId = crypto.randomUUID();
  setLoading(true);
  setStatus('Hover and click the element to capture. Press Esc to cancel.');
  resultSection.hidden = true;
  svgOutput.value = '';
  preview.innerHTML = '';
  renderDebugData();

  try {
    await withActiveTab((tabId) =>
      chrome.tabs.sendMessage(tabId, {
        type: 'start-selection',
        requestId: currentRequestId
      })
    );
  } catch (error) {
    setLoading(false);
    setStatus(error.message ?? 'Unable to start selection. Ensure the page has loaded.');
    currentRequestId = null;
  }
}

async function cancelSelection() {
  if (!currentRequestId || activeTabId == null) {
    return;
  }
  chrome.tabs.sendMessage(activeTabId, {
    type: 'cancel-selection',
    requestId: currentRequestId
  });
  setLoading(false);
  setStatus('Selection cancelled.');
  currentRequestId = null;
  renderDebugData();
}

function handleRenderComplete(message) {
  if (!shouldHandleMessage(message)) {
    return;
  }
  setLoading(false);
  currentRequestId = null;

  if (message.error) {
    setStatus(`Rendering failed: ${message.error}`);
    resultSection.hidden = true;
    renderDebugData();
    return;
  }

  if (!message.svg) {
    setStatus('No SVG content was returned.');
    resultSection.hidden = true;
    renderDebugData();
    return;
  }

  setStatus('SVG generated successfully.');
  svgOutput.value = message.svg;
  resultSection.hidden = false;
  preview.innerHTML = message.svg;
  renderDebugData({ styles: message.styles, fonts: message.fonts, systemFonts: message.systemFonts });
}

function handleSelectionCancelled(message) {
  if (!shouldHandleMessage(message)) {
    return;
  }
  setLoading(false);
  currentRequestId = null;
  setStatus('Selection cancelled.');
  resultSection.hidden = true;
  renderDebugData();
}

function downloadSvg() {
  const svg = svgOutput.value;
  if (!svg) {
    return;
  }
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename: 'element.svg',
    saveAs: true
  });
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'selection-cancelled') {
    handleSelectionCancelled(message);
    return;
  }

  if (message.type === 'render-complete') {
    handleRenderComplete(message);
  }
});

startButton.addEventListener('click', startSelection);
cancelButton.addEventListener('click', cancelSelection);
downloadButton.addEventListener('click', downloadSvg);

setLoading(false);
resultSection.hidden = true;
renderDebugData();
restoreLastResult().then((restored) => {
  if (!restored) {
    setStatus('Ready to capture an element.');
  }
});
