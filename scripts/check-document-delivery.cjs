const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const moduleRef = { exports: {} };
const compiled = ts.transpileModule(fs.readFileSync('src/documentDelivery.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(compiled, { module: moduleRef, exports: moduleRef.exports, Intl });
const api = moduleRef.exports;
const request = {
  formId: 'I-90',
  pdfReady: true,
  hasRequestHandler: true,
  mailing: { quote: { id: 'test-quote', amountMinor: 2500, currency: 'USD' }, destination: 'agency', requestAvailable: true },
  state: { choice: 'mailing', reviewed: true, signedPacketConfirmed: true, consent: true },
};

assert.match(api.formatMailingQuote(request.mailing.quote), /USD\s25\.00/);
assert.match(api.formatMailingQuote({ ...request.mailing.quote, currency: 'JPY' }), /JPY\s2,500/);
assert.match(api.formatMailingQuote({ ...request.mailing.quote, currency: 'KWD' }), /KWD\s2\.500/);
for (const amountMinor of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  assert.equal(api.formatMailingQuote({ ...request.mailing.quote, amountMinor }), null);
}
assert.equal(api.formatMailingQuote(), null);
assert.equal(api.formatMailingQuote({ ...request.mailing.quote, id: ' ' }), null);
assert.equal(api.formatMailingQuote({ ...request.mailing.quote, currency: 'usd' }), null);
assert.equal(api.getDocumentDeliveryStatus({ ...request, mailing: undefined }).priceLabel, 'Mailing price to be confirmed');

for (const unavailable of [
  { pdfReady: false }, { hasRequestHandler: false }, { busy: true }, { formId: ' ' },
  { mailing: undefined },
  { mailing: { ...request.mailing, quote: undefined } },
  { mailing: { ...request.mailing, destination: undefined } },
  { mailing: { ...request.mailing, destination: 'unconfigured' } },
  { mailing: { ...request.mailing, requestAvailable: false } },
  { state: { ...request.state, choice: 'self' } },
  { state: { ...request.state, reviewed: false } },
  { state: { ...request.state, signedPacketConfirmed: false } },
  { state: { ...request.state, consent: false } },
]) {
  assert.equal(api.createMailingRequest({ ...request, ...unavailable }), null, JSON.stringify(unavailable));
}

const allowed = api.createMailingRequest(request);
assert.equal(allowed.quoteId, 'test-quote');
assert.equal(allowed.destination, 'agency');
assert.equal(allowed.signedPacketConfirmed, true);
assert.equal(allowed.consent, true);
assert.equal(Object.hasOwn(allowed, 'paid'), false, 'Requesting mailing must never grant paid fulfillment');
assert.equal(Object.hasOwn(allowed, 'answers'), false, 'A mailing request must not implicitly include immigration answers');
assert.ok(api.createMailingRequest({
  ...request,
  mailing: { ...request.mailing, destination: 'applicant' },
  state: { ...request.state, signedPacketConfirmed: false },
}), 'A packet sent to the applicant is signed after delivery');
console.log('Document delivery: quote formatting, unconfigured-service gates, signature/review/consent requirements and request payload passed.');
