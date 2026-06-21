/**
 * Assembles a single, fully self-contained reader.html for the WebView reader,
 * inlining the vendored libraries (jszip, epub.js), styles and controller so
 * the reader works completely offline (no CDN, no file:// subresources).
 *
 * Run:  npm run build:reader
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// Bundled reading fonts → inlined @font-face so font-family actually applies
// in the WebView (latin-subset woff2, ~120 KB total).
const FONTS = [
  { key: 'alice', family: 'Alice' },
  { key: 'comfortaa', family: 'Comfortaa' },
  { key: 'merriweather', family: 'Merriweather' },
  { key: 'roboto', family: 'Roboto' },
  { key: 'notoSerif', family: 'Noto Serif' },
];
const fontFaces = FONTS.map(({ key, family }) => {
  const b64 = readFileSync(resolve(root, `src/reader-web/fonts/${key}.woff2`)).toString('base64');
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:400;font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
}).join('\n');

const jszip = read('node_modules/jszip/dist/jszip.min.js');
const epub = read('node_modules/epubjs/dist/epub.min.js');
const pdf = read('node_modules/pdfjs-dist/build/pdf.min.js');
const pdfWorker = read('node_modules/pdfjs-dist/build/pdf.worker.min.js');
const marked = read('node_modules/marked/marked.min.js');
const css = read('src/reader-web/reader.css');
const controller = read('src/reader-web/controller.js');

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<style>${css}</style>
</head>
<body>
<div id="viewer"></div>
<script>${jszip}</script>
<script>${epub}</script>
<script>${pdf}</script>
<script>${marked}</script>
<script>window.__PDF_WORKER_SRC__ = ${JSON.stringify(pdfWorker)};</script>
<script>window.__READER_FONTS_CSS__ = ${JSON.stringify(fontFaces)};</script>
<script>${controller}</script>
</body>
</html>`;

const outDir = resolve(root, 'assets/reader');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, 'reader.html');
writeFileSync(out, html, 'utf8');
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} kB)`);
