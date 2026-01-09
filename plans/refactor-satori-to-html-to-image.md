# refactor: Replace Satori with html-to-image Library

## Overview

Replace the current Satori-based SVG rendering pipeline with the `bubkoo/html-to-image` library to dramatically simplify the extension architecture. This eliminates ~800 lines of CSS normalization code, WASM loading complexity, and the need for worker-based rendering.

**Current Architecture:**
```
Content Script → Serialize HTML/CSS → Background Worker → Satori + Yoga WASM → SVG → Download
```

**Proposed Architecture:**
```
Content Script → html-to-image → PNG/JPEG → Background Worker → Download
```

## Problem Statement / Motivation

The current implementation has significant complexity:

1. **70+ CSS property normalizations** (`content-script.js:2-68`) - Converting oklch/oklab colors, flexbox coercion, URL resolution, etc.
2. **WASM loading** (`background.js:61-86`) - Yoga layout engine initialization
3. **Font serialization** (`content-script.js:1103-1154`) - Complex font collection and payload creation
4. **Cross-thread messaging** - Sending large HTML payloads between content script and service worker
5. **SVG-only output** - Limited to single output format

The `html-to-image` library handles all of this automatically by rendering directly in the DOM context, supporting modern CSS features natively.

## Proposed Solution

Use `html-to-image` library directly in the content script to capture DOM elements as raster images (PNG/JPEG), eliminating the need for:
- CSS normalization code
- Satori and satori-html dependencies
- Yoga WASM and its initialization
- Complex font payload construction
- Large HTML message passing

## Technical Approach

### Architecture Changes

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   popup.js      │────▶│ content-script.js│────▶│  background.js  │
│                 │     │                  │     │   (minimal)     │
│ - UI controls   │     │ - Element select │     │ - Download only │
│ - Preview       │     │ - html-to-image  │     │                 │
│ - Format select │     │ - Blob creation  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Key Technical Decisions

#### 1. Download Mechanism

**Problem:** Content scripts cannot call `chrome.downloads.download()` directly.

**Solution:** Keep minimal background worker for download orchestration:
```javascript
// content-script.js
const blob = await toBlob(element, options);
const reader = new FileReader();
reader.readAsDataURL(blob);
reader.onloadend = () => {
  chrome.runtime.sendMessage({
    type: 'download',
    dataUrl: reader.result,
    filename: `capture-${Date.now()}.png`
  });
};

// background.js (minimal ~50 lines)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'download') {
    chrome.downloads.download({
      url: msg.dataUrl,
      filename: msg.filename,
      saveAs: true
    });
  }
});
```

#### 2. Cross-Origin Image Handling

**Problem:** Canvas-based rendering is tainted by cross-origin images without CORS.

**Solution:** Use `cacheBust` option and document limitation:
```javascript
await toPng(element, {
  cacheBust: true,  // Adds timestamp to URLs to bypass cache
  imagePlaceholder: 'data:image/png;base64,...'  // Fallback for failed images
});
```

**Note:** This is a **known limitation** compared to current Satori approach. Document in extension description.

#### 3. Output Format

**Decision:** Support PNG (default) and JPEG with quality selector.

```javascript
// popup.html - Add format selector
<select id="format">
  <option value="png">PNG (lossless, supports transparency)</option>
  <option value="jpeg">JPEG (smaller file size)</option>
</select>
<input type="range" id="quality" min="0.5" max="1" step="0.05" value="0.92">
```

#### 4. Large Element Safeguards

**Limits:**
- Max dimensions: 4096 x 4096 pixels
- Timeout: 10 seconds
- DOM node count warning: > 2000 nodes

```javascript
function validateElement(element) {
  const rect = element.getBoundingClientRect();
  if (rect.width > 4096 || rect.height > 4096) {
    throw new Error('Element too large (max 4096x4096 pixels)');
  }

  const nodeCount = element.querySelectorAll('*').length;
  if (nodeCount > 2000) {
    console.warn(`Large DOM: ${nodeCount} nodes, may be slow`);
  }
}
```

### Implementation Phases

#### Phase 1: Add html-to-image (Non-Breaking)

**Files to modify:**
- `package.json` - Add html-to-image dependency

```json
{
  "dependencies": {
    "html-to-image": "^1.11.11"
  }
}
```

**Files to create:**
- `src/capture.js` - New capture module using html-to-image

