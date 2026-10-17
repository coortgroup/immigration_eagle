#!/usr/bin/env node
// Exercise the installed Expo JS wrapper against the native TypedArray contract.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { PDFDocument } = require('pdf-lib');
const manifest = require('../data/uscis-print-templates.json');

function load(file, resolve, mutate = source => source) {
  const module = { exports: {} };
  const source = ts.transpileModule(mutate(fs.readFileSync(file, 'utf8')), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: resolve, Uint8Array, ArrayBuffer, console }, { filename: file });
  return module.exports;
}

const expoRoot = path.dirname(require.resolve('expo-crypto/package.json'));
const enums = load(path.join(expoRoot, 'src/Crypto.types.ts'), name => { throw new Error(name); });
let nativeCalls = 0;
const native = {
  // Deliberately omit digestAsync: iOS/Android call the synchronous native bridge.
  digest(algorithm, output, data) {
    nativeCalls++;
    if (!(data instanceof Uint8Array)) throw new TypeError('ExpoCrypto.digest: argument 3 must be a TypedArray, received ArrayBuffer');
    assert.ok(output instanceof Uint8Array);
    assert.equal(algorithm, 'SHA-256');
    output.set(crypto.createHash('sha256').update(data).digest());
  },
};
const expo = load(path.join(expoRoot, 'src/Crypto.ts'), name => {
  if (name === './Crypto.types') return enums;
  if (name === './ExpoCrypto') return native;
  if (name === './aes') return {};
  if (name === 'expo-modules-core') return { UnavailabilityError: Error };
  throw new Error(name);
});
const nativeError = /argument 3 must be a TypedArray/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hex = buffer => Buffer.from(buffer).toString('hex');
function offsetCopy(bytes) {
  const padded = new Uint8Array(bytes.length + 11).fill(0x7f);
  padded.set(bytes, 5);
  return padded.subarray(5, 5 + bytes.length);
}
function oldArgument(source) {
  const previous = source.replace(/(digest\(CryptoDigestAlgorithm\.SHA256,\s*new Uint8Array\(bytes\))\)/, '$1.buffer)');
  assert.notEqual(previous, source, 'Expected the corrected TypedArray digest argument');
  return previous;
}

function freeLoader({ corrupt = false, mutate } = {}) {
  return load('src/freePdfTemplates.ts', name => {
    if (name === 'expo-crypto') return expo;
    if (name.endsWith('uscis-print-templates.json')) return manifest;
    if (name.endsWith('.pdf')) return path.resolve('src', name);
    if (name === './officialPdfDocument') return {
      async loadPrintTemplate(file) {
        const bytes = offsetCopy(fs.readFileSync(file));
        if (corrupt) bytes[0] ^= 1;
        return bytes;
      },
    };
    throw new Error(name);
  }, mutate);
}
const printEngine = mutate => load('src/pdfEngine.ts', name => name === 'expo-crypto' ? expo : require(name), mutate);

(async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  await assert.rejects(expo.digest(enums.CryptoDigestAlgorithm.SHA256, bytes.buffer), nativeError,
    'The installed Expo wrapper forwards raw ArrayBuffer to native argument 3');
  assert.equal(hex(await expo.digest(enums.CryptoDigestAlgorithm.SHA256, bytes)), hash(bytes));
  const sliced = offsetCopy(bytes);
  assert.notEqual(sliced.byteOffset, 0);
  assert.equal(hex(await expo.digest(enums.CryptoDigestAlgorithm.SHA256, sliced)), hash(bytes), 'Hash only the supplied view');

  const free = freeLoader();
  for (const [id, definition] of Object.entries(manifest.templates)) {
    const loaded = await free.loadFreePdfTemplate(id);
    assert.equal(hash(loaded), definition.sha256, `${id}: native digest accepts the real bundled PDF`);
  }
  const beforeUnknown = nativeCalls;
  await assert.rejects(free.loadFreePdfTemplate('UNKNOWN'), /not available/);
  assert.equal(nativeCalls, beforeUnknown, 'An unknown form must fail before hashing');
  await assert.rejects(freeLoader({ corrupt: true }).loadFreePdfTemplate('I-90'), /could not be verified/);

  const definition = { ...manifest.templates['I-90'], fields: [] };
  const original = offsetCopy(fs.readFileSync(path.join('assets/uscis-print', definition.filename)));
  const engine = printEngine();
  const printed = await engine.fillOfficialPrintPdf(original, definition, {});
  const document = await PDFDocument.load(printed);
  assert.equal(document.getPageCount(), definition.pageCount);
  assert.equal(document.getForm().getFields().length, 0);
  const corrupted = new Uint8Array(original); corrupted[0] ^= 1;
  await assert.rejects(engine.fillOfficialPrintPdf(corrupted, definition, {}), error => error.code === 'template');

  // Prove both prior production call sites reproduce the device failure.
  await assert.rejects(freeLoader({ mutate: oldArgument }).loadFreePdfTemplate('I-90'), nativeError);
  await assert.rejects(printEngine(oldArgument).fillOfficialPrintPdf(original, definition, {}), nativeError);
  console.log(`Native PDF crypto passed: installed Expo wrapper, raw ArrayBuffer failure, TypedArray/slice hashes, ${Object.keys(manifest.templates).length} real free templates, corruption/unknown rejection, I-90 print output, and both pre-fix regressions.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
