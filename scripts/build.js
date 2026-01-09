const esbuild = require('esbuild');
const { wasmLoader } = require('esbuild-plugin-wasm');

const watch = process.argv.includes('--watch');

const buildOptions = {
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
  plugins: [wasmLoader()],
};

async function build() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
  }
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
