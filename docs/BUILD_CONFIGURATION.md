# Build Configuration Requirements

## Critical Rule: Content Script IIFE Format

Chrome extensions have strict content script requirements that are non-negotiable:

### Content Scripts (IIFE Required)

- **File:** `src/content-script.js`
- **Build format:** IIFE (Immediately Invoked Function Expression)
- **Why:** Chrome loads content scripts in an isolated context that does NOT support ES6 module syntax
- **Error if violated:** `Uncaught SyntaxError: Cannot use import statement outside a module`
- **How to fix:** Set `format: 'iife'` in esbuild configuration

```javascript
// ✓ CORRECT - Content script builds to IIFE
const contentScriptOptions = {
  entryPoints: { 'content-script': 'src/content-script.js' },
  format: 'iife',  // ← CRITICAL: Must be 'iife', never 'esm'
  target: ['chrome110'],
};

// ✗ WRONG - This breaks the extension
const contentScriptOptions = {
  format: 'esm',  // ← Will cause import error at runtime
};
```

### Background Service Worker (ESM Allowed)

- **File:** `src/background.js`
- **Build format:** ESM (ES Modules)
- **Why:** Manifest V3 service workers support module syntax via `"type": "module"`
- **Requirement in manifest.json:**
  ```json
  {
    "background": {
      "service_worker": "dist/background.js",
      "type": "module"
    }
  }
  ```

### Popup Script (ESM Allowed)

- **File:** `src/popup.js`
- **Load method:** `<script type="module" src="dist/popup.js"></script>`
- **Build format:** ESM
- **Requirement in popup.html:**
  ```html
  <script type="module" src="dist/popup.js"></script>
  ```

## Build System Configuration

The dual-build system in `scripts/build.js` handles both formats automatically:

```javascript
// Two separate compilation passes
esbuild.build(contentScriptOptions);  // → format: 'iife'
esbuild.build(moduleOptions);          // → format: 'esm'
```

This ensures:
- Content script loads without import errors
- Background and popup use modern ES6 module syntax
- No import conflicts between contexts

## Verification Checklist

Before considering the build complete:

- [ ] **IIFE Format Check:** `dist/content-script.js` starts with `(function() {`
- [ ] **ESM Format Check:** `dist/background.js` contains `import` statements
- [ ] **No Import Errors:** `dist/content-script.js` does NOT contain `import` or `export` at top level
- [ ] **Extension Loads:** Load unpacked extension in Chrome without console errors
- [ ] **Element Picker Works:** Hover over elements without errors in DevTools
- [ ] **No Format Warnings:** Check extension warnings in Chrome's extensions page

### Quick Verification Commands

Add these to `package.json`:

```json
{
  "scripts": {
    "verify:format": "grep -q '^(function()' dist/content-script.js && echo '✓ Content script is IIFE format' || echo '✗ Content script is NOT IIFE format'",
    "verify:esm": "grep -q '^import' dist/background.js && echo '✓ Background uses ESM' || echo '✗ Background does NOT use ESM'",
    "verify:build": "npm run build && npm run verify:format && npm run verify:esm"
  }
}
```

Run verification:

```bash
npm run verify:build
# Output:
# ✓ Content script is IIFE format
# ✓ Background uses ESM
```

## Troubleshooting

### Error: "Cannot use import statement outside a module"

**Cause:** Content script compiled to ESM instead of IIFE

**Fix:** Check `scripts/build.js` and verify:
```javascript
const contentScriptOptions = {
  format: 'iife'  // ← Must be 'iife'
};
```

Then rebuild:
```bash
npm run build
npm run verify:build
```

### Error: "require is not defined"

**Cause:** Background script built as IIFE instead of ESM

**Fix:** Check `scripts/build.js` and verify:
```javascript
const moduleOptions = {
  format: 'esm'  // ← Must be 'esm'
};
```

### Element Picker Not Working

**Steps to debug:**
1. Open extension in Chrome
2. Open DevTools on any webpage
3. Look for errors mentioning "import" or "require"
4. Run `npm run verify:build` locally
5. If format is wrong, rebuild and reload extension

## References

- [Chrome Extensions Architecture](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Manifest V3 Service Workers](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [esbuild Format Options](https://esbuild.github.io/api/#format)
