import { access, copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildPolicyPages } from '../web/policy-pages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'site');
const files = ['styles.css'];
const appExport = path.join(root, 'dist-web');
const appOutput = path.join(output, 'app');
try { await access(path.join(appExport, 'index.html')); }
catch { throw new Error('A complete Expo web export is required. Run npm run build:web first.'); }
const readData = async name => JSON.parse(await readFile(path.join(root, 'data', name), 'utf8'));
const [catalog, finder] = await Promise.all([readData('forms-catalog.json'), readData('form-finder.json')]);
const mainIds = ['N-400', 'I-90', 'I-130', 'I-485', 'I-765', 'I-751', 'I-129F', 'I-864'];
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const formsById = new Map(catalog.forms.map(form => [form.id, form]));
function aiPrice(id) {
  if (['AR-11', 'G-1145'].includes(id)) return { price: 'Free', note: '' };
  if (id === 'G-639') return { price: 'Not offered', note: 'FOIA requests generally must be submitted online' };
  if (['I-765WS', 'I-821', 'I-821D'].includes(id)) return { price: 'Review first', note: 'Paid preparation is not offered' };
  if (id === 'I-130A') return { price: 'Included', note: 'With a qualifying I-130 or I-485 application' };
  if (id === 'I-864A') return { price: 'In-app price', note: 'Separate add-on to I-864' };
  return { price: 'In-app price', note: 'One payment per application' };
}

const formLabels = {
  'AR-11': 'Change of address', 'G-1145': 'Receipt notifications', 'G-639': 'Immigration records',
  'I-90': 'Renew or replace a green card', 'I-129F': 'Fiancé(e) petition', 'I-130': 'Family petition',
  'I-130A': 'Spouse information', 'I-131': 'Travel document', 'I-131A': 'Carrier documentation',
  'I-134': 'Financial support', 'I-485': 'Adjustment of status', 'I-751': 'Remove green card conditions',
  'I-765': 'Work permit', 'I-765WS': 'Work permit worksheet', 'I-821': 'Temporary Protected Status',
  'I-821D': 'DACA', 'I-864': 'Affidavit of support', 'I-864A': 'Household member support',
  'N-400': 'U.S. citizenship', 'N-565': 'Replace a citizenship document', 'N-600': 'Certificate of citizenship',
};

function formCard(form) {
  const ai = aiPrice(form.id);
  const recordsRequest = form.id === 'G-639';
  const action = recordsRequest
    ? `<a class="form-start" href="${escapeHtml(form.officialUrl)}" target="_blank" rel="noopener noreferrer">Request records at USCIS <span aria-hidden="true">↗</span></a>`
    : `<a class="form-start" href="app/?form=${encodeURIComponent(form.id)}" aria-label="Start filling out form ${escapeHtml(form.id)}">Start filling out form <span aria-hidden="true">→</span></a>`;
  const priceColumn = (label, price, note = '') => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(price)}</dd>${note ? `<dd class="price-note">${escapeHtml(note)}</dd>` : ''}</div>`;
  return `<article class="catalog-card" data-catalog-form="${escapeHtml(form.id)}">
  <div class="form-heading"><span class="catalog-form-code">${escapeHtml(form.id)}</span><div><h3>${escapeHtml(formLabels[form.id] || form.title)}</h3><p>${escapeHtml(form.summary)}</p></div></div>
  <dl class="price-grid" aria-label="Preparation prices for ${escapeHtml(form.id)}">${priceColumn('Do it yourself', recordsRequest ? 'USCIS online' : 'Free')}${priceColumn('With FillOut', ai.price, ai.note)}</dl>
  <div class="form-card-footer">${action}<a class="official-link" href="${escapeHtml(form.officialUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Official USCIS information for ${escapeHtml(form.id)}, opens a new tab">USCIS <span aria-hidden="true">↗</span></a></div>
</article>`;
}

for (const id of mainIds) if (!formsById.has(id)) throw new Error(`Missing main form ${id}`);
for (const status of finder.statuses) {
  for (const goal of status.goals) {
    for (const id of goal.forms) if (!formsById.has(id)) throw new Error(`Unknown finder form ${id}`);
  }
}
const otherForms = catalog.forms.filter(form => !mainIds.includes(form.id));
if (mainIds.length !== 8 || otherForms.length !== 13) throw new Error('Expected 8 main forms and 13 other forms.');
const template = await readFile(path.join(root, 'web', 'index.html'), 'utf8');
const html = template
  .replace('<!-- MAIN_FORM_CARDS -->', mainIds.map(id => formCard(formsById.get(id))).join('\n'))
  .replace('<!-- OTHER_FORM_CARDS -->', otherForms.map(formCard).join('\n'))
  .replace('<!-- FINDER_STATUS_OPTIONS -->', finder.statuses.map(status => `<option value="${escapeHtml(status.id)}">${escapeHtml(status.label)}</option>`).join(''))
  .replace('<!-- FINDER_DATA -->', JSON.stringify({ statuses: finder.statuses }).replace(/</g, '\\u003c'));

await mkdir(path.join(output, 'assets'), { recursive: true });
await writeFile(path.join(output, 'index.html'), html);
for (const file of files) {
  await copyFile(path.join(root, 'web', file), path.join(output, file));
}
await build({ entryPoints: [path.join(root, 'web', 'main.js')], outfile: path.join(output, 'main.js'), bundle: true, minify: true, format: 'iife', platform: 'browser', target: ['es2020'] });
for (const name of ['eagle-logo.png', 'fillout-wordmark.png', 'fillout-logo-v2.png', 'fillout-hero-bg.jpg']) {
  await copyFile(path.join(root, 'assets', name), path.join(output, 'assets', name));
}

// Use the small browser icon instead of loading the full-size native app tile.
let favicon = path.join(root, 'assets', 'eagle-logo.png');
for (const name of ['favicon.png', 'app-icon.png']) {
  const candidate = path.join(root, 'assets', name);
  try { await access(candidate); favicon = candidate; break; } catch { /* Try the next size. */ }
}
await copyFile(favicon, path.join(output, 'assets', 'favicon.png'));
await writeFile(path.join(output, '.nojekyll'), '');
await buildPolicyPages(output);

if (!html.includes('href="app/"') || /(?:href|src)="\//.test(html)) {
  throw new Error('Website links must remain relative for GitHub Pages project hosting.');
}

await rm(appOutput, { recursive: true, force: true });
await cp(appExport, appOutput, { recursive: true });
console.log('Website built in site/ with the complete Expo app and relative app/ links.');
