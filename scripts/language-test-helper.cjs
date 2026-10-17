const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const moduleRef = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/i18n.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, {
  module: moduleRef, exports: moduleRef.exports,
  require: name => require(path.resolve(__dirname, '../src', name)),
});
const i18n = moduleRef.exports;
function languageMock(language = 'en') {
  return { language, languageError: '', setLanguage() {}, t: (text, params) => i18n.translate(language, text, params) };
}
module.exports = { ...i18n, languageMock, useLanguage: () => languageMock(), LanguageProvider: 'LanguageProvider' };
