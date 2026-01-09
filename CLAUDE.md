# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
pnpm install          # Install dependencies
pnpm run build        # Build the extension bundle
pnpm run watch        # Build with file watching for development
```

## Loading the Extension

Load as an unpacked extension at `chrome://extensions` after building.

## Architecture

This is a Chrome extension (Manifest V3) that captures DOM elements as images using html-to-image.

### Extension Components

**Background Service Worker** (`src/background.js` → `dist/background.js`)

- Routes messages between content script and popup
- Handles file downloads via `chrome.downloads`
- Stores capture results in `chrome.storage.session`

**Content Script** (`src/content-script.js` → `dist/content-script.js`)

- Implements element picker overlay with highlight and label
- Captures selected element using html-to-image
- Supports PNG, JPEG, and SVG output formats
- Communicates via `chrome.runtime.sendMessage`

**Capture Module** (`src/capture.js`)

- Wraps html-to-image library (toPng, toJpeg, toSvg)
- Handles image loading and font readiness
- Validates element dimensions (max 4096x4096)
- Filters out script/noscript nodes

**Popup UI** (`src/popup.js`, `popup.html`)

- Controls selection flow (start/cancel)
- Format selection (PNG, JPEG, SVG)
- Quality slider for JPEG
- Displays image preview
- Handles download

### Message Flow

1. Popup sends `start-selection` with format/quality → Content script activates picker
2. User clicks element → Content script captures via html-to-image
3. Content script sends `capture-complete` with dataUrl → Background stores and forwards
4. Background sends result → Popup displays preview

### Build Configuration

The build system uses esbuild with dual formats:
- Content script: IIFE format (required by Chrome)
- Background/popup: ESM format

See `docs/BUILD_CONFIGURATION.md` for details.
