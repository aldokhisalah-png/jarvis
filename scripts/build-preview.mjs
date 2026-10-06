// Builds dist/jarvis-preview.html: the real app + core in one file, on sample data, thinking with Claude in the page.
// Usage: node scripts/build-preview.mjs [path/to/esbuild/package] [--stub path/to/claude-stub.js]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2), esPath = args[0] && !args[0].startsWith('--') ? args[0] : 'esbuild';
const stubAt = args.indexOf('--stub'), stub = stubAt >= 0 ? readFileSync(args[stubAt + 1], 'utf8') : '';
const out = stubAt >= 0 ? 'dist/preview-test.html' : 'dist/jarvis-preview.html';
const esbuild = createRequire(import.meta.url)(esPath);
const r = await esbuild.build({ entryPoints: [path.join(root, 'src/preview-main.js')], bundle: true, format: 'iife', write: false, target: 'es2020', minify: false, legalComments: 'none' });
// the page is one file: the logo the app shows goes in as a data URI
const logo = 'data:image/png;base64,' + readFileSync(path.join(root, 'icons/icon-192.png')).toString('base64');
const js = r.outputFiles[0].text.split('icons/maskable-512.png').join(logo);
if (js.includes('</script')) throw new Error('bundle contains </script');
const css = readFileSync(path.join(root, 'styles/app.css'), 'utf8');
const html = `<title>Jarvis</title>
<meta name="theme-color" content="#0a0c10">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap">
<style>
${css}
</style>
<div id="app"><p class="boot">JARVIS</p></div>
<dialog id="sheet"></dialog>
<div id="toast" role="status" aria-live="polite" hidden></div>
${stub ? `<script>\n${stub}\n</script>\n` : ''}<script>
${js}
</script>
`;
mkdirSync(path.join(root, 'dist'), { recursive: true });
writeFileSync(path.join(root, out), html);
console.log(out, html.length, 'bytes');
