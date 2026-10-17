import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isLanguage, LANGUAGE_KEY, translate, type Language, type TranslationParams } from './i18n';

type LanguageValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string | undefined | null, params?: TranslationParams) => string;
  languageError: string;
};
const LanguageContext = createContext<LanguageValue>({ language: 'en', setLanguage: () => {}, t: (text, params) => translate('en', text, params), languageError: '' });

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, updateLanguage] = useState<Language>('en');
  const [languageError, setLanguageError] = useState('');
  const selection = useRef(0);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const setLanguage = useCallback((next: Language) => {
    if (!isLanguage(next)) return;
    const current = ++selection.current;
    updateLanguage(next); setLanguageError('');
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('lang', next);
      window.history.replaceState(null, '', url.toString());
    }
    writes.current = writes.current.catch(() => undefined).then(() => AsyncStorage.setItem(LANGUAGE_KEY, next)).catch(() => {
      if (selection.current === current) setLanguageError('The language changed, but could not be saved on this device. Please try again.');
    });
  }, []);
  useEffect(() => {
    let active = true;
    const query = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('lang') : null;
    if (isLanguage(query)) { setLanguage(query); return; }
    const current = selection.current;
    void AsyncStorage.getItem(LANGUAGE_KEY).then(saved => {
      if (active && selection.current === current && isLanguage(saved)) updateLanguage(saved);
    }).catch(() => {});
    return () => { active = false; };
  }, [setLanguage]);
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.lang = language;
  }, [language]);
  const t = useCallback((text: string | undefined | null, params?: TranslationParams) => translate(language, text, params), [language]);
  const value = useMemo(() => ({ language, setLanguage, t, languageError }), [language, setLanguage, t, languageError]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useLanguage() { return useContext(LanguageContext); }
