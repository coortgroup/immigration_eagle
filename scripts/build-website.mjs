import { access, copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'site');
const files = ['index.html', 'styles.css', 'main.js'];
const appExport = path.join(root, 'dist-web');
const appOutput = path.join(output, 'app');

await mkdir(path.join(output, 'assets'), { recursive: true });
for (const file of files) {
  await copyFile(path.join(root, 'web', file), path.join(output, file));
}
await copyFile(path.join(root, 'assets', 'eagle-logo.png'), path.join(output, 'assets', 'eagle-logo.png'));

// Prefer the generated native app icon; keep the transparent logo as a fallback.
let favicon = path.join(root, 'assets', 'app-icon.png');
try { await access(favicon); } catch { favicon = path.join(root, 'assets', 'eagle-logo.png'); }
await copyFile(favicon, path.join(output, 'assets', 'favicon.png'));
await writeFile(path.join(output, '.nojekyll'), '');

const html = await readFile(path.join(output, 'index.html'), 'utf8');
if (!html.includes('href="app/"') || /(?:href|src)="\//.test(html)) {
  throw new Error('Website links must remain relative for GitHub Pages project hosting.');
}

let hasAppExport = false;
try { await access(path.join(appExport, 'index.html')); hasAppExport = true; } catch { /* Landing-only build. */ }
if (hasAppExport) {
  await rm(appOutput, { recursive: true, force: true });
  await cp(appExport, appOutput, { recursive: true });
}
console.log(`Website built in site/ with relative app/ links. ${hasAppExport ? 'Expo export copied into site/app/.' : 'No Expo export found; existing app output preserved.'}`);
