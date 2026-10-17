#!/usr/bin/env node
// Runs the installed PDF.js renderer/worker in isolated JS realms. No browser,
// network, physical device or customer information is used by this regression.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const esbuild = require('esbuild');
const templates = require('../data/uscis-print-templates.json').templates;

function realm() {
  const context = vm.createContext({
    console, TextDecoder, TextEncoder, ReadableStream, Response, DOMException,
    NativeURL: URL, DOMMatrix: class {}, setTimeout, clearTimeout, structuredClone,
    Blob, AbortController, NativeAbortSignal: AbortSignal, atob, btoa,
  });
  // Local subclasses let feature removal leave this test process untouched.
  vm.runInContext('globalThis.URL = class extends NativeURL {}; globalThis.AbortSignal = class extends NativeAbortSignal {};', context);
  return context;
}
const removeModernApis = `
  delete Promise.withResolvers;
  delete Promise.try;
  delete ArrayBuffer.prototype.transferToFixedLength;
  delete ArrayBuffer.prototype.transfer;
  delete Math.sumPrecise;
  for (const key of ['difference','intersection','union','symmetricDifference','isDisjointFrom','isSubsetOf','isSupersetOf']) delete Set.prototype[key];
  for (const key of ['getOrInsert','getOrInsertComputed']) delete Map.prototype[key];
  delete Uint8Array.fromBase64;
  for (const key of ['setFromBase64','setFromHex','toBase64','toHex']) delete Uint8Array.prototype[key];
  const iteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
  for (const key of ['drop','every','filter','find','flatMap','forEach','map','some','take','toArray']) delete iteratorPrototype[key];
  delete globalThis.Iterator;
  Object.defineProperty(URL, 'parse', {value: undefined, configurable: true, writable: true});
  Object.defineProperty(AbortSignal, 'any', {value: undefined, configurable: true, writable: true});
`;
async function bundle(options) {
  return (await esbuild.build({ bundle: true, format: 'iife', platform: 'browser', target: ['es2022', 'safari16.4'], write: false, ...options })).outputFiles[0].text;
}
(async () => {
  const compatibility = await bundle({ entryPoints: ['src/pdf-editor/compatibility.ts'] });
  const renderer = await bundle({ stdin: { resolveDir: process.cwd(), contents: `
    import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
    import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
    globalThis.pdfjsWorker = { WorkerMessageHandler };
    globalThis.openTestPdf = async function(bytes) {
      const task = pdfjs.getDocument({data: new Uint8Array(bytes), useSystemFonts: true, useWasm: false, verbosity: 0});
      const document = await task.promise;
      try {
        const page = await document.getPage(1);
        const operators = await page.getOperatorList();
        const text = await page.getTextContent();
        return { pages: document.numPages, operations: Array.from(operators.fnArray), text: text.items.map(item => item.str || '').join('\\n') };
      } finally { await task.destroy(); }
    };
  ` } });

  // Preserve correct modern implementations; fill the gaps only when absent.
  const native = realm();
  vm.runInContext('globalThis.nativeResolvers = Promise.withResolvers; globalThis.nativeTransfer = ArrayBuffer.prototype.transferToFixedLength;', native);
  vm.runInContext(compatibility, native);
  assert.equal(vm.runInContext('Promise.withResolvers === nativeResolvers && ArrayBuffer.prototype.transferToFixedLength === nativeTransfer', native), true);

  const older = realm();
  vm.runInContext(removeModernApis, older);
  vm.runInContext(compatibility, older);
  const semantics = await vm.runInContext(`(async () => {
    const success = Promise.withResolvers(); success.resolve(42);
    const failure = Promise.withResolvers(); failure.reject('expected');
    const rejected = await failure.promise.catch(reason => reason);
    class Child extends Promise {}
    const child = Promise.withResolvers.call(Child); child.resolve('child');
    const source = new Uint8Array([7, 8, 9]).buffer;
    const copy = source.transferToFixedLength(5);
    const truncated = copy.transferToFixedLength(2);
    let invalid = false, detached = false, shared = false;
    try { truncated.transferToFixedLength(-1); } catch { invalid = true; }
    try { source.transferToFixedLength(); } catch { detached = true; }
    try { ArrayBuffer.prototype.transferToFixedLength.call(new SharedArrayBuffer(1)); } catch { shared = true; }
    return JSON.stringify({resolved:await success.promise,rejected,child:child.promise instanceof Child,
      bytes:[...new Uint8Array(truncated)],sourceDetached:source.byteLength===0,copyDetached:copy.byteLength===0,invalid,detached,shared,
      enumerable:Object.prototype.propertyIsEnumerable.call(Promise,'withResolvers')});
  })()`, older);
  assert.deepEqual(JSON.parse(semantics), { resolved:42, rejected:'expected', child:true, bytes:[7,8], sourceDetached:true, copyDetached:true, invalid:true, detached:true, shared:true, enumerable:false });

  // Reproduce both original failures against the actual installed PDF.js code.
  const brokenPromise = realm();
  vm.runInContext('delete Promise.withResolvers;', brokenPromise);
  vm.runInContext(renderer, brokenPromise);
  const i90 = [...fs.readFileSync('assets/uscis-print/i-90.pdf')];
  await assert.rejects(() => brokenPromise.openTestPdf(i90), /withResolvers/);
  const brokenFont = realm();
  vm.runInContext('delete ArrayBuffer.prototype.transferToFixedLength;', brokenFont);
  vm.runInContext(renderer, brokenFont);
  vm.runInContext(renderer, native);
  const baseline = await native.openTestPdf(i90);
  const incomplete = await brokenFont.openTestPdf(i90);
  assert.ok(incomplete.operations.length < baseline.operations.length / 2,
    'Missing font transfer can report ready while silently dropping printed text');

  vm.runInContext(renderer, older);
  for (const [id, definition] of Object.entries(templates)) {
    const bytes = [...fs.readFileSync(`assets/uscis-print/${definition.filename}`)];
    const expected = id === 'I-90' ? baseline : await native.openTestPdf(bytes);
    const actual = await older.openTestPdf(bytes);
    assert.equal(actual.pages, definition.pageCount, `${id}: complete document`);
    assert.deepEqual(Array.from(actual.operations), Array.from(expected.operations), `${id}: every drawing/text operation survives`);
    assert.equal(actual.text, expected.text, `${id}: extracted official text is unchanged`);
  }
  const firstImport = fs.readFileSync('src/pdf-editor/editor.ts','utf8').match(/^import\s+[^\n]+/m)?.[0];
  assert.match(firstImport, /['"]\.\/compatibility['"]/, 'Compatibility must execute before either PDF.js import');
  console.log(`PDF editor compatibility passed: original missing Promise/font-transfer failures reproduced; all ${Object.keys(templates).length} real templates retain modern drawing operations and text after removing newer APIs. Not a physical iOS-device test.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
