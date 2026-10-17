import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestStore } from './request-store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INBOX = path.join(ROOT, 'server', 'local-inbox');
const MAX_BODY_BYTES = 16 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.ttf': 'font/ttf',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
};

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function checkLocalRequest(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
    throw new HttpError(403, 'This service accepts local requests only.');
  }
  const port = req.socket.localPort;
  const host = req.headers.host?.toLowerCase();
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (port === 80) ['127.0.0.1', 'localhost', '[::1]'].forEach(value => hosts.add(value));
  if (!host || !hosts.has(host)) throw new HttpError(403, 'Unrecognized local host.');
  if (req.headers.origin && req.headers.origin !== `http://${host}`) {
    throw new HttpError(403, 'Cross-origin requests are not allowed.');
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    throw new HttpError(403, 'Cross-site requests are not allowed.');
  }
}

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    req.resume();
    throw new HttpError(415, 'Use application/json.');
  }
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
    req.resume();
    throw new HttpError(415, 'Compressed request bodies are not supported.');
  }
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
    req.resume();
    throw new HttpError(413, 'Request is too large.');
  }
  const body = await new Promise((resolve, reject) => {
    let size = 0;
    let finished = false;
    const chunks = [];
    req.on('data', chunk => {
      if (finished) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finished = true;
        chunks.length = 0;
        reject(new HttpError(413, 'Request is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!finished) { finished = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', () => { if (!finished) { finished = true; reject(new HttpError(400, 'Could not read request.')); } });
    req.on('aborted', () => { if (!finished) { finished = true; reject(new HttpError(400, 'Request was interrupted.')); } });
  });
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { throw new HttpError(400, 'Request body must contain valid JSON.'); }
}

export function validateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(422, 'Request must be a JSON object.');
  }
  const allowed = new Set(['type', 'name', 'email', 'phone', 'question', 'formId', 'attorneyConsent']);
  const errors = {};
  if (Object.keys(input).some(key => !allowed.has(key))) errors.fields = 'The request contains unsupported fields.';
  const value = {};
  for (const field of allowed) {
    if (input[field] === undefined && ['email', 'phone', 'formId', 'attorneyConsent'].includes(field)) value[field] = '';
    else if (typeof input[field] !== 'string') { errors[field] = 'Must be text.'; value[field] = ''; }
    else value[field] = input[field].trim();
  }
  if (!['contact', 'attorney'].includes(value.type)) errors.type = 'Choose contact or attorney.';
  if (!value.name || value.name.length > 150 || /[\u0000-\u001f\u007f]/.test(value.name)) errors.name = 'Enter a name of 1–150 characters.';
  if (!value.email && !value.phone) errors.contact = 'Enter an email address or phone number.';
  if (value.email && (value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))) errors.email = 'Enter a valid email address.';
  const digits = value.phone.replace(/\D/g, '');
  if (value.phone && (value.phone.length > 40 || !/^\+?[\d\s().-]+$/.test(value.phone) || digits.length < 7 || digits.length > 15)) errors.phone = 'Enter a valid phone number.';
  if (!value.question || value.question.length > 3000 || /\u0000/.test(value.question)) errors.question = 'Enter a question of 1–3,000 characters.';
  if (value.formId && !/^[A-Z]{1,3}-\d{1,4}[A-Z]{0,2}$/.test(value.formId)) errors.formId = 'Use a form identifier such as N-400.';
  if (value.type === 'attorney' && value.attorneyConsent !== 'share-contact-and-question-v1') errors.attorneyConsent = 'Confirm permission to share this request with an independent attorney.';
  if (value.type !== 'attorney' && input.attorneyConsent !== undefined) errors.attorneyConsent = 'Consent is only accepted for attorney requests.';
  if (Object.keys(errors).length) throw new HttpError(422, 'Check the request fields.', errors);
  if (!value.attorneyConsent) delete value.attorneyConsent;
  if (!value.formId) delete value.formId;
  return value;
}

async function serveFile(req, res, directory, relative, inbox = false) {
  if (relative.split(/[\\/]/).some(part => part.startsWith('.')) || relative.includes('\0')) {
    throw new HttpError(404, 'Not found.');
  }
  const base = await realpath(directory);
  let filename = path.resolve(base, relative || '.');
  if (filename !== base && !filename.startsWith(`${base}${path.sep}`)) throw new HttpError(404, 'Not found.');
  if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
  filename = await realpath(filename);
  if (!filename.startsWith(`${base}${path.sep}`)) throw new HttpError(404, 'Not found.');
  const body = await readFile(filename);
  const headers = { 'Content-Type': MIME[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': inbox ? 'no-store' : 'no-cache' };
  if (inbox) headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function createLocalServer({ siteDir = path.join(ROOT, 'site'), storageFile = path.join(ROOT, '.local', 'requests.json'), basePath = '/immigration_eagle' } = {}) {
  const base = `/${basePath.replace(/^\/+|\/+$/g, '')}`;
  const store = createRequestStore(storageFile);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      checkLocalRequest(req);
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
      catch { throw new HttpError(400, 'Invalid request URL.'); }

      if (pathname === '/api/status') {
        if (req.method !== 'GET') { json(res, 405, { error: 'Use GET.' }, { Allow: 'GET' }); return; }
        json(res, 200, { local: true, contactDelivery: 'local-inbox' });
      } else if (pathname === '/api/requests') {
        if (req.method === 'GET') {
          json(res, 200, { local: true, externalNotification: false, requests: (await store.list()).slice().reverse() });
        } else if (req.method === 'POST') {
          const record = await store.add(validateRequest(await readJson(req)));
          json(res, 201, { id: record.id, createdAt: record.createdAt, delivery: record.delivery, externalNotification: false });
        } else json(res, 405, { error: 'Use GET or POST.' }, { Allow: 'GET, POST' });
      } else if (pathname.startsWith('/api/')) {
        throw new HttpError(404, 'Unknown API endpoint.');
      } else {
        if (!['GET', 'HEAD'].includes(req.method)) { json(res, 405, { error: 'Use GET or HEAD.' }, { Allow: 'GET, HEAD' }); return; }
        if (pathname === '/' || pathname === base) { res.writeHead(302, { Location: `${base}/` }); res.end(); return; }
        if (pathname === '/local-inbox') { res.writeHead(302, { Location: '/local-inbox/' }); res.end(); return; }
        if (pathname.startsWith('/local-inbox/')) {
          const filename = pathname.slice('/local-inbox/'.length) || 'index.html';
          if (!['index.html', 'inbox.js', 'inbox.css'].includes(filename)) throw new HttpError(404, 'Not found.');
          await serveFile(req, res, INBOX, filename, true);
        } else if (pathname.startsWith(`${base}/`)) {
          await serveFile(req, res, siteDir, pathname.slice(base.length + 1));
        } else throw new HttpError(404, 'Not found.');
      }
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const status = error instanceof HttpError ? error.status : ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500;
      json(res, status, { error: status === 500 ? 'The local inbox is unavailable. A saved request could not be confirmed.' : error instanceof HttpError ? error.message : 'Not found.', ...(error.details ? { fields: error.details } : {}) });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
