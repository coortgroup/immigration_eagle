import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('site');
const base = (process.env.PAGES_BASE_PATH ?? '/immigration_eagle').replace(/\/$/, '');
const landing = await readFile(path.join(root, 'index.html'), 'utf8');
const app = await readFile(path.join(root, 'app/index.html'), 'utf8');
const catalog = JSON.parse(await readFile('data/forms-catalog.json', 'utf8')).forms;
const ids = [...landing.matchAll(/data-catalog-form="([^"]+)"/g)].map(match=>match[1]);
assert.equal(ids.length,21);
assert.equal(new Set(ids).size,21);
assert.deepEqual(new Set(ids),new Set(catalog.map(form=>form.id)));
assert.ok(landing.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').includes('Prepare immigration paperwork, one step at a time.'));
for (const {id} of catalog) if (id !== 'G-639') assert.ok(landing.includes(`href="app/?form=${id}"`),`Missing direct link for ${id}`);
assert.ok(!landing.includes('href="app/?form=G-639"'),'FOIA must direct users to the current USCIS online request path');
assert.ok(landing.includes('Request records at USCIS'));
assert.equal((landing.match(/<dt>Do it yourself<\/dt>/g)||[]).length,21);
assert.equal((landing.match(/<dt>With FillOut<\/dt>/g)||[]).length,21);
assert.equal((landing.match(/<dt>With an attorney<\/dt>/g)||[]).length,0);
assert.ok(!/guaranteed\.|planned guarantee|guarantee-badge|no payment is collected|app preview/i.test(landing),'Remove obsolete purchase and guarantee claims');
const policyPages = [];
for (const language of ['en','ru']) for (const page of ['privacy','support','terms']) {
  const folder = language === 'ru' ? `ru/${page}` : page;
  const html = await readFile(path.join(root,folder,'index.html'),'utf8');
  assert.ok(html.includes(`<html lang="${language}">`));
  assert.equal((html.match(/<h1>/g)||[]).length,1);
  assert.ok(html.includes(`href="https://fillout.net/${folder}/"`),'Policy canonical URL');
  assert.ok(!html.includes('<script'),'Policies must be readable without JavaScript');
  const sectionIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(sectionIds).size,sectionIds.length,'Policy IDs must be unique');
  policyPages.push([html,folder]);
}

let files = 0;
async function checkReference(reference, folder) {
  if (/^(?:https?:|mailto:|#|data:)/.test(reference)) return;
  const clean = reference.split(/[?#]/)[0];
  const absolute = clean.startsWith('/')
    ? (assert.ok(clean.startsWith(base+'/'), `Wrong Pages base: ${clean}`),path.join(root,clean.slice(base.length)))
    : path.resolve(root,folder,clean);
  assert.ok(absolute===root||absolute.startsWith(root+path.sep),'Reference must stay in website output');
  const entry = await stat(absolute);
  if(entry.isDirectory()) await stat(path.join(absolute,'index.html'));
  files++;
}
for(const [html,folder] of [[landing,''],[app,'app'],...policyPages]) {
  for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) await checkReference(match[1],folder);
}
assert.ok(app.includes(`${base}/app/_expo/static/js/web/`),'Missing production app bundle');
console.log(`Built website: 21 forms, 42 preparation columns, 6 static EN/RU policy pages and ${files} local asset/page references passed.`);