```javascript
// src/capture.js
import { toPng, toJpeg, toBlob } from 'html-to-image';

export async function captureElement(element, options = {}) {
  const {
    format = 'png',
    quality = 0.92,
    pixelRatio = window.devicePixelRatio,
    backgroundColor = null
  } = options;

  // Wait for fonts
  await document.fonts.ready;

  // Wait for images
  await waitForImages(element);

  const captureOptions = {
    cacheBust: true,
    pixelRatio,
    backgroundColor,
    filter: (node) => {
      // Exclude script tags and hidden elements
      if (node.tagName === 'SCRIPT') return false;
      if (node.tagName === 'NOSCRIPT') return false;
      return true;
    }
  };

  if (format === 'jpeg') {
    captureOptions.quality = quality;
    captureOptions.backgroundColor = backgroundColor || '#ffffff';
    return toJpeg(element, captureOptions);
  }

  return toPng(element, captureOptions);
}

async function waitForImages(element) {
  const images = Array.from(element.querySelectorAll('img'));
  await Promise.all(
    images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', resolve);
        img.addEventListener('error', resolve);
        setTimeout(resolve, 5000); // 5s timeout per image
      });
    })
  );
}
```

#### Phase 2: Integrate into Content Script

**Files to modify:**
- `src/content-script.js` - Replace `completeSelection()` implementation

```javascript
// Replace lines 1166-1203 with:
async function completeSelection() {
  const targetElement = currentElement;

  try {
    setStatus('Capturing element...');

    const dataUrl = await captureElement(targetElement, {
      format: 'png',
      pixelRatio: window.devicePixelRatio
    });

    chrome.runtime.sendMessage({
      type: 'capture-complete',
      dataUrl,
      width: targetElement.offsetWidth,
      height: targetElement.offsetHeight
    });

  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'capture-error',
      error: error.message
    });
  }
}
```

#### Phase 3: Update Popup UI

**Files to modify:**
- `popup.html` - Update preview and add format controls
- `src/popup.js` - Handle raster preview display

```javascript
// popup.js changes
function handleCaptureComplete(message) {
  const preview = document.getElementById('preview');
  const img = document.createElement('img');
  img.src = message.dataUrl;
  img.style.maxWidth = '100%';
  preview.innerHTML = '';
  preview.appendChild(img);

  resultSection.hidden = false;
  downloadBtn.onclick = () => downloadImage(message.dataUrl);
}

function downloadImage(dataUrl) {
  chrome.runtime.sendMessage({
    type: 'download',
    dataUrl,
    filename: `element-${Date.now()}.png`
  });
}
```

#### Phase 4: Simplify Background Worker

**Files to modify:**
- `src/background.js` - Reduce to ~50 lines (download only)

```javascript
// Simplified background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'download') {
    chrome.downloads.download({
      url: message.dataUrl,
      filename: message.filename,
      saveAs: true
    });
    sendResponse({ ok: true });
    return true;
  }

  // Forward messages between popup and content script
  if (message.type === 'start-selection') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, message);
    });
  }
});
```

#### Phase 5: Remove Deprecated Code

**Files to delete:**
- None (all code is in existing files)

**Code to remove from `content-script.js`:**
- Lines 2-68: `SUPPORTED_PROPERTIES` array
- Lines 253-457: CSS normalization functions (`normalizeCssValue`, `normalizeOkLabColor`, etc.)
- Lines 623-657: `cloneWithInlineStyles()` function
- Lines 1103-1154: `collectFontsForElement()` function
- All font serialization logic

**Code to remove from `background.js`:**
- Lines 1-60: Satori/Yoga imports and initialization
- Lines 61-86: `ensureYoga()` function
- Lines 87-376: Font resolution and rendering logic
- Lines 377-412: `renderSvg()` function

**Dependencies to remove from `package.json`:**
```json
{
  "dependencies": {
    // REMOVE:
    "satori": "^0.10.0",
    "satori-html": "^0.3.0",
    "yoga-wasm-web": "^0.3.3"
  }
}
```

#### Phase 6: Update Manifest

**Files to modify:**
- `manifest.json`

```json
{
  "name": "Web to Image",
  "description": "Capture DOM elements as PNG or JPEG images",
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
    // REMOVE: 'wasm-unsafe-eval'
  },
  "web_accessible_resources": [
    // REMOVE: yoga.wasm, Inter font files
  ]
}
```

