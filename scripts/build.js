const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

// Content scripts can't use ES modules, need IIFE
const contentScriptOptions = {
  entryPoints: { 'content-script': 'src/content-script.js' },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: ['chrome110'],
  sourcemap: true,
  logLevel: 'info'
};

// Background and popup can use ES modules
const moduleOptions = {
  entryPoints: {
    background: 'src/background.js',
    popup: 'src/popup.js'
  },
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  target: ['chrome110'],
  sourcemap: true,
  logLevel: 'info'
};

async function build() {
  if (watch) {
    const [ctxContent, ctxModules] = await Promise.all([
      esbuild.context(contentScriptOptions),
      esbuild.context(moduleOptions)
    ]);
    await Promise.all([ctxContent.watch(), ctxModules.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(contentScriptOptions),
      esbuild.build(moduleOptions)
    ]);
  }
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
