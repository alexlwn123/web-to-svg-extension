const STORAGE_KEY = 'lastResult';

async function storeResult(result) {
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: result });
  } catch (error) {
    console.warn('Failed to persist result', error);
  }
}

async function notifyPopup(result) {
  try {
    await chrome.runtime.sendMessage(result);
  } catch (error) {
    // Popup might be closed; ignore
  }
}

async function reopenPopup() {
  try {
    await chrome.action.openPopup();
  } catch (error) {
    // Popup might already be open or can't be opened
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  // Handle download requests from popup
  if (message.type === 'download') {
    const sanitizedFilename = message.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    chrome.downloads.download({
      url: message.dataUrl,
      filename: sanitizedFilename,
      saveAs: true
    });
    sendResponse({ ok: true });
    return true;
  }

  // Forward capture results from content script to popup
  if (message.type === 'capture-complete' || message.type === 'capture-error') {
    storeResult(message);
    notifyPopup(message);
    reopenPopup();
    sendResponse({ ok: true });
    return true;
  }

  // Forward cancellation from content script to popup
  if (message.type === 'selection-cancelled') {
    storeResult(message);
    notifyPopup(message);
    reopenPopup();
    sendResponse({ ok: true });
    return true;
  }
});
