const startButton = document.getElementById('start-selection');
const cancelButton = document.getElementById('cancel-selection');
const statusEl = document.getElementById('status');
const resultSection = document.querySelector('.result');
const svgOutput = document.getElementById('svg-output');
const preview = document.getElementById('svg-preview');
const downloadButton = document.getElementById('download-svg');

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
    return;
  }

  if (!message.svg) {
    setStatus('No SVG content was returned.');
    resultSection.hidden = true;
    return;
  }

  setStatus('SVG generated successfully.');
  svgOutput.value = message.svg;
  resultSection.hidden = false;
  preview.innerHTML = message.svg;
}

function handleSelectionCancelled(message) {
  if (!shouldHandleMessage(message)) {
    return;
  }
  setLoading(false);
  currentRequestId = null;
  setStatus('Selection cancelled.');
  resultSection.hidden = true;
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
restoreLastResult().then((restored) => {
  if (!restored) {
    setStatus('Ready to capture an element.');
  }
});
