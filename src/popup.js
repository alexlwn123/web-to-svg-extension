const startButton = document.getElementById('start-selection');
const cancelButton = document.getElementById('cancel-selection');
const statusEl = document.getElementById('status');
const resultSection = document.querySelector('.result');
const svgOutput = document.getElementById('svg-output');
const preview = document.getElementById('svg-preview');
const downloadButton = document.getElementById('download-svg');

let currentRequestId = null;
let activeTabId = null;

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
  currentRequestId = crypto.randomUUID();
  setLoading(true);
  setStatus('Hover and click the element to capture. Press Esc to cancel.');
  resultSection.hidden = true;

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
  if (message.requestId !== currentRequestId) {
    return;
  }
  setLoading(false);
  currentRequestId = null;

  if (message.error) {
    setStatus(`Rendering failed: ${message.error}`);
    resultSection.hidden = true;
    return;
  }

  setStatus('SVG generated successfully.');
  svgOutput.value = message.svg;
  resultSection.hidden = false;
  preview.innerHTML = message.svg;
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

  if (message.type === 'selection-cancelled' && message.requestId === currentRequestId) {
    setLoading(false);
    setStatus('Selection cancelled.');
    currentRequestId = null;
    resultSection.hidden = true;
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
setStatus('Ready to capture an element.');
