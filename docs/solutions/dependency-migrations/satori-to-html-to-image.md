---
title: Replace Satori/Yoga WASM with html-to-image for DOM Capture
category: dependency-migrations
tags:
  - chrome-extension
  - refactoring
  - wasm-removal
  - simplification
  - dom-capture
component: web-to-image Chrome Extension
severity: medium
date_solved: 2026-01-09
---

# Satori to html-to-image Migration

## Problem

The original rendering pipeline used Satori + Yoga WASM in a background worker, creating significant complexity:

- **1700+ lines of code** across content script and background worker
- Complex CSS normalization (~70 properties for Satori compatibility)
- Font serialization and cross-origin handling
- `wasm-unsafe-eval` CSP requirement (security concern)
- Large message payloads between content script and worker

## Solution

Replace with `html-to-image` library which captures DOM elements directly using native browser rendering.

### Key Changes

| Aspect | Before | After |
|--------|--------|-------|
| Content Script | 1,294 lines | 224 lines |
| Background Script | 479 lines | 60 lines |
| Dependencies | satori, yoga-wasm-web, satori-html | html-to-image |
| CSP | wasm-unsafe-eval required | None needed |
| Rendering | Background worker | Content script |

### New Architecture

```
Popup → Content Script (html-to-image) → Background (download only)
```

### Critical Fix: Content Script Module Format

Content scripts in Chrome extensions **cannot use ES modules**. The build must use IIFE format:

```javascript
// scripts/build.js
const contentScriptOptions = {
  entryPoints: { 'content-script': 'src/content-script.js' },
  bundle: true,
  outdir: 'dist',
  format: 'iife',  // CRITICAL: Must be IIFE, not ESM
  target: ['chrome110'],
};

const moduleOptions = {
  entryPoints: {
    background: 'src/background.js',
    popup: 'src/popup.js'
  },
  format: 'esm',  // Background/popup can use ESM
};
```

### Capture Module Pattern

```javascript
// src/capture.js
import { toPng, toJpeg, toSvg } from 'html-to-image';

export async function captureElement(element, options = {}) {
  const { format = 'png', quality = 0.92 } = options;

  await document.fonts.ready;
  await waitForImages(element);

  switch (format) {
    case 'jpeg':
      return toJpeg(element, { quality, backgroundColor: '#ffffff' });
    case 'svg':
      return toSvg(element);
    default:
      return toPng(element);
  }
}
```

## Prevention

### Module Format Check

If you see "Cannot use import statement" or "Receiving end does not exist" errors in a Chrome extension:

1. Check content script build format is IIFE, not ESM
2. Background service workers can use ESM with `"type": "module"` in manifest
3. Split build configuration for different contexts

### Security Best Practices

1. Sanitize download filenames to prevent path traversal:
   ```javascript
   const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
   ```

2. Avoid `wasm-unsafe-eval` when possible by choosing libraries that don't require WASM

3. Remove `web_accessible_resources` when no longer needed

## Trade-offs Accepted

- SVG output produces foreignObject (embedded HTML) rather than true vector paths
- Cross-origin images may fail without CORS headers (html-to-image limitation)
- Rendering blocks page briefly (content script context vs. background worker)

## Files Changed

- `src/capture.js` - New module wrapping html-to-image
- `src/content-script.js` - Simplified from 1294 to 224 lines
- `src/background.js` - Reduced to download router (60 lines)
- `scripts/build.js` - Split IIFE/ESM build targets
- `manifest.json` - Removed wasm-unsafe-eval, web_accessible_resources
- `package.json` - Swapped dependencies

## References

- [html-to-image](https://github.com/bubkoo/html-to-image)
- [Chrome Extension Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
