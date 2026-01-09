import { captureElement, getFileExtension } from './capture.js';

const OVERLAY_ID = '__web_to_image_overlay__';

let selectionActive = false;
let currentElement = null;
let requestId = null;
let captureFormat = 'png';
let captureQuality = 0.92;

let overlay = null;
let highlight = null;
let label = null;

function ensureOverlay() {
  if (overlay) {
    return overlay;
  }

  overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483646;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  `;

  highlight = document.createElement('div');
  highlight.style.cssText = `
    position: absolute;
    border: 2px solid #2563eb;
    background: rgba(37, 99, 235, 0.15);
    pointer-events: none;
    border-radius: 4px;
  `;
  overlay.appendChild(highlight);

  label = document.createElement('div');
  label.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    padding: 2px 6px;
    font-size: 12px;
    font-family: monospace;
    background: #2563eb;
    color: #fff;
    border-radius: 4px;
    transform: translateY(-100%);
    white-space: nowrap;
  `;
  overlay.appendChild(label);

  document.documentElement.appendChild(overlay);
  return overlay;
}

function removeOverlay() {
  if (overlay?.parentNode) {
    overlay.parentNode.removeChild(overlay);
  }
  overlay = null;
  highlight = null;
  label = null;
}

function highlightElement(element) {
  if (!element || !highlight || !label) {
    return;
  }

  const rect = element.getBoundingClientRect();

  highlight.style.width = `${Math.max(rect.width, 1)}px`;
  highlight.style.height = `${Math.max(rect.height, 1)}px`;
  highlight.style.transform = `translate(${rect.left}px, ${rect.top}px)`;

  const id = element.id ? `#${element.id}` : '';
  label.textContent = `${element.tagName.toLowerCase()}${id}`;
  label.style.left = `${rect.left}px`;
  label.style.top = `${Math.max(rect.top - 4, 0)}px`;
}

function sendCancel() {
  if (!requestId) {
    return;
  }
  chrome.runtime.sendMessage({
    type: 'selection-cancelled',
    requestId
  });
}

async function completeSelection() {
  if (!currentElement || !requestId) {
    return;
  }

  const targetElement = currentElement;

  try {
    const dataUrl = await captureElement(targetElement, {
      format: captureFormat,
      quality: captureQuality,
      pixelRatio: window.devicePixelRatio
    });

    chrome.runtime.sendMessage({
      type: 'capture-complete',
      requestId,
      dataUrl,
      format: captureFormat,
      width: targetElement.offsetWidth,
      height: targetElement.offsetHeight
    });
  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'capture-error',
      requestId,
      error: error.message
    });
  }
}

function stopSelection({ cancelled } = { cancelled: false }) {
  selectionActive = false;
  currentElement = null;

  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('mousedown', onPrevent, true);
  document.removeEventListener('mouseup', onPrevent, true);
  document.removeEventListener('keydown', onKeydown, true);

  if (cancelled) {
    sendCancel();
  }

  removeOverlay();
  requestId = null;
}

function onMouseMove(event) {
  if (!selectionActive) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  currentElement = target;
  ensureOverlay();
  highlightElement(target);
}

function onClick(event) {
  if (!selectionActive) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  Promise.resolve(completeSelection()).catch((error) => {
    console.error('Failed to complete selection', error);
  });

  stopSelection({ cancelled: false });
}

function onPrevent(event) {
  if (!selectionActive) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

function onKeydown(event) {
  if (!selectionActive) {
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    stopSelection({ cancelled: true });
  }
}

function startSelection(message) {
  if (selectionActive) {
    stopSelection({ cancelled: true });
  }

  selectionActive = true;
  requestId = message.requestId;
  captureFormat = message.format || 'png';
  captureQuality = message.quality || 0.92;

  ensureOverlay();
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('mousedown', onPrevent, true);
  document.addEventListener('mouseup', onPrevent, true);
  document.addEventListener('keydown', onKeydown, true);
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'start-selection') {
    startSelection(message);
  }

  if (message.type === 'cancel-selection' && selectionActive && message.requestId === requestId) {
    stopSelection({ cancelled: true });
  }
});
