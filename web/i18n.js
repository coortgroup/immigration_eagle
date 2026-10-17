import russian from './translations-ru.json';
const interpolate = (text, params) => text.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(params, key) ? String(params[key]) : match);
const templates = Object.entries(russian).filter(([key]) => /\{\w+\}/.test(key));
function translate(language, text, params = {}) {
  if (language !== 'ru') return interpolate(text, params);
  if (Object.hasOwn(russian, text)) return interpolate(russian[text], params);
  for (const [source, target] of templates) {
    const names = [];
    const parts = source.split(/(\{\w+\})/).map(part => {
      if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '(.+?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    const match = text.match(new RegExp('^' + parts.join('') + '$'));
    if (match) return interpolate(target, Object.fromEntries(names.map((name, index) => [name, match[index + 1]])));
  }
  return interpolate(text, params);
}

const STORAGE_KEY = 'fillout.language';
const supported = value => value === 'en' || value === 'ru';
const requested = new URL(window.location.href).searchParams.get('lang');
let saved;
try { saved = window.localStorage.getItem(STORAGE_KEY); } catch { /* Private browsing may disable storage. */ }
export let language = supported(requested) ? requested : supported(saved) ? saved : 'en';
const textSources = new WeakMap();
const attributeSources = new WeakMap();
const attributes = ['aria-label', 'title', 'alt', 'placeholder'];
export const t = (text, params) => translate(language, text, params);

function eligible(node) {
  return !node.parentElement?.closest('script, style, svg, noscript, [data-i18n-ignore]');
}

/** Remember only product copy; finder selections and entered values are untouched. */
export function localizeTree(root = document.documentElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!eligible(node)) continue;
    const source = textSources.get(node) ?? node.textContent;
    textSources.set(node, source);
    const key = source.trim().replace(/\s+/g, ' ');
    if (!key) continue;
    const value = t(key);
    node.textContent = value === key ? source : `${source.match(/^\s*/)[0]}${value}${source.match(/\s*$/)[0]}`;
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (!(element instanceof Element) || element.closest('[data-i18n-ignore]')) continue;
    let sources = attributeSources.get(element);
    if (!sources) { sources = {}; attributeSources.set(element, sources); }
    for (const name of attributes) {
      if (!element.hasAttribute(name)) continue;
      sources[name] ??= element.getAttribute(name);
      element.setAttribute(name, t(sources[name]));
    }
  }
  for (const link of root.querySelectorAll('a[data-policy-link], a[href="privacy/"], a[href="support/"], a[href="terms/"]')) {
    link.dataset.policyLink ??= link.getAttribute('href').split('/')[0];
    link.setAttribute('href', (language === 'ru' ? 'ru/' : '') + link.dataset.policyLink + '/');
  }
  for (const link of root.querySelectorAll('a[href^="app/"]')) {
    const url = new URL(link.href);
    url.searchParams.set('lang', language);
    link.setAttribute('href', `app/${url.search}${url.hash}`);
  }
}

export function setText(element, source) {
  element.textContent = source;
  localizeTree(element);
}

export function cloneLocalized(element) {
  const clone = element.cloneNode(true);
  function copy(source, target) {
    if (textSources.has(source)) textSources.set(target, textSources.get(source));
    if (attributeSources.has(source)) attributeSources.set(target, { ...attributeSources.get(source) });
    source.childNodes.forEach((child, index) => copy(child, target.childNodes[index]));
  }
  copy(element, clone);
  return clone;
}

export function setLanguage(next, updateAddress = true) {
  if (!supported(next)) return;
  language = next;
  try { window.localStorage.setItem(STORAGE_KEY, language); } catch { /* The choice still works for this visit. */ }
  document.documentElement.lang = language;
  localizeTree();
  const meta = document.querySelector('meta[name="description"]');
  if (meta) {
    meta.dataset.sourceDescription ??= meta.content;
    meta.content = t(meta.dataset.sourceDescription);
  }
  document.querySelectorAll('[data-language-label]').forEach(node => { node.textContent = language.toUpperCase(); });
  document.querySelectorAll('[data-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === language)));
  if (updateAddress) {
    const url = new URL(window.location.href);
    url.searchParams.set('lang', language);
    window.history.replaceState(null, '', url);
  }
  window.dispatchEvent(new CustomEvent('fillout-language-change'));
}

document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => {
  setLanguage(button.dataset.language);
  const picker = button.closest('[data-language-picker]');
  if (picker) { picker.open = false; picker.querySelector('summary')?.focus(); }
}));
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  document.querySelectorAll('[data-language-picker][open]').forEach(picker => { picker.open = false; picker.querySelector('summary')?.focus(); });
});
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY && supported(event.newValue)) setLanguage(event.newValue, false);
});
setLanguage(language, false);