## Acceptance Criteria

### Functional Requirements

- [ ] Capture any DOM element as PNG image
- [ ] Capture any DOM element as JPEG image with quality setting
- [ ] Preview captured image in popup before download
- [ ] Download captured image with timestamped filename
- [ ] Handle elements with web fonts (wait for font loading)
- [ ] Handle elements with images (wait for image loading)
- [ ] Show clear error message when capture fails
- [ ] Support high-DPI displays (respect devicePixelRatio)

### Non-Functional Requirements

- [ ] Capture completes within 10 seconds for typical elements
- [ ] Extension size reduced (no WASM, no bundled fonts)
- [ ] Memory usage stays under 50MB for typical captures
- [ ] Works in Chrome 88+ (Manifest V3 baseline)

### Quality Gates

- [ ] All existing element selection UI works unchanged
- [ ] Error messages are user-friendly and actionable
- [ ] No console errors in normal operation
- [ ] Code review approved

## Success Metrics

1. **Code reduction**: Remove ~800 lines of CSS normalization code
2. **Dependency reduction**: Remove 3 dependencies (satori, satori-html, yoga-wasm-web)
3. **Bundle size reduction**: Remove ~400KB (yoga.wasm + bundled font)
4. **Maintenance burden**: Rely on maintained library vs custom CSS parsing

## Dependencies & Prerequisites

- [ ] html-to-image library (^1.11.11) - well-maintained, 5k+ GitHub stars
- [ ] Chrome 88+ for Manifest V3 support
- [ ] No new permissions required

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Cross-origin images fail silently | High | Medium | Document limitation, use `imagePlaceholder` option |
| Large elements cause memory issues | Medium | High | Implement size limits and timeout |
| Font rendering differs from Satori | Low | Medium | Test extensively, fonts should render more accurately |
| CSS features not supported | Low | Low | html-to-image uses browser's native rendering |

## Known Limitations (Document for Users)

1. **Cross-origin images**: Images from other domains without CORS headers will appear blank or use placeholder
2. **Shadow DOM**: Content inside closed shadow roots may not be captured
3. **Iframes**: Cross-origin iframe content cannot be captured
4. **Very large elements**: Elements exceeding 4096x4096 pixels will fail

## Future Considerations

- [ ] Add clipboard copy support (`navigator.clipboard.write`)
- [ ] Add context menu "Capture element" option
- [ ] Add SVG output option (using toSvg from html-to-image)
- [ ] Add settings page for persistent format preferences
- [ ] Add WebP format support for modern browsers

## References & Research

### Internal References
- Current architecture: `src/background.js:377-412` (Satori rendering)
- CSS normalization: `src/content-script.js:253-457`
- Font collection: `src/content-script.js:1103-1154`
- Element serialization: `src/content-script.js:623-657`

### External References
- [html-to-image GitHub](https://github.com/bubkoo/html-to-image) - Library documentation
- [Chrome Extensions MV3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3) - Service worker limitations
- [MDN CORS Enabled Images](https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image) - Canvas tainting

### Related Work
- Current commits: `79991a6`, `d377bc4` - Recent progress on existing implementation

---

## Implementation Checklist

### Phase 1: Setup
- [ ] Add html-to-image to package.json
- [ ] Create src/capture.js module
- [ ] Run npm install
- [ ] Verify build works

### Phase 2: Content Script Integration
- [ ] Import capture module in content-script.js
- [ ] Replace completeSelection() function
- [ ] Test basic capture functionality
- [ ] Verify element selection still works

### Phase 3: Popup Updates
- [ ] Update preview display for raster images
- [ ] Add format selector (PNG/JPEG)
- [ ] Add quality slider for JPEG
- [ ] Update download button handler

### Phase 4: Background Worker Simplification
- [ ] Create new minimal background.js
- [ ] Implement download message handler
- [ ] Remove Satori/Yoga code
- [ ] Test download flow end-to-end

### Phase 5: Cleanup
- [ ] Remove CSS normalization code
- [ ] Remove font serialization code
- [ ] Remove unused dependencies
- [ ] Update manifest.json
- [ ] Remove web_accessible_resources

### Phase 6: Testing & Polish
- [ ] Test on various websites
- [ ] Test with web fonts
- [ ] Test with images (same-origin and cross-origin)
- [ ] Test large elements
- [ ] Test error scenarios
- [ ] Update extension name/description
