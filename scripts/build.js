const esbuild = require('esbuild');
const { wasmLoader } = require('esbuild-plugin-wasm');

const watch = process.argv.includes('--watch');

async function build() {
  return esbuild.build({
    entryPoints: {
      background: 'src/background.js',
      'content-script': 'src/content-script.js',
      popup: 'src/popup.js'
    },
    bundle: true,
    outdir: 'dist',
    format: 'esm',
    target: ['chrome110'],
    sourcemap: true,
    loader: {
      '.ttf': 'file',
      '.wasm': 'file'
    },
    logLevel: 'info',
    // plugins: [wasmLoader()]
    // watch: watch ? {
    //   onRebuild(error) {
    //     if (error) {
    //       console.error('Rebuild failed:', error.message);
    //     } else {
    //       console.log('Rebuild succeeded');
    //     }
    //   }
    // } : undefined,
  });
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
