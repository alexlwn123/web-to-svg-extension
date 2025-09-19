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

const LENGTH_ENFORCED_PROPERTIES = new Set([
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'top',
  'right',
  'bottom',
  'left'
]);

const NONE_STRIPPED_PROPERTIES = new Set([
  'background',
  'background-image',
  'box-shadow',
  'text-decoration',
  'filter',
  'border-image',
  'outline'
]);

const SYSTEM_FONT_FAMILIES = new Set(
  [
    '-apple-system',
    'system-ui',
    'blinkmacsystemfont',
    'segoe ui',
    'sfprodisplay',
    'sf pro display',
    'sfprotext',
    'sf pro text',
    'helvetica neue',
    'helvetica',
    'arial',
    'sans-serif',
    'serif',
    'monospace'
  ].map((family) => family.toLowerCase())
);

const BORDER_PROPERTIES = new Set([
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left'
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

function oklabToRgb(l, a, b, alpha = 1) {
  if (!Number.isFinite(l) || !Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }

  const clampedL = clamp(l, 0, 1);
  const { r, g, b: blue } = oklabToLinearSrgb(clampedL, a, b);
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

  if (lowerProp === 'position') {
    if (lowerValue === 'absolute' || lowerValue === 'relative') {
      return lowerValue;
    }
    if (lowerValue === 'fixed' || lowerValue === 'sticky') {
      return 'absolute';
    }
    return '';
  }

  if (lowerProp === 'overflow' || lowerProp === 'overflow-x' || lowerProp === 'overflow-y') {
    if (lowerValue === 'visible' || lowerValue === 'hidden') {
      return lowerValue;
    }
    if (lowerValue === 'clip') {
      return 'hidden';
    }
    if (lowerValue === 'auto' || lowerValue === 'scroll') {
      return 'hidden';
    }
    return 'visible';
  }

  if (lowerValue === 'none' && NONE_STRIPPED_PROPERTIES.has(lowerProp)) {
    return '';
  }

  if (lowerProp === 'display') {
    if (lowerValue === 'none') {
      return 'none';
    }
    if (lowerValue === 'flex' || lowerValue === 'inline-flex') {
      return 'flex';
    }
    return 'flex';
  }

  if (BORDER_PROPERTIES.has(lowerProp)) {
    if (lowerValue.includes('none')) {
      return '';
    }
    if (/\b0(?:px|em|rem|pt|%)?\b/.test(lowerValue)) {
      return '';
    }
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

function normalizeLengthValue(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const lower = trimmed.toLowerCase();
  if (['auto', 'none', 'initial', 'inherit', 'unset', 'max-content', 'min-content', 'fit-content'].includes(lower)) {
    return '';
  }

  const pxMatch = trimmed.match(/^(-?\d*\.?\d+)\s*px$/i);
  if (pxMatch) {
    const numeric = Number(pxMatch[1]);
    if (Number.isFinite(numeric)) {
      return `${numeric}px`;
    }
    return '';
  }

  const numberMatch = trimmed.match(/^(-?\d*\.?\d+)$/);
  if (numberMatch) {
    const numeric = Number(numberMatch[1]);
    if (Number.isFinite(numeric)) {
      return `${numeric}px`;
    }
    return '';
  }

  return '';
}

function normalizeCssValue(property, value, element) {
  if (!value) {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const keywordNormalized = normalizeKeywordProperty(property, trimmed);
  if (keywordNormalized === '') {
    return '';
  }
  if (keywordNormalized !== trimmed) {
    return keywordNormalized;
  }

  if (LENGTH_ENFORCED_PROPERTIES.has(property.toLowerCase())) {
    return normalizeLengthValue(trimmed);
  }

  if (property === 'transform') {
    return normalizeTransformValue(trimmed);
  }

  if (trimmed.toLowerCase().includes('oklch(')) {
    const normalized = trimmed.replace(/oklch\(\s*([^()]+?)\s*\)/gi, (match, inner) => {
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

  if (trimmed.toLowerCase().includes('oklab(')) {
    const normalized = trimmed.replace(/oklab\(\s*([^()]+?)\s*\)/gi, (match, inner) => {
      const [rawComponents, rawAlpha] = inner.split('/');
      const [lRaw, aRaw, bRaw] = (rawComponents || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (!lRaw || !aRaw || !bRaw) {
        return '#000000';
      }

      const l = parsePercentOrNumber(lRaw, 1);
      const a = parseFloat(aRaw);
      const b = parseFloat(bRaw);
      const alpha = rawAlpha ? parsePercentOrNumber(rawAlpha, 1) : 1;

      const converted = oklabToRgb(l, a, b, Number.isFinite(alpha) ? alpha : 1);
      return converted || '#000000';
    });
    return normalized;
  }

  if (trimmed.includes('url(')) {
    const normalized = trimmed.replace(/url\(([^)]+)\)/gi, (match, inner) => {
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

  return trimmed;
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

function describeNode(node, root) {
  if (!(node instanceof Element)) {
    return 'unknown';
  }

  const segments = [];
  let current = node;
  const limit = 10;
  let depth = 0;

  while (current && current instanceof Element && depth < limit) {
    let segment = current.tagName.toLowerCase();
    if (current.id) {
      segment += `#${current.id}`;
    } else if (current.classList.length) {
      const classes = Array.from(current.classList).slice(0, 2);
      if (classes.length) {
        segment += `.${classes.join('.')}`;
      }
    }

    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      const index = siblings.indexOf(current);
      if (index >= 0) {
        segment += `:nth-child(${index + 1})`;
      }
    }

    segments.unshift(segment);
    if (current === root) {
      break;
    }
    current = current.parentElement;
    depth += 1;
  }

  return segments.join(' > ');
}

function cloneWithInlineStyles(element) {
  const clone = element.cloneNode(true);
  const sourceElements = [element, ...element.querySelectorAll('*')];
  const cloneElements = [clone, ...clone.querySelectorAll('*')];
  const collectedStyles = [];

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
      collectedStyles.push({
        selector: describeNode(source, element),
        cssText: inline
      });
    }
  });

  return { clone, styles: collectedStyles };
}

function serializeElement(element) {
  const { clone, styles } = cloneWithInlineStyles(element);
  normalizeResourceAttributes(clone);
  const container = document.createElement('div');
  container.appendChild(clone);
  return {
    html: container.innerHTML,
    styles
  };
}

function normalizeFontFamilyName(value) {
  if (!value) {
    return '';
  }
  return value.trim().replace(/^['"]+|['"]+$/g, '');
}

function parseFontFamilyList(raw) {
  if (!raw) {
    return [];
  }

  const families = [];
  let current = '';
  let quote = '';

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if ((char === '"' || char === "'") && raw[index - 1] !== '\\') {
      if (!quote) {
        quote = char;
        continue;
      }
      if (quote === char) {
        quote = '';
        continue;
      }
    }
    if (char === ',' && !quote) {
      const normalized = normalizeFontFamilyName(current);
      if (normalized) {
        families.push(normalized);
      }
      current = '';
      continue;
    }
    current += char;
  }

  const tail = normalizeFontFamilyName(current);
  if (tail) {
    families.push(tail);
  }

  return families;
}

function normalizeFontWeight(value) {
  if (typeof value === 'number') {
    return clamp(Math.round(value), 100, 900);
  }
  const raw = (value || '').toString().trim().toLowerCase();
  if (!raw) {
    return 400;
  }
  if (raw === 'normal') {
    return 400;
  }
  if (raw === 'bold') {
    return 700;
  }
  const numeric = parseInt(raw, 10);
  if (Number.isFinite(numeric)) {
    return clamp(numeric, 100, 900);
  }
  return 400;
}

function isSystemFontFamily(family) {
  if (!family) {
    return false;
  }
  return SYSTEM_FONT_FAMILIES.has(family.toLowerCase());
}

function collectFontDescriptors(element) {
  const descriptors = new Map();
  const systemDescriptors = new Map();
  const elements = [element, ...element.querySelectorAll('*')];

  elements.forEach((node) => {
    if (!(node instanceof Element)) {
      return;
    }
    const style = window.getComputedStyle(node);
    const families = parseFontFamilyList(style.fontFamily);
    if (!families.length) {
      return;
    }
    const fontStyle = (style.fontStyle || 'normal').toLowerCase();
    const fontWeight = normalizeFontWeight(style.fontWeight);

    families.forEach((family) => {
      const normalizedFamily = normalizeFontFamilyName(family);
      if (!normalizedFamily) {
        return;
      }
      const lowerFamily = normalizedFamily.toLowerCase();
      const key = `${normalizedFamily.toLowerCase()}__${fontStyle}__${fontWeight}`;
      const targetMap = isSystemFontFamily(lowerFamily) ? systemDescriptors : descriptors;
      if (!targetMap.has(key)) {
        targetMap.set(key, {
          family: normalizedFamily,
          style: fontStyle,
          weight: fontWeight
        });
      }
    });
  });

  return {
    collectable: Array.from(descriptors.values()),
    system: Array.from(systemDescriptors.values())
  };
}

function extractUrlsFromSource(source, baseUrl = DOCUMENT_BASE_URL) {
  if (!source) {
    return [];
  }
  const urls = [];
  const regex = /url\(([^)]+)\)/gi;
  let match;
  while ((match = regex.exec(source)) !== null) {
    let rawUrl = match[1].trim();
    if ((rawUrl.startsWith('"') && rawUrl.endsWith('"')) || (rawUrl.startsWith("'") && rawUrl.endsWith("'"))) {
      rawUrl = rawUrl.slice(1, -1);
    }
    const resolved = resolveAbsoluteUrl(rawUrl, baseUrl);
    if (resolved) {
      urls.push(resolved);
    }
  }
  return urls;
}

const fontFaceEntriesState = {
  promise: null
};

function extractDeclaration(block, property) {
  if (!block) {
    return '';
  }
  const regex = new RegExp(`${property}\\s*:\\s*([^;]+);`, 'i');
  const match = block.match(regex);
  return match ? match[1].trim() : '';
}

function normalizeFontStyle(value) {
  const normalized = (value || 'normal').toLowerCase();
  if (normalized === 'italic' || normalized === 'oblique') {
    return 'italic';
  }
  return 'normal';
}

function addFontFaceEntry(entries, { family, style, weight, urls }) {
  if (!family || !urls || !urls.length) {
    return;
  }
  const normalizedFamily = normalizeFontFamilyName(family);
  if (!normalizedFamily) {
    return;
  }
  entries.push({
    family: normalizedFamily,
    style: normalizeFontStyle(style),
    weight: normalizeFontWeight(weight),
    urls: Array.from(new Set(urls))
  });
}

function processCssRules(rules, baseUrl, entries, externalQueue) {
  if (!rules) {
    return;
  }
  const list = Array.from(rules);
  list.forEach((rule) => {
    try {
      if (typeof CSSRule !== 'undefined' && rule.type === CSSRule.FONT_FACE_RULE) {
        const style = rule.style;
        const family = style.getPropertyValue('font-family');
        if (!family) {
          return;
        }
        const fontStyle = style.getPropertyValue('font-style');
        const fontWeight = style.getPropertyValue('font-weight');
        const src = style.getPropertyValue('src');
        const urls = extractUrlsFromSource(src, baseUrl);
        addFontFaceEntry(entries, {
          family,
          style: fontStyle,
          weight: fontWeight,
          urls
        });
        return;
      }
      if (typeof CSSRule !== 'undefined' && rule.type === CSSRule.IMPORT_RULE) {
        const importRule = rule;
        const href = importRule.href;
        if (!href) {
          return;
        }
        if (importRule.styleSheet && importRule.styleSheet.cssRules) {
          processCssRules(importRule.styleSheet.cssRules, href, entries, externalQueue);
          return;
        }
        const resolved = resolveAbsoluteUrl(href, baseUrl);
        if (resolved) {
          externalQueue.add(resolved);
        }
        return;
      }
      if (rule && rule.cssRules) {
        processCssRules(rule.cssRules, baseUrl, entries, externalQueue);
      }
    } catch (error) {
      if (rule && rule.href) {
        const resolved = resolveAbsoluteUrl(rule.href, baseUrl);
        if (resolved) {
          externalQueue.add(resolved);
        }
      }
    }
  });
}

function processCssText(cssText, baseUrl, entries, externalQueue) {
  if (!cssText) {
    return;
  }

  const importRegex = /@import\s+(?:url\()?['"]?([^'"\)]+)['"]?\)?[^;]*;/gi;
  let importMatch;
  while ((importMatch = importRegex.exec(cssText)) !== null) {
    const resolved = resolveAbsoluteUrl(importMatch[1], baseUrl);
    if (resolved) {
      externalQueue.add(resolved);
    }
  }

  const fontFaceRegex = /@font-face\s*{[^}]*}/gi;
  let match;
  while ((match = fontFaceRegex.exec(cssText)) !== null) {
    const block = match[0];
    const family = extractDeclaration(block, 'font-family');
    if (!family) {
      continue;
    }
    const fontStyle = extractDeclaration(block, 'font-style');
    const fontWeight = extractDeclaration(block, 'font-weight');
    const src = extractDeclaration(block, 'src');
    const urls = extractUrlsFromSource(src, baseUrl);
    addFontFaceEntry(entries, {
      family,
      style: fontStyle,
      weight: fontWeight,
      urls
    });
  }
}

async function collectFontFaceEntries() {
  const entries = [];
  const externalQueue = new Set();
  const seenExternal = new Set();

  Array.from(document.styleSheets).forEach((sheet) => {
    if (!sheet) {
      return;
    }
    const baseUrl = sheet.href || DOCUMENT_BASE_URL;
    try {
      const rules = sheet.cssRules;
      if (!rules) {
        return;
      }
      processCssRules(rules, baseUrl, entries, externalQueue);
    } catch (error) {
      if (sheet.href) {
        const resolved = resolveAbsoluteUrl(sheet.href, DOCUMENT_BASE_URL);
        if (resolved) {
          externalQueue.add(resolved);
        }
      }
    }
  });

  const queue = [];
  externalQueue.forEach((url) => {
    if (!seenExternal.has(url)) {
      queue.push(url);
      seenExternal.add(url);
    }
  });
  externalQueue.clear();

  while (queue.length) {
    const url = queue.shift();
    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }
      const cssText = await response.text();
      processCssText(cssText, url, entries, externalQueue);
    } catch (error) {
      console.warn('Failed to fetch external stylesheet for fonts', { url, error });
    }

    externalQueue.forEach((nextUrl) => {
      if (!seenExternal.has(nextUrl)) {
        queue.push(nextUrl);
        seenExternal.add(nextUrl);
      }
    });
    externalQueue.clear();
  }

  return entries;
}

async function getFontFaceEntries() {
  if (!fontFaceEntriesState.promise) {
    fontFaceEntriesState.promise = collectFontFaceEntries();
  }
  try {
    return await fontFaceEntriesState.promise;
  } catch (error) {
    console.warn('Failed to collect font-face entries', error);
    fontFaceEntriesState.promise = null;
    return [];
  }
}

async function resolveFontFaceUrls(descriptor) {
  const entries = await getFontFaceEntries();
  if (!entries.length) {
    return [];
  }

  const targetFamily = descriptor.family.toLowerCase();
  const targetStyle = descriptor.style.toLowerCase();
  const targetWeight = descriptor.weight;

  let fallback = [];

  for (const entry of entries) {
    if (entry.family.toLowerCase() !== targetFamily) {
      continue;
    }
    if (!entry.urls || !entry.urls.length) {
      continue;
    }
    if (entry.style === targetStyle && entry.weight === targetWeight) {
      return entry.urls;
    }
    if (!fallback.length && entry.style === targetStyle) {
      fallback = entry.urls;
    } else if (!fallback.length) {
      fallback = entry.urls;
    }
  }

  return fallback;
}

function findMatchingFontFace(descriptor, fontFaces) {
  const targetFamily = descriptor.family.toLowerCase();
  const targetStyle = descriptor.style.toLowerCase();
  const targetWeight = descriptor.weight;
  let fallbackMatch = null;

  for (const fontFace of fontFaces) {
    const family = normalizeFontFamilyName(fontFace.family).toLowerCase();
    if (family !== targetFamily) {
      continue;
    }
    const faceWeight = normalizeFontWeight(fontFace.weight);
    const faceStyle = (fontFace.style || 'normal').toLowerCase();
    if (faceWeight === targetWeight && faceStyle === targetStyle) {
      return fontFace;
    }
    if (!fallbackMatch && faceStyle === targetStyle) {
      fallbackMatch = fontFace;
    } else if (!fallbackMatch) {
      fallbackMatch = fontFace;
    }
  }

  return fallbackMatch;
}

async function createFontPayload(fontFace, descriptor) {
  try {
    if (fontFace?.status === 'unloaded') {
      await fontFace.load();
    } else if (fontFace?.status === 'loading') {
      await fontFace.loaded;
    }
  } catch (error) {
    console.warn('Failed to load font face', { descriptor, error });
  }

  const urlSet = new Set();
  try {
    const resolvedUrls = await resolveFontFaceUrls(descriptor);
    if (Array.isArray(resolvedUrls)) {
      resolvedUrls.forEach((url) => urlSet.add(url));
    }
  } catch (error) {
    console.warn('Failed to resolve font-face urls', { descriptor, error });
  }

  const urls = Array.from(urlSet);
  if (urls.length === 0) {
    return null;
  }

  const payload = {
    name: descriptor.family,
    weight: descriptor.weight,
    style: descriptor.style
  };

  if (urls.length) {
    payload.urls = urls;
  }

  return payload;
}

async function collectFontsForElement(element) {
  if (!element || !document.fonts) {
    return [];
  }

  try {
    await document.fonts.ready;
  } catch (error) {
    console.warn('document.fonts.ready rejected', error);
  }

  const { collectable, system } = collectFontDescriptors(element);
  if (!collectable.length && !system.length) {
    return [];
  }

  const fontFaces = [];
  if (typeof document.fonts.forEach === 'function') {
    document.fonts.forEach((fontFace) => {
      fontFaces.push(fontFace);
    });
  } else if (typeof document.fonts.values === 'function') {
    for (const fontFace of document.fonts.values()) {
      fontFaces.push(fontFace);
    }
  }

  const results = [];
  const seen = new Set();

  for (const descriptor of collectable) {
    const fontFace = fontFaces.length ? findMatchingFontFace(descriptor, fontFaces) : null;
    const payload = await createFontPayload(fontFace, descriptor);
    if (!payload) {
      continue;
    }
    const key = `${payload.name.toLowerCase()}__${payload.style}__${payload.weight}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(payload);
  }
  const systemEntries = system.map((descriptor) => ({
    name: descriptor.family,
    weight: descriptor.weight,
    style: descriptor.style,
    system: true
  }));

  return [...results, ...systemEntries];
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
  const rect = targetElement.getBoundingClientRect();
  const serialized = serializeElement(targetElement);
  const backgroundColor = window.getComputedStyle(document.body).backgroundColor || '#ffffff';

  let fontsResult = [];
  try {
    fontsResult = await collectFontsForElement(targetElement);
  } catch (error) {
    console.warn('Failed to collect fonts for selection', error);
  }

  const styles = Array.isArray(serialized.styles)
    ? serialized.styles.map((entry) => ({
      selector: typeof entry.selector === 'string' ? entry.selector : 'unknown',
      cssText: typeof entry.cssText === 'string' ? entry.cssText : ''
    }))
    : [];

  const request = {
    type: 'element-selected',
    requestId,
    payload: {
      html: serialized.html,
      width: Math.max(1, Math.round(rect.width)) || 1,
      height: Math.max(1, Math.round(rect.height)) || 1,
      backgroundColor,
      fonts: fontsResult,
      styles
    }
  };
  chrome.runtime.sendMessage(request);
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
    console.warn('Failed to complete selection', error);
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
