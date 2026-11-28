// Plain-TS core of the app's i18n: no React, so it is unit-tested under Node (test/i18n.test.ts).
// The React side (provider, useT, the language switch) lives in src/i18n.tsx.
import { en, type MessageKey } from './en';
import { zhHK } from './zh-HK';

export const LANGS = ['en', 'zh-HK'] as const;
export type Lang = (typeof LANGS)[number];
export type Vars = Record<string, string | number>;

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { en, 'zh-HK': zhHK };

/** Native names, shown the same in both languages so anyone can find their own. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', 'zh-HK': '繁體中文' };

/** Map a BCP 47-ish tag (zh-Hant-HK, zh_TW, en-GB…) to a supported language, or null. */
export function normaliseLang(tag: string | null | undefined): Lang | null {
  if (!tag) return null;
  const base = tag.trim().toLowerCase().split(/[-_]/)[0];
  if (base === 'zh') return 'zh-HK';
  if (base === 'en') return 'en';
  return null;
}

/**
 * Pick the language on start-up: a `?lang=` link (web, used by the screenshot harness) first, then the
 * language the person chose before, then the device language, then English.
 */
export function initialLang(src: { query?: string | null; stored?: string | null; device?: string | null }): Lang {
  return normaliseLang(src.query) ?? normaliseLang(src.stored) ?? normaliseLang(src.device) ?? 'en';
}

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const table = MESSAGES[lang] ?? en;
  const s = table[key] ?? en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Locale for dates and numbers. */
export function dateLocale(lang: Lang): string {
  return lang === 'zh-HK' ? 'zh-HK' : 'en-HK';
}

// The current language, for strings made outside React (API and NFC errors). The provider keeps it in step.
let current: Lang = 'en';
export const getLang = (): Lang => current;
export const setLang = (lang: Lang) => {
  current = lang;
};
export const tNow = (key: MessageKey, vars?: Vars) => translate(current, key, vars);

/** The device language from Intl (Hermes, browsers and Node all have it). */
export function deviceLang(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? null;
  } catch {
    return null;
  }
}

export type { MessageKey };
