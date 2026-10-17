import ui from '../data/locales/ru-ui.json';
import data from '../data/locales/ru-data.json';
import i90 from '../data/locales/ru-i90.json';
import support from '../data/locales/ru-support.json';
import account from '../data/locales/ru-account.json';
import chat from '../data/locales/ru-chat.json';
import guided from '../data/locales/ru-guided.json';
import inbox from '../data/locales/ru-inbox.json';
import review from '../data/locales/ru-form-review.json';
import reviewClient from '../data/locales/ru-form-review-client.json';
import reviewOperator from '../data/locales/ru-form-review-operator.json';
import payments from '../data/locales/ru-payments.json';

export type Language = 'en' | 'ru';
export const LANGUAGE_KEY = 'fillout.language';
export const russian: Record<string, string> = { ...data, ...support, ...i90, ...ui, ...account, ...chat, ...guided, ...inbox, ...review, ...reviewClient, ...reviewOperator, ...payments };
export function isLanguage(value: unknown): value is Language { return value === 'en' || value === 'ru'; }
export function localeFor(language: Language) { return language === 'ru' ? 'ru-RU' : 'en-US'; }
export type TranslationParams = Record<string, string | number>;
const interpolate = (text: string, params: TranslationParams) => text.replace(/\{(\w+)\}/g, (placeholder, name) =>
  Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder);
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = Object.entries(russian).filter(([source]) => /\{\w+\}/.test(source)).map(([source, target]) => {
  const names: string[] = [];
  let cursor = 0;
  let pattern = '^';
  for (const match of source.matchAll(/\{(\w+)\}/g)) {
    pattern += escapeRegex(source.slice(cursor, match.index)) + '([\\s\\S]+?)';
    names.push(match[1]); cursor = match.index! + match[0].length;
  }
  return { regex: new RegExp(pattern + escapeRegex(source.slice(cursor)) + '$'), names, target };
});

/** Translate only product-authored copy. Never pass answers or free-form messages. */
export function translate(language: Language, text: string | undefined | null, params: TranslationParams = {}): string {
  if (!text) return '';
  if (language === 'en') return interpolate(text, params);
  const direct = Object.prototype.hasOwnProperty.call(russian, text) ? russian[text] : undefined;
  if (direct) return interpolate(direct, params);
  // Keep dynamic errors and legacy display strings in the same catalog.
  for (const template of templates) {
    const match = text.match(template.regex);
    if (match) return interpolate(template.target, Object.fromEntries(template.names.map((name, index) => [name, match[index + 1]])));
  }
  return interpolate(text, params);
}

const textKeys = new Set(['title', 'label', 'summary', 'category', 'text', 'help', 'reason', 'stopReason', 'reviewReason',
  'subject', 'scope', 'note', 'unit', 'displayLabel', 'availabilityNote', 'continueTitle', 'continueDescription', 'instruction', 'description']);
/** Localize catalog presentation while preserving identifiers, rules and answer values. */
export function localizeData<T>(value: T, language: Language): T {
  if (language === 'en') return value;
  function visit(item: unknown, key = ''): unknown {
    if (typeof item === 'string') return textKeys.has(key) ? translate(language, item) : item;
    if (Array.isArray(item)) return item.map(entry => visit(entry, key));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([name, entry]) => [name, visit(entry, name)]));
    return item;
  }
  return visit(value) as T;
}
