# Web to Image Chrome Extension

Capture any DOM element as an image. Pick an element on the page and export it as PNG, JPEG, or SVG.

## Features

- Element picker with hover highlighting
- Multiple output formats: PNG, JPEG, SVG
- Quality control for JPEG exports
- Preview and download from popup

## Getting Started

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Build the extension:
   ```bash
   pnpm run build
   ```
3. Load as an unpacked extension at `chrome://extensions`

Use `pnpm run watch` for development.

## Usage

1. Click the extension icon to open the popup
2. Select output format (PNG, JPEG, or SVG)
3. Click "Select Element" to activate the picker
4. Hover over elements to highlight them
5. Click to capture
6. Preview and download from the popup

Press <kbd>Esc</kbd> to cancel selection.
