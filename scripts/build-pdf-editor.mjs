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
  // Keep syntax compatible with the oldest supported iOS WebView as well as web.
  target: ['es2022', 'safari16.4'],
  supported: { 'template-literal': false },
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
    <div class="toolbar-row">
      <h1 class="sr-only" id="document-title" data-i18n="Your fillable PDF">Your fillable PDF</h1>
      <div class="actions">
        <button class="action" id="save-pdf" type="button" aria-label="Save filled PDF" data-i18n-label="Save filled PDF" disabled><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></svg><span class="action-label" data-i18n="Save filled PDF">Save filled PDF</span><span class="compact-label" aria-hidden="true">PDF</span></button>
        <button class="action secondary" id="print-pdf" type="button" aria-label="Print" data-i18n-label="Print" disabled><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7z"/><path d="M17 11h.01"/></svg><span class="action-label" data-i18n="Print">Print</span></button>
      </div>
      <nav class="page-navigation" aria-label="PDF pages" data-i18n-label="PDF pages">
        <button class="control" id="previous-page" type="button" aria-label="Previous page" data-i18n-label="Previous page" disabled>‹</button>
        <label class="sr-only" for="page-select" data-i18n="Page">Page</label><select class="control" id="page-select" disabled><option>…</option></select>
        <button class="control" id="next-page" type="button" aria-label="Next page" data-i18n-label="Next page" disabled>›</button>
      </nav>
    </div>
    <p class="sr-only" id="status" role="status" aria-live="polite">Opening your fillable PDF…</p>
  </header>
  <div class="notice" id="editor-notice"><div><strong data-i18n="Fill in the blue fields, then save or print your completed form.">Fill in the blue fields, then save or print your completed form.</strong> <span data-i18n="Your progress is saved automatically in Saved drafts on this device.">Your progress is saved automatically in Saved drafts on this device.</span> <span data-i18n="The official PDF and its field descriptions remain in English.">The official PDF and its field descriptions remain in English.</span></div><button class="notice-close" id="dismiss-notice" type="button" aria-label="Close instructions" data-i18n-label="Close instructions"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
  <div class="error" id="error" role="alert" hidden><span id="error-text"></span><button id="retry" type="button" data-i18n="Try again">Try again</button></div>
  <main class="page-stage" id="page-stage" aria-label="Fillable PDF document" data-i18n-label="Fillable PDF document" aria-busy="true">
    <section class="page-frame" id="page-frame" hidden><canvas id="pdf-page" aria-label="Official PDF page" data-i18n-label="Official PDF page"></canvas><div class="fields" id="fields" role="group" aria-label="Form fields" data-i18n-label="Form fields"></div></section>
  </main>
  <p class="sr-only" id="field-help">Select a blue field to type. Use Tab to move between fields.</p>
  <script type="application/json" id="pdf-config">__FILLOUT_PDF_CONFIG__</script>
  <script>${javascript}</script>
</body>
</html>`;
const output = resolve(root, 'assets/pdf-editor.html');
let previous;
try { previous = await readFile(output, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (previous !== html) await writeFile(output, html);
console.log(`Built self-contained PDF editor (${Math.round(Buffer.byteLength(html) / 1024)} KB).`);
