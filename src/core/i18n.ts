// Two languages, English and Turkish. Text is written in place as t('English', 'Türkçe'), so each
// string sits next to its translation. Anything rendered re-renders when the language changes,
// because the app root subscribes to it.

export type Lang = 'en' | 'tr';

export const LANGS: Array<{ value: Lang; label: string; title: string }> = [
  { value: 'en', label: 'EN', title: 'English' },
  { value: 'tr', label: 'TR', title: 'Türkçe' },
];

const KEY = 'traffic.lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'tr') return saved;
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('tr')) return 'tr';
  } catch {
    // No storage (tests, private windows): English.
  }
  return 'en';
}

let lang: Lang = typeof window === 'undefined' ? 'en' : initial();
if (typeof document !== 'undefined') document.documentElement.lang = lang;
const listeners = new Set<() => void>();

export const getLang = () => lang;

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Not remembered, but still switched.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach((f) => f());
}

export function subscribeLang(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** The text in the current language. */
export const t = (en: string, tr: string) => (lang === 'tr' ? tr : en);
