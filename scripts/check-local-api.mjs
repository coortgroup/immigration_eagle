import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalServer } from '../server/local-server.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'eagle-local-api-'));
const site = path.join(temporary, 'site');
const storage = path.join(temporary, '.local', 'requests.json');
let server;
let port;
let checks = 0;

async function start() {
  server = createLocalServer({ siteDir: site, storageFile: storage });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
}

async function stop() {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function request(url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { /* Static content. */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Test request timed out.')));
    req.end(body);
  });
}

function post(payload, options = {}) {
  return request('/api/requests', {
    method: 'POST', body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}`, ...options.headers },
    ...Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'headers')),
  });
}

function check(condition, message) { assert.ok(condition, message); checks++; }

try {
  await mkdir(path.join(site, 'app'), { recursive: true });
  await writeFile(path.join(site, 'index.html'), '<h1>Local website fixture</h1>');
  await writeFile(path.join(site, 'app', 'index.html'), '<h1>Local app fixture</h1>');
  await writeFile(path.join(temporary, 'private.txt'), 'not public');
  await symlink(path.join(temporary, 'private.txt'), path.join(site, 'leak.txt'));
  await start();

  const status = await request('/api/status');
  assert.deepEqual(status.json, { local: true, contactDelivery: 'local-inbox' }); checks++;
  check(status.headers['access-control-allow-origin'] === undefined, 'No permissive CORS header');
  check((await request('/api/requests')).json.requests.length === 0, 'A new inbox is empty');
  check((await request('/immigration_eagle/')).text.includes('Local website fixture'), 'Built website is served at its project base path');
  check((await request('/immigration_eagle/app/')).text.includes('Local app fixture'), 'Built app is served beneath the website');
  check((await request('/')).headers.location === '/immigration_eagle/', 'Root redirects to the local website');

  const valid = { type: 'contact', name: ' Example Visitor ', email: ' visitor@example.test ', question: ' Help me choose a form. ' };
  const created = await post(valid);
  check(created.status === 201, 'A valid request is saved');
  check(/^[0-9a-f-]{36}$/.test(created.json.id), 'The saved request receives a UUID receipt');
  check(created.json.delivery === 'local-inbox' && created.json.externalNotification === false, 'Receipt confirms local-only delivery');
  check(created.json.name === undefined && created.json.email === undefined, 'Receipt does not repeat personal details');
  const saved = JSON.parse(await readFile(storage, 'utf8'));
  check(saved.requests[0].name === 'Example Visitor' && saved.requests[0].email === 'visitor@example.test', 'Whitespace is normalized before storage');
  check(saved.requests[0].question === 'Help me choose a form.', 'Question is saved accurately');
  if (process.platform !== 'win32') check(((await stat(storage)).mode & 0o777) === 0o600, 'Request storage is readable only by its owner');

  const attorney = { type: 'attorney', formId: 'N-400', name: 'Phone Visitor', phone: '+1 (212) 555-0199', question: 'Please call about attorney assistance.' };
  const beforeConsent = (await request('/api/requests')).json.requests.length;
  for (const consent of [undefined, '', 'yes', 'share-contact-and-question-v0', null, true, { version: 'share-contact-and-question-v1' }]) {
    const rejected = await post({ ...attorney, attorneyConsent: consent });
    check(rejected.status === 422 && !!rejected.json.fields.attorneyConsent, 'Attorney requests require the explicit current consent version');
    check(!rejected.json.id, 'Missing or invalid consent never produces a saved receipt');
  }
  check((await request('/api/requests')).json.requests.length === beforeConsent, 'Rejected consent does not write a request');
  const phoneOnly = await post({ ...attorney, attorneyConsent: 'share-contact-and-question-v1' });
  check(phoneOnly.status === 201, 'Phone-only attorney request with consent is accepted');
  const savedAttorney = (await request('/api/requests')).json.requests.find(record => record.id === phoneOnly.json.id);
  check(savedAttorney.attorneyConsent === 'share-contact-and-question-v1', 'The exact consent version is retained with the attorney request');
  check(savedAttorney.externalNotification === false, 'Consent does not trigger forwarding or an external notification');
  const maximum = await post({ ...valid, name: 'A'.repeat(150), email: 'a'.repeat(242) + '@example.com', phone: '+1 212 555 0100', question: 'Q'.repeat(3000) });
  check(maximum.status === 201, 'Documented maximum field lengths are accepted');
  const htmlPayload = await post({ ...valid, name: '<img src=x onerror=alert(1)>', question: '<script>globalThis.injected=true</script>' });
  check(htmlPayload.status === 201, 'Plain-text content is accepted without treating it as markup');

  for (const [label, payload] of [
    ['missing contact', { ...valid, email: '' }],
    ['malformed email', { ...valid, email: 'invalid', phone: '+1 212 555 0100' }],
    ['malformed phone', { ...valid, phone: 'call me please' }],
    ['blank question', { ...valid, question: '  ' }],
    ['overlong name', { ...valid, name: 'A'.repeat(151) }],
    ['unsupported type', { ...valid, type: 'send-email' }],
    ['unexpected field', { ...valid, delivery: 'email' }],
    ['wrong field type', { ...valid, name: { value: 'Example' } }],
    ['invalid form ID', { ...valid, formId: '../../private' }],
    ['attorney consent on a contact request', { ...valid, attorneyConsent: 'share-contact-and-question-v1' }],
    ['empty attorney consent on a contact request', { ...valid, attorneyConsent: '' }],
  ]) check((await post(payload)).status === 422, `Validation rejects ${label}`);

  check((await post(valid, { body: '{bad-json' })).status === 400, 'Malformed JSON is rejected');
  check((await post(valid, { headers: { 'Content-Type': 'text/plain' } })).status === 415, 'Non-JSON writes are rejected');
  check((await post(valid, { body: 'x'.repeat(17 * 1024) })).status === 413, 'Chunked oversized body is rejected');
  check((await post(valid, { headers: { Origin: 'https://unrelated.example' } })).status === 403, 'Cross-origin writes are rejected');
  check((await post(valid, { headers: { Origin: 'null' } })).status === 403, 'Opaque-origin writes are rejected');
  check((await request('/api/requests', { method: 'POST', body: JSON.stringify(valid), headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' } })).status === 403, 'Cross-site browser writes without Origin are rejected');
  check((await request('/api/requests', { headers: { Host: `attacker.example:${port}` } })).status === 403, 'DNS-rebinding host names are rejected');
  check((await request('/api/requests', { headers: { Origin: 'https://unrelated.example' } })).status === 403, 'Cross-origin inbox reads are rejected');
  check((await request('/api/requests', { method: 'OPTIONS' })).status === 405, 'CORS preflight is not enabled');
  check((await request('/api/requests', { method: 'DELETE' })).status === 405, 'Deleting the inbox through the API is not supported');
  check((await request('/immigration_eagle/leak.txt')).status === 404, 'Static server does not follow a symlink outside the website');
  check((await request('/immigration_eagle/%2e%2e%2fprivate.txt')).status === 404, 'Encoded path traversal is rejected');
  check((await request('/.local/requests.json')).status === 404, 'Request storage is not served as a website file');

  const beforeConcurrent = (await request('/api/requests')).json.requests.length;
  const concurrent = await Promise.all(Array.from({ length: 12 }, (_, index) => post({ ...valid, question: `Concurrent request ${index}` })));
  check(concurrent.every(result => result.status === 201), 'Concurrent requests each receive a successful save receipt');
  let listed = (await request('/api/requests')).json;
  check(listed.requests.length === beforeConcurrent + 12, 'Concurrent writes do not lose requests');
  check(new Set(listed.requests.map(record => record.id)).size === listed.requests.length, 'Every saved request has a unique receipt');
  check(listed.requests.every(record => record.delivery === 'local-inbox' && record.externalNotification === false), 'Every record explicitly remains local-only');

  await stop();
  await start();
  listed = (await request('/api/requests')).json;
  check(listed.requests.some(record => record.id === created.json.id), 'Requests survive server restart');
  const inbox = await request('/local-inbox/');
  check(inbox.status === 200 && inbox.text.includes('No external delivery'), 'The local inbox explains delivery status');
  check(inbox.headers['content-security-policy'].includes("script-src 'self'"), 'Inbox blocks injected inline scripts');
  const inboxScript = await request('/local-inbox/inbox.js');
  check(inboxScript.text.includes('textContent') && !inboxScript.text.includes('innerHTML'), 'Inbox renders request content as text');
  check(!inboxScript.text.includes('https://') && inboxScript.text.includes("fetch('/api/requests'"), 'Inbox uses only the same-origin local API');

  const corrupt = '{broken local data';
  await writeFile(storage, corrupt);
  const failed = await post(valid);
  check(failed.status === 500 && !failed.json.id, 'A storage failure never produces a success receipt');
  check((await readFile(storage, 'utf8')) === corrupt, 'Corrupted data is retained instead of silently overwritten');
  check(!failed.text.includes(temporary) && !failed.text.includes('SyntaxError'), 'Internal paths and error details are not disclosed');
  console.log(`Local API: ${checks} checks passed (validation, explicit attorney consent, origin/host boundaries, local-only delivery, concurrent durable storage, restart, static-file boundaries, and safe inbox rendering).`);
} finally {
  await stop();
  await rm(temporary, { recursive: true, force: true });
}
