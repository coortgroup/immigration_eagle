import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('site');
const base = (process.env.PAGES_BASE_PATH || '/immigration_eagle').replace(/\/$/, '');
const landing = await readFile(path.join(root, 'index.html'), 'utf8');
const app = await readFile(path.join(root, 'app/index.html'), 'utf8');
const catalog = JSON.parse(await readFile('data/forms-catalog.json', 'utf8')).forms;
const ids = [...landing.matchAll(/data-catalog-form="([^"]+)"/g)].map(match=>match[1]);
assert.equal(ids.length,21);
assert.equal(new Set(ids).size,21);
assert.deepEqual(new Set(ids),new Set(catalog.map(form=>form.id)));
assert.ok(landing.includes('Prepare immigration paperwork correctly,'));
for (const {id} of catalog) assert.ok(landing.includes(`href="app/?form=${id}"`),`Missing direct link for ${id}`);
assert.equal((landing.match(/<dt>Do it yourself<\/dt>/g)||[]).length,21);
assert.equal((landing.match(/<dt>With AI<\/dt>/g)||[]).length,21);
assert.equal((landing.match(/<dt>With an attorney<\/dt>/g)||[]).length,21);

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
for(const [html,folder] of [[landing,''],[app,'app']]) {
  for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) await checkReference(match[1],folder);
}
assert.ok(app.includes(`${base}/app/_expo/static/js/web/`),'Missing production app bundle');
console.log(`Built website: 21 forms, 63 price columns, direct form links and ${files} local asset/page references passed.`);
