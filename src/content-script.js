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
const DOCUMENT_BASE_URL = document.baseURI;

const JUSTIFY_CONTENT_ALLOWED = new Set([
  'center',
  'flex-start',
  'flex-end',
  'space-between',
  'space-around'
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parsePercentOrNumber(raw, scale = 1) {
  if (!raw) {
    return NaN;
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.endsWith('%')) {
    const numeric = parseFloat(trimmed.slice(0, -1));
    return Number.isNaN(numeric) ? NaN : (numeric / 100) * scale;
  }
  const numeric = parseFloat(trimmed);
  return Number.isNaN(numeric) ? NaN : numeric;
}

function hueToDegrees(raw) {
  if (!raw) {
    return NaN;
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.endsWith('deg')) {
    return parseFloat(trimmed.slice(0, -3));
  }
  if (trimmed.endsWith('rad')) {
    const radians = parseFloat(trimmed.slice(0, -3));
    return Number.isNaN(radians) ? NaN : (radians * 180) / Math.PI;
  }
  if (trimmed.endsWith('turn')) {
    const turns = parseFloat(trimmed.slice(0, -4));
    return Number.isNaN(turns) ? NaN : turns * 360;
  }
  const numeric = parseFloat(trimmed);
  return Number.isNaN(numeric) ? NaN : numeric;
}

function linearToSrgb(value) {
  if (value <= 0.0031308) {
    return 12.92 * value;
  }
  return 1.055 * value ** (1 / 2.4) - 0.055;
}

function oklabToLinearSrgb(l, a, b) {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;

  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
  };
}

function toRgbString({ r, g, b }, alpha = 1) {
  const sr = clamp(Math.round(linearToSrgb(clamp(r, 0, 1)) * 255), 0, 255);
  const sg = clamp(Math.round(linearToSrgb(clamp(g, 0, 1)) * 255), 0, 255);
  const sb = clamp(Math.round(linearToSrgb(clamp(b, 0, 1)) * 255), 0, 255);

  if (alpha >= 0.999) {
    return `rgb(${sr}, ${sg}, ${sb})`;
  }
  const formattedAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${sr}, ${sg}, ${sb}, ${Number(formattedAlpha.toFixed(3))})`;
}

function oklchToRgb(l, c, h, alpha = 1) {
  if (!Number.isFinite(l) || !Number.isFinite(c)) {
    return null;
  }

  const lightness = clamp(l, 0, 1);
  const chroma = Math.max(0, c);
  let hue = Number.isFinite(h) ? h : 0;
  if (!Number.isFinite(hue)) {
    hue = 0;
  }
  const hueRadians = ((hue % 360) * Math.PI) / 180;

  const a = chroma === 0 ? 0 : chroma * Math.cos(hueRadians);
  const b = chroma === 0 ? 0 : chroma * Math.sin(hueRadians);

  const { r, g, b: blue } = oklabToLinearSrgb(lightness, a, b);
  return toRgbString({ r, g, b: blue }, alpha);
}

function resolveAbsoluteUrl(rawUrl, baseUrl = DOCUMENT_BASE_URL) {
  if (!rawUrl) {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
    return trimmed;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch (error) {
    console.warn('Failed to resolve URL', { rawUrl, baseUrl, error });
  }
  return null;
}

function normalizeKeywordProperty(property, value) {
  const trimmed = value.trim();
  const lowerProp = property.toLowerCase();
  const lowerValue = trimmed.toLowerCase();

  if (lowerProp === 'justify-content') {
    if (JUSTIFY_CONTENT_ALLOWED.has(lowerValue)) {
      return lowerValue;
    }
    if (lowerValue === 'normal' || lowerValue === 'start' || lowerValue === 'left') {
      return 'flex-start';
    }
    if (lowerValue === 'end' || lowerValue === 'right') {
      return 'flex-end';
    }
    if (lowerValue === 'space-evenly') {
      return 'space-around';
    }
    return 'flex-start';
  }

  return trimmed;
}

function normalizeTransformValue(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'none') {
    return '';
  }

  const unsupportedPatterns = ['%', 'calc(', 'var(', 'matrix', 'perspective', '3d'];
  if (unsupportedPatterns.some((pattern) => lower.includes(pattern))) {
    return '';
  }

  return trimmed;
}

function normalizeCssValue(property, value, element) {
  if (!value) {
    return value;
  }

  const keywordNormalized = normalizeKeywordProperty(property, value);
  if (keywordNormalized === '') {
    return '';
  }
  if (keywordNormalized !== value.trim()) {
    return keywordNormalized;
  }

  if (property === 'transform') {
    return normalizeTransformValue(value);
  }

  if (value.toLowerCase().includes('oklch(')) {
    const normalized = value.replace(/oklch\(\s*([^()]+?)\s*\)/gi, (match, inner) => {
      const [rawComponents, rawAlpha] = inner.split('/');
      const [lRaw, cRaw, hRaw] = (rawComponents || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (!lRaw || !cRaw || !hRaw) {
        return '#000000';
      }

      const l = parsePercentOrNumber(lRaw, 1);
      const c = parsePercentOrNumber(cRaw, 1);
      const h = hueToDegrees(hRaw);
      const alpha = rawAlpha ? parsePercentOrNumber(rawAlpha, 1) : 1;

      const converted = oklchToRgb(l, c, h, Number.isFinite(alpha) ? alpha : 1);
      return converted || '#000000';
    });
    return normalized;
  }

  if (value.includes('url(')) {
    const normalized = value.replace(/url\(([^)]+)\)/gi, (match, inner) => {
      const raw = inner.trim().replace(/^['"]|['"]$/g, '');
      const absolute = resolveAbsoluteUrl(raw);
      if (!absolute) {
        return match;
      }
      const quote = inner.trim().startsWith('"') ? '"' : inner.trim().startsWith("'") ? "'" : '';
      const closingQuote = quote;
      return `url(${quote}${absolute}${closingQuote})`;
    });
    return normalized;
  }

  return value;
}

function normalizeSrcset(value) {
  if (!value) {
    return value;
  }

  const parts = value
    .split(',')
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) {
        return '';
      }
      const segments = trimmed.split(/\s+/);
      const urlPart = segments.shift();
      if (!urlPart) {
        return '';
      }
      const absolute = resolveAbsoluteUrl(urlPart);
      const rebuiltUrl = absolute || urlPart;
      if (segments.length === 0) {
        return rebuiltUrl;
      }
      return `${rebuiltUrl} ${segments.join(' ')}`;
    })
    .filter(Boolean);

  return parts.join(', ');
}

function normalizeResourceAttributes(root) {
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    const normalizedSrc = resolveAbsoluteUrl(src);
    if (normalizedSrc) {
      img.setAttribute('src', normalizedSrc);
    }

    const srcset = img.getAttribute('srcset');
    const normalizedSrcset = normalizeSrcset(srcset);
    if (normalizedSrcset) {
      img.setAttribute('srcset', normalizedSrcset);
    }
  });

  root.querySelectorAll('source').forEach((source) => {
    const srcset = source.getAttribute('srcset');
    const normalizedSrcset = normalizeSrcset(srcset);
    if (normalizedSrcset) {
      source.setAttribute('srcset', normalizedSrcset);
    }

    const src = source.getAttribute('src');
    const normalizedSrc = resolveAbsoluteUrl(src);
    if (normalizedSrc) {
      source.setAttribute('src', normalizedSrc);
    }
  });
}

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
        const normalized = normalizeCssValue(property, value, source);
        if (!normalized) {
          return '';
        }
        return `${property}:${normalized};`;
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
  normalizeResourceAttributes(clone);
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
