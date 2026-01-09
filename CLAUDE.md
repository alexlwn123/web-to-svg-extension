# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
pnpm install          # Install dependencies
pnpm run build        # Build the extension bundle
pnpm run watch        # Build with file watching for development
```

## Required Assets Setup

Before building, copy these files:

- `assets/yoga.wasm` - Copy from `node_modules/yoga-wasm-web/dist/yoga.wasm`
- `assets/fonts/Inter-Regular.ttf` - Provide a TTF font file (Inter from `@fontsource/inter` works)

## Loading the Extension

Load as an unpacked extension at `chrome://extensions` after building.

## Architecture

This is a Chrome extension (Manifest V3) that captures DOM elements and renders them as SVGs using Satori.

### Extension Components

**Background Service Worker** (`src/background.js` → `dist/background.js`)

- Initializes Yoga WASM layout engine and Satori renderer
- Receives HTML/CSS payloads from content script
- Renders SVG via `satori` and `satori-html`
- Manages font resolution: fetches remote fonts, handles WOFF/WOFF2 detection, falls back to bundled Inter font
- Stores results in `chrome.storage.session` and broadcasts to popup/content script

**Content Script** (`src/content-script.js` → `dist/content-script.js`)

- Implements element picker overlay with highlight and label
- Clones selected element with computed inline styles
- Normalizes CSS values for Satori compatibility (oklch/oklab color conversion, URL resolution, keyword normalization)
- Collects font descriptors from `@font-face` rules and `document.fonts`
- Communicates via `chrome.runtime.sendMessage`

**Popup UI** (`src/popup.js`, `popup.html`)

- Controls selection flow (start/cancel)
- Displays SVG preview, output, and debug info for styles/fonts
- Handles SVG download via `chrome.downloads`

### Message Flow

1. Popup sends `start-selection` → Content script activates picker
2. User clicks element → Content script serializes DOM + styles + fonts
3. Content script sends `element-selected` → Background renders SVG
4. Background sends `render-complete` → Popup displays result

### CSS Normalization

The content script (`SUPPORTED_PROPERTIES` array) filters to ~70 CSS properties Satori supports. Key normalizations:

- `oklch()` / `oklab()` → RGB conversion
- Relative URLs → absolute URLs
- `position: fixed/sticky` → `absolute`
- `display: *` → `flex` (Satori's layout model)
- Length values (`max-width`, etc.) → pixel values only

### Font Handling

- Parses `@font-face` rules from stylesheets (including cross-origin fetches)
- Prioritizes TTF/OTF over WOFF/WOFF2 (Satori limitation)
- System fonts (Arial, Helvetica, etc.) fall back to bundled Inter
- Font data cached in background worker's `remoteFontCache`
