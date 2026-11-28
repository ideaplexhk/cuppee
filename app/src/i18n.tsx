// App language: English or 繁體中文 (DIRECTION 2026-11-28). Strings live in src/lib/i18n/{en,zh-HK}.ts.
// The choice is saved on the device (key `lang`) and can be switched from the member profile and staff mode.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { store } from './storage';
import { LANG_NAMES, LANGS, dateLocale, deviceLang, initialLang, normaliseLang, setLang as setCurrent, translate, type Lang, type MessageKey, type Vars } from './lib/i18n/core';
import { colors, radius, space, type } from './theme';

const STORE_KEY = 'lang';

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => Promise<void>;
  t: (key: MessageKey, vars?: Vars) => string;
  /** Format a timestamp as a date in the current language. */
  date: (ms: number) => string;
};

const LangContext = createContext<Ctx | null>(null);

function webQueryLang(): string | null {
  if (Platform.OS !== 'web') return null;
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('lang');
  } catch {
    return null;
  }
}

function webStoredLang(): string | null {
  if (Platform.OS !== 'web') return null;
  try {
    return globalThis.localStorage?.getItem(STORE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Web can read storage synchronously, so the first frame is already in the right language.
  const [lang, setLangState] = useState<Lang>(() => {
    const l = initialLang({ query: webQueryLang(), stored: webStoredLang(), device: deviceLang() });
    setCurrent(l);
    return l;
  });

  useEffect(() => {
    if (Platform.OS === 'web') return;
    store
      .get(STORE_KEY)
      .then((saved) => {
        const l = normaliseLang(saved);
        if (l) {
          setCurrent(l);
          setLangState(l);
        }
      })
      .catch(() => {});
  }, []);

  const setLang = useCallback(async (l: Lang) => {
    setCurrent(l);
    setLangState(l);
    await store.set(STORE_KEY, l).catch(() => {});
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
      date: (ms) => new Date(ms).toLocaleDateString(dateLocale(lang)),
    }),
    [lang, setLang],
  );
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useT(): Ctx {
  const c = useContext(LangContext);
  if (!c) throw new Error('useT outside LanguageProvider'); // i18n-ignore: developer error
  return c;
}

/** Two-button switch, each language named in itself. */
export function LanguageSwitch({ style }: { style?: object }) {
  const { lang, setLang, t } = useT();
  return (
    <View style={[styles.row, style]} accessibilityLabel={t('lang.label')}>
      {LANGS.map((l) => {
        const on = l === lang;
        return (
          <Pressable
            key={l}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => setLang(l)}
            style={[styles.pill, on && styles.pillOn]}
          >
            <Text style={[styles.text, on && styles.textOn]}>{LANG_NAMES[l]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignSelf: 'center', backgroundColor: colors.creamDeep, borderRadius: radius.pill, padding: 3, marginVertical: space(2) },
  pill: { paddingVertical: space(2), paddingHorizontal: space(4), borderRadius: radius.pill },
  pillOn: { backgroundColor: colors.green },
  text: { ...type.small, color: colors.green, fontWeight: '700' },
  textOn: { color: colors.white },
});
