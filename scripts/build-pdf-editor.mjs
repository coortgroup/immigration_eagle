import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  entryPoints: [resolve(root, 'src/pdf-editor/editor.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'eof',
  write: false,
});
const javascript = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile(resolve(root, 'src/pdf-editor/styles.css'), 'utf8');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>Fillable PDF</title>
<style>${css}</style>
</head>
<body>
  <header class="toolbar">
    <div class="toolbar-top">
      <h1 class="sr-only" id="document-title">Your fillable PDF</h1>
      <div class="actions">
        <button class="action" id="save-pdf" type="button" disabled><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></svg>Save filled PDF</button>
        <button class="action secondary" id="print-pdf" type="button" disabled><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7z"/><path d="M17 11h.01"/></svg>Print</button>
      </div>
    </div>
    <div class="toolbar-bottom">
      <nav class="page-navigation" aria-label="PDF pages">
        <button class="control" id="previous-page" type="button" aria-label="Previous page" disabled>‹</button>
        <label class="sr-only" for="page-select">Page</label><select class="control" id="page-select" disabled><option>Loading pages…</option></select>
        <button class="control" id="next-page" type="button" aria-label="Next page" disabled>›</button>
        <label class="zoom-label" for="zoom-select"><span class="sr-only">Zoom</span><select class="control" id="zoom-select" disabled><option value="fit">Fit width</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></label>
      </nav>
      <p class="status" id="status" role="status" aria-live="polite">Opening your fillable PDF…</p>
    </div>
  </header>
  <div class="notice"><strong>Fill in the blue fields, then save or print your completed form.</strong> Save a copy before closing this window.</div>
  <div class="error" id="error" role="alert" hidden><span id="error-text"></span><button id="retry" type="button">Try again</button></div>
  <main class="page-stage" id="page-stage" aria-label="Fillable PDF document" aria-busy="true">
    <section class="page-frame" id="page-frame" hidden><canvas id="pdf-page" aria-label="Official PDF page"></canvas><div class="fields" id="fields" role="group" aria-label="Form fields"></div></section>
  </main>
  <footer class="footer"><p id="field-help">Select a blue field to type. Use Tab to move between fields.</p></footer>
  <script type="application/json" id="pdf-config">__FILLOUT_PDF_CONFIG__</script>
  <script>${javascript}</script>
</body>
</html>`;
const output = resolve(root, 'assets/pdf-editor.html');
let previous;
try { previous = await readFile(output, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (previous !== html) await writeFile(output, html);
console.log(`Built self-contained PDF editor (${Math.round(Buffer.byteLength(html) / 1024)} KB).`);
