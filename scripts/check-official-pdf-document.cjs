const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync('src/officialPdfDocument.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

function load(os) {
  const files = new Map([['file:///template.pdf', Uint8Array.from([1, 2, 3])]]);
  const events = [];
  const blobs = [];
  let shareAvailable = true;
  let sharePending;
  let popupBlocked = false;
  let failWrite = false;
  let nextId = 0;
  class File {
    constructor(...parts) { this.uri = parts.join('/'); }
    get exists() { return files.has(this.uri); }
    create() { files.set(this.uri, new Uint8Array()); }
    write(bytes) { files.set(this.uri, new Uint8Array(bytes)); if (failWrite) throw new Error('Disk write failed'); }
    delete() { events.push(['delete', this.uri]); files.delete(this.uri); }
    async bytes() { return files.get(this.uri); }
  }
  const asset = { uri: '/assets/blank-template.pdf', localUri: os === 'web' ? null : 'file:///template.pdf', async downloadAsync() { events.push(['template-download']); } };
  const moduleRef = { exports: {} };
  vm.runInNewContext(compiled, {
    module: moduleRef, exports: moduleRef.exports, Uint8Array, Blob,
    URL: { createObjectURL(blob) { blobs.push(blob); return `blob:local-${blobs.length}`; }, revokeObjectURL(uri) { events.push(['revoke', uri]); } },
    document: {
      body: { appendChild(link) { events.push(['append', link.href]); } },
      createElement(tag) { assert.equal(tag, 'a'); return { click() { events.push(['download', this.href, this.download]); }, remove() { events.push(['remove-link']); } }; },
    },
    window: { open(url, target) { events.push(['open', url, target]); return popupBlocked ? null : { opener: {}, location: { replace(uri) { events.push(['viewer', uri]); } } }; } },
    fetch: async (uri) => { events.push(['fetch', uri]); return { ok: true, arrayBuffer: async () => Uint8Array.from([4, 5, 6]).buffer }; },
    require(name) {
      if (name === 'react-native') return { Platform: { OS: os } };
      if (name === 'expo-asset') return { Asset: { fromModule(module) { assert.equal(module, 42); return asset; } } };
      if (name === 'expo-crypto') return { randomUUID: () => `random-${++nextId}` };
      if (name === 'expo-file-system') return { File, Paths: { cache: 'file:///private-cache' } };
      if (name === 'expo-print') return { async printAsync(options) { events.push(['print', options]); } };
      if (name === 'expo-sharing') return {
        isAvailableAsync: async () => shareAvailable,
        async shareAsync(uri, options) { events.push(['share', uri, options]); if (sharePending) await sharePending; },
      };
      throw new Error(name);
    },
  });
  return { api: moduleRef.exports, files, events, blobs, setShareAvailable(value) { shareAvailable = value; }, setSharePending(value) { sharePending = value; }, blockPopup() { popupBlocked = true; }, failWrites() { failWrite = true; } };
}

(async () => {
  const web = load('web');
  assert.deepEqual([...await web.api.loadPrintTemplate(42)], [4, 5, 6]);
  assert.deepEqual(web.events[0], ['fetch', '/assets/blank-template.pdf']);
  const bytes = Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 55]);
  const webDocument = await web.api.createPrintableDocument(bytes, 'I-90');
  bytes[0] = 0;
  assert.equal(web.blobs[0].type, 'application/pdf');
  assert.deepEqual([...new Uint8Array(await web.blobs[0].arrayBuffer())], [37, 80, 68, 70, 45, 49, 46, 55]);
  await webDocument.download();
  assert.ok(web.events.some(event => event[0] === 'download' && event[1] === webDocument.uri && event[2] === 'I-90-filled.pdf'));
  await webDocument.print();
  assert.ok(web.events.some(event => event[0] === 'viewer' && event[1] === webDocument.uri));
  web.blockPopup();
  await assert.rejects(webDocument.print(), /Allow a new tab/);
  webDocument.dispose();
  webDocument.dispose();
  assert.equal(web.events.filter(event => event[0] === 'revoke').length, 1);
  await assert.rejects(webDocument.download(), /Generate the PDF again/);
  assert.equal(web.events.filter(event => event[0] === 'fetch').length, 1, 'Only the blank template may be fetched');

  const native = load('ios');
  assert.deepEqual([...await native.api.loadPrintTemplate(42)], [1, 2, 3]);
  const nativeDocument = await native.api.createPrintableDocument(bytes, 'I-90');
  assert.deepEqual([...native.files.get(nativeDocument.uri)], [...bytes]);
  assert.match(nativeDocument.uri, /^file:\/\/\/private-cache\/I-90-filled-random-1\.pdf$/);
  await nativeDocument.print();
  assert.equal(native.events.find(event => event[0] === 'print')[1].uri, nativeDocument.uri);
  await nativeDocument.download();
  const sharing = native.events.find(event => event[0] === 'share');
  assert.equal(sharing[1], nativeDocument.uri);
  assert.equal(sharing[2].mimeType, 'application/pdf');
  assert.equal(sharing[2].UTI, 'com.adobe.pdf');
  assert.equal(sharing[2].dialogTitle, 'Save or share completed form', 'Existing callers keep the English default');
  native.setShareAvailable(false);
  await assert.rejects(nativeDocument.share(), /unavailable/);
  native.setShareAvailable(true);
  let releaseShare;
  native.setSharePending(new Promise(resolve => { releaseShare = resolve; }));
  const pending = nativeDocument.share();
  nativeDocument.dispose();
  assert.ok(native.files.has(nativeDocument.uri), 'Keep the PDF while a system sheet is using it');
  releaseShare();
  await pending;
  assert.equal(native.files.has(nativeDocument.uri), false);
  nativeDocument.dispose();
  await assert.rejects(nativeDocument.print(), /Generate the PDF again/);
  assert.equal(native.files.has('file:///template.pdf'), true, 'Never delete the blank bundled template');
  assert.equal(native.events.some(event => event[0] === 'fetch'), false, 'Never upload filled PDFs');

  const safeName = await native.api.createPrintableDocument(bytes, '../Person Name');
  assert.match(safeName.uri, /\/Form-filled-random-2\.pdf$/);
  safeName.dispose();
  const russianTitle = require('./language-test-helper.cjs').translate('ru', 'Save or share completed form');
  const russianDocument = await native.api.createPrintableDocument(bytes, 'I-90', russianTitle);
  await russianDocument.share();
  assert.equal(native.events.filter(event => event[0] === 'share').at(-1)[2].dialogTitle, 'Сохранить или отправить заполненную форму');
  russianDocument.dispose();
  const worksheet = await native.api.createPrintableDocument(bytes, 'I-765WS');
  assert.match(worksheet.uri, /\/I-765WS-filled-random-4\.pdf$/, 'Two-letter form suffixes must survive export');
  worksheet.dispose();
  const testWeb = await web.api.createPrintableDocument(bytes, 'I-90', 'Save or share test form', { test: true });
  await testWeb.download();
  assert.equal(web.events.filter(event => event[0] === 'download').at(-1)[2], 'TEST-I-90-filled.pdf');
  assert.deepEqual([...new Uint8Array(await web.blobs.at(-1).arrayBuffer())], [...bytes], 'Test web filenames preserve the reviewed bytes');
  testWeb.dispose();
  const testNative = await native.api.createPrintableDocument(bytes, 'I-90', 'Save or share test form', { test: true });
  assert.match(testNative.uri, /\/TEST-I-90-filled-random-5\.pdf$/);
  assert.deepEqual([...native.files.get(testNative.uri)], [...bytes], 'Test native filenames preserve the reviewed bytes');
  testNative.dispose();
  native.failWrites();
  await assert.rejects(native.api.createPrintableDocument(bytes, 'N-400'), /could not be saved/);
  assert.equal(native.files.size, 1, 'Clean up a partial document after a failed write');
  await assert.rejects(native.api.createPrintableDocument(new Uint8Array(), 'I-90'), /empty/);
  console.log('Official PDF document: exact-byte download/print/share, template loading, local-only storage, temporary cleanup and failure handling passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
