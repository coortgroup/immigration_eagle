#!/usr/bin/env node
// Validate translated UI copy, without treating IDs, machine values or source metadata as prose.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `${name}.json`), 'utf8'));
const dictionary = read('locales/ru-data');
const expected = new Map();
const perFile = new Map();
function take(object, keys, source) {
  for (const key of keys) {
    const value = object?.[key];
    if (typeof value !== 'string') continue;
    expected.set(value, `${source}.${key}`);
    const file = source.split('.')[0];
    if (!perFile.has(file)) perFile.set(file, new Set());
    perFile.get(file).add(value);
  }
}

for (const form of read('forms-catalog').forms) {
  take(form, ['title', 'summary', 'category', 'availabilityNote'], `forms-catalog.${form.id}`);
}
for (const name of ['eligibility-main', 'eligibility-other']) {
  const data = read(name);
  take(data.resultPolicy, ['continueTitle', 'continueDescription'], `${name}.resultPolicy`);
  for (const form of data.forms) {
    take(form, ['scope'], `${name}.${form.id}`);
    for (const question of form.questions) {
      take(question, ['text', 'help', 'stopReason', 'reviewReason', 'reason'], `${name}.${form.id}.${question.id}`);
    }
  }
}
for (const form of read('preparation-fields').forms) {
  take(form, ['subject'], `preparation-fields.${form.id}`);
  for (const field of form.fields) take(field, ['label', 'help'], `preparation-fields.${form.id}.${field.id}`);
}
for (const status of read('form-finder').statuses) {
  take(status, ['label'], `form-finder.${status.id}`);
  for (const goal of status.goals) take(goal, ['label'], `form-finder.${status.id}.${goal.id}`);
}
const attorneys = read('attorney-pricing');
take(attorneys, ['displayLabel'], 'attorney-pricing');
for (const form of attorneys.forms) {
  take(form, ['note'], `attorney-pricing.${form.id}`);
  take(form.benchmark, ['scope'], `attorney-pricing.${form.id}.benchmark`);
}
function pricingNotes(value, source) {
  if (Array.isArray(value)) value.forEach((item, index) => pricingNotes(item, `${source}.${index}`));
  else if (value && typeof value === 'object') {
    take(value, ['note', 'unit'], source);
    Object.entries(value).forEach(([key, item]) => pricingNotes(item, `${source}.${key}`));
  }
}
pricingNotes(read('form-pricing').forms, 'form-pricing');

for (const [english, source] of expected) {
  const russian = dictionary[english];
  assert.equal(typeof russian, 'string', `Missing Russian translation for ${source}: ${english}`);
  assert.ok(russian.trim().length && /\p{Script=Cyrillic}/u.test(russian), `Expected Russian text for ${source}`);
  assert.notEqual(russian, english, `Untranslated text in ${source}`);
  // Form names, eligibility category codes, and interpolation tokens must stay usable.
  for (const token of english.match(/\b(?:AR|G|I|N)-\d+[A-Z]?\b|\(c\)\(\d+\)|\{[^{}]+\}/g) || []) {
    assert.ok(russian.includes(token), `Translation lost ${token} in ${source}`);
  }
}
for (const english of Object.keys(dictionary)) assert.ok(expected.has(english), `Unexpected non-UI or stale key: ${english}`);
assert.equal(Object.keys(dictionary).length, expected.size);
console.log(`Russian data translations: ${expected.size} exact-key entries cover all UI data and preserve form/category codes and placeholders.`);
console.log([...perFile].map(([file, values]) => `${file}: ${values.size}`).join(', '));
