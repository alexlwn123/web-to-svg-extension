# Web to SVG Chrome Extension

This extension lets you pick any element on the current page (similar to the Chrome DevTools element picker) and exports the DOM subtree as an SVG using [Satori](https://github.com/vercel/satori).

## Features

- Activate an element picker from the extension popup and highlight DOM nodes on hover.
- Click to capture the selected element with its inline styles.
- Render the captured markup to SVG via Satori in the extension service worker.
- Preview the generated SVG, copy the markup, or download it directly from the popup.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the required runtime assets into the expected locations:
   - `assets/yoga.wasm`: copy from `node_modules/yoga-wasm-web/dist/yoga.wasm`.
   - `assets/fonts/Inter-Regular.ttf`: provide a font you are licensed to redistribute (the Inter font from `@fontsource/inter` works well).
3. Build the extension bundle:
   ```bash
   npm run build
   ```
4. Load the project as an unpacked extension in `chrome://extensions`.

For development you can use `npm run watch` to rebuild on changes.

## Notes

- Satori supports a subset of CSS. Extremely complex layouts or unsupported properties may not render exactly as in the page.
- The generated SVG width and height match the element’s bounding box. Resize inside the popup before exporting if needed.
- The picker listens for <kbd>Esc</kbd> to cancel. You can also cancel from the popup.
