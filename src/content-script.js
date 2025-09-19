const OVERLAY_ID = '__web_to_svg_overlay__';
const SUPPORTED_PROPERTIES = [
  'align-items',
  'align-content',
  'background',
  'background-color',
  'background-image',
  'background-position',
  'background-repeat',
  'background-size',
  'border',
  'border-color',
  'border-radius',
  'border-style',
  'border-width',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'box-shadow',
  'color',
  'column-gap',
  'display',
  'flex',
  'flex-basis',
  'flex-direction',
  'flex-grow',
  'flex-shrink',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'gap',
  'height',
  'justify-content',
  'letter-spacing',
  'line-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'opacity',
  'overflow',
  'overflow-x',
  'overflow-y',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'position',
  'row-gap',
  'text-align',
  'text-decoration',
  'text-transform',
  'top',
  'right',
  'bottom',
  'left',
  'transform',
  'white-space',
  'width'
];

let selectionActive = false;
let currentElement = null;
let requestId = null;

let overlay = null;
let highlight = null;
let label = null;

function ensureOverlay() {
  if (overlay) {
    return overlay;
  }
  overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.position = 'fixed';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '2147483646';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';

  highlight = document.createElement('div');
  highlight.style.position = 'absolute';
  highlight.style.border = '2px solid #2563eb';
  highlight.style.background = 'rgba(37, 99, 235, 0.15)';
  highlight.style.pointerEvents = 'none';
  highlight.style.borderRadius = '4px';
  overlay.appendChild(highlight);

  label = document.createElement('div');
  label.style.position = 'absolute';
  label.style.top = '0';
  label.style.left = '0';
  label.style.padding = '2px 6px';
  label.style.fontSize = '12px';
  label.style.fontFamily = 'monospace';
  label.style.background = '#2563eb';
  label.style.color = '#fff';
  label.style.borderRadius = '4px';
  label.style.transform = 'translateY(-100%)';
  label.style.whiteSpace = 'nowrap';
  overlay.appendChild(label);

  document.documentElement.appendChild(overlay);
  return overlay;
}

function removeOverlay() {
  if (overlay && overlay.parentNode) {
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

  label.textContent = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`;
  label.style.left = `${rect.left}px`;
  label.style.top = `${Math.max(rect.top - 4, 0)}px`;
}

function cloneWithInlineStyles(element) {
  const clone = element.cloneNode(true);
  const sourceElements = [element, ...element.querySelectorAll('*')];
  const cloneElements = [clone, ...clone.querySelectorAll('*')];

  sourceElements.forEach((source, index) => {
    const target = cloneElements[index];
    const style = window.getComputedStyle(source);
    const inline = SUPPORTED_PROPERTIES
      .map((property) => {
        const value = style.getPropertyValue(property);
        if (!value) {
          return '';
        }
        return `${property}:${value};`;
      })
      .filter(Boolean)
      .join('');

    if (inline) {
      target.setAttribute('style', inline);
    }
  });

  return clone;
}

function serializeElement(element) {
  const clone = cloneWithInlineStyles(element);
  const container = document.createElement('div');
  container.appendChild(clone);
  return container.innerHTML;
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

function completeSelection() {
  if (!currentElement || !requestId) {
    return;
  }

  const rect = currentElement.getBoundingClientRect();
  const serialized = serializeElement(currentElement);
  const backgroundColor = window.getComputedStyle(document.body).backgroundColor || '#ffffff';

  chrome.runtime.sendMessage({
    type: 'element-selected',
    requestId,
    payload: {
      html: serialized,
      width: Math.max(1, Math.round(rect.width)) || 1,
      height: Math.max(1, Math.round(rect.height)) || 1,
      backgroundColor
    }
  });
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
  completeSelection();
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
