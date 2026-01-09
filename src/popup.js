const startButton = document.getElementById('start-selection');
const cancelButton = document.getElementById('cancel-selection');
const statusEl = document.getElementById('status');
const resultSection = document.querySelector('.result');
const preview = document.getElementById('preview');
const downloadButton = document.getElementById('download');
const formatSelect = document.getElementById('format');
const qualityControl = document.getElementById('quality-control');
const qualitySlider = document.getElementById('quality');
const qualityValue = document.getElementById('quality-value');

const STORAGE_KEY = 'lastResult';

let currentRequestId = null;
let activeTabId = null;
let lastCaptureData = null;

function getSelectedFormat() {
  return formatSelect.value || 'png';
}

function getSelectedQuality() {
  return parseInt(qualitySlider.value, 10) / 100;
}

function getFileExtension(format) {
  switch (format) {
    case 'jpeg':
      return 'jpg';
    case 'svg':
      return 'svg';
    case 'png':
    default:
      return 'png';
  }
}

async function clearStoredResult() {
  try {
    await chrome.storage.session.remove(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear stored result', error);
  }
}

async function storeResult(result) {
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: result });
  } catch (error) {
    console.warn('Failed to store result', error);
  }
}

async function restoreLastResult() {
  try {
    const stored = await chrome.storage.session.get(STORAGE_KEY);
    const result = stored?.[STORAGE_KEY];
    if (!result) {
      return false;
    }
    if (result.type === 'capture-complete') {
      handleCaptureComplete(result);
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
  formatSelect.disabled = isLoading;
  qualitySlider.disabled = isLoading;
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
  lastCaptureData = null;

  setLoading(true);
  setStatus('Hover and click the element to capture. Press Esc to cancel.');
  resultSection.hidden = true;
  preview.innerHTML = '';

  const format = getSelectedFormat();
  const quality = getSelectedQuality();

  try {
    await withActiveTab((tabId) =>
      chrome.tabs.sendMessage(tabId, {
        type: 'start-selection',
        requestId: currentRequestId,
        format,
        quality
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

function handleCaptureComplete(message) {
  if (!shouldHandleMessage(message)) {
    return;
  }
  setLoading(false);
  currentRequestId = null;

  if (!message.dataUrl) {
    setStatus('No image data was returned.');
    resultSection.hidden = true;
    return;
  }

  lastCaptureData = {
    dataUrl: message.dataUrl,
    format: message.format || 'png'
  };

  storeResult(message);

  setStatus('Image captured successfully.');
  resultSection.hidden = false;

  preview.innerHTML = '';

  if (message.format === 'svg') {
    // For SVG, we can embed it directly or show as image
    const img = document.createElement('img');
    img.src = message.dataUrl;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '300px';
    preview.appendChild(img);
  } else {
    // For PNG/JPEG, show as image
    const img = document.createElement('img');
    img.src = message.dataUrl;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '300px';
    preview.appendChild(img);
  }
}

function handleCaptureError(message) {
  if (!shouldHandleMessage(message)) {
    return;
  }
  setLoading(false);
  currentRequestId = null;
  setStatus(`Capture failed: ${message.error || 'Unknown error'}`);
  resultSection.hidden = true;
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

function downloadImage() {
  if (!lastCaptureData?.dataUrl) {
    return;
  }

  const ext = getFileExtension(lastCaptureData.format);
  const filename = `element-${Date.now()}.${ext}`;

  chrome.runtime.sendMessage({
    type: 'download',
    dataUrl: lastCaptureData.dataUrl,
    filename
  });
}

function updateQualityVisibility() {
  const format = getSelectedFormat();
  qualityControl.hidden = format !== 'jpeg';
}

function updateQualityDisplay() {
  qualityValue.textContent = `${qualitySlider.value}%`;
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  switch (message.type) {
    case 'capture-complete':
      handleCaptureComplete(message);
      break;
    case 'capture-error':
      handleCaptureError(message);
      break;
    case 'selection-cancelled':
      handleSelectionCancelled(message);
      break;
  }
});

startButton.addEventListener('click', startSelection);
cancelButton.addEventListener('click', cancelSelection);
downloadButton.addEventListener('click', downloadImage);
formatSelect.addEventListener('change', updateQualityVisibility);
qualitySlider.addEventListener('input', updateQualityDisplay);

// Initialize
setLoading(false);
resultSection.hidden = true;
updateQualityVisibility();
updateQualityDisplay();

restoreLastResult().then((restored) => {
  if (!restored) {
    setStatus('Ready to capture an element.');
  }
});
