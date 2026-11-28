// Every user-facing string lives in src/lib/i18n/en.ts and zh-HK.ts (CLAUDE.md: both languages, always).
// These tests fail when a key is missing or empty in either language, when the two disagree on placeholders,
// when a screen uses a key that does not exist, or when a screen hard-codes English text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { en } from '../src/lib/i18n/en';
import { zhHK } from '../src/lib/i18n/zh-HK';
import { LANGS, MESSAGES, dateLocale, getLang, initialLang, normaliseLang, setLang, translate, tNow } from '../src/lib/i18n/core';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const APP = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const SOURCES = [...sourceFiles(join(APP, 'app')), ...sourceFiles(join(APP, 'src'))].filter((p) => !p.includes(`${join('src', 'lib', 'i18n')}`));

test('the two supported languages are English and Hong Kong Traditional Chinese', () => {
  assert.deepEqual([...LANGS], ['en', 'zh-HK']);
  assert.equal(MESSAGES.en, en);
  assert.equal(MESSAGES['zh-HK'], zhHK);
});

test('every key exists in both languages', () => {
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zhHK).sort();
  assert.deepEqual(
    enKeys.filter((k) => !zhKeys.includes(k)),
    [],
    'keys missing in zh-HK',
  );
  assert.deepEqual(
    zhKeys.filter((k) => !enKeys.includes(k)),
    [],
    'keys missing in en',
  );
});

test('no translation is empty, and zh-HK is not just a copy of the English', () => {
  for (const lang of LANGS) {
    for (const [k, v] of Object.entries(MESSAGES[lang])) assert.ok(typeof v === 'string' && v.trim() !== '', `${lang}.${k} is empty`);
  }
  // Brand names and symbols may be the same in both; anything with English words should differ.
  const words = (s: string) => /[a-z]{3,}/.test(s.replace(/\{\w+\}/g, ''));
  const same = Object.keys(en).filter((k) => words(en[k as keyof typeof en]) && en[k as keyof typeof en] === zhHK[k as keyof typeof en]);
  assert.deepEqual(same, [], 'zh-HK strings that are still English');
});

test('both languages use the same placeholders for each key', () => {
  for (const k of Object.keys(en) as (keyof typeof en)[]) {
    assert.deepEqual(placeholders(zhHK[k]), placeholders(en[k]), `placeholders differ for ${k}`);
  }
});

test('translate fills placeholders and falls back to English for an unknown language', () => {
  assert.equal(translate('en', 'card.greetingNamed', { name: 'Mei' }), 'Hi, Mei');
  assert.equal(translate('zh-HK', 'card.greetingNamed', { name: 'Mei' }), '你好，Mei');
  assert.equal(translate('xx' as never, 'tabs.card'), en['tabs.card']);
  // A missing variable is left visible rather than printing "undefined".
  assert.equal(translate('en', 'card.greetingNamed'), 'Hi, {name}');
});

test('normaliseLang maps any Chinese tag to zh-HK, English tags to en, and rejects the rest', () => {
  assert.equal(normaliseLang('zh-HK'), 'zh-HK');
  assert.equal(normaliseLang('zh-Hant-HK'), 'zh-HK');
  assert.equal(normaliseLang('zh_TW'), 'zh-HK');
  assert.equal(normaliseLang('ZH'), 'zh-HK');
  assert.equal(normaliseLang('en-GB'), 'en');
  assert.equal(normaliseLang('en'), 'en');
  assert.equal(normaliseLang('fr-FR'), null);
  assert.equal(normaliseLang(''), null);
  assert.equal(normaliseLang(null), null);
  assert.equal(normaliseLang(undefined), null);
});

test('initialLang: a ?lang= link wins, then the saved choice, then the device language, then English', () => {
  assert.equal(initialLang({ query: 'zh-HK', stored: 'en', device: 'en-US' }), 'zh-HK');
  assert.equal(initialLang({ query: 'nonsense', stored: 'zh-HK', device: 'en-US' }), 'zh-HK');
  assert.equal(initialLang({ stored: 'en', device: 'zh-Hant-HK' }), 'en');
  assert.equal(initialLang({ device: 'zh-Hant-HK' }), 'zh-HK');
  assert.equal(initialLang({ device: 'ja-JP' }), 'en');
  assert.equal(initialLang({}), 'en');
});

test('tNow follows the current language for strings built outside React (e.g. API errors)', () => {
  const before = getLang();
  try {
    setLang('zh-HK');
    assert.equal(tNow('error.offline'), zhHK['error.offline']);
    setLang('en');
    assert.equal(tNow('error.offline'), en['error.offline']);
  } finally {
    setLang(before);
  }
});

test('dates use the matching locale', () => {
  assert.equal(dateLocale('en'), 'en-HK');
  assert.equal(dateLocale('zh-HK'), 'zh-HK');
});

test('every key a screen uses exists', () => {
  const missing: string[] = [];
  for (const file of SOURCES) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt(?:Now)?\(\s*'([\w.]+)'/g)) if (!(m[1] in en)) missing.push(`${relative(APP, file)}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

// The brand name is the same in every language.
const BRAND = ['CUPPEE'];

test('no English text is hard-coded in screens or components', () => {
  const found: string[] = [];
  for (const file of SOURCES) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Comments, imports and lines marked `i18n-ignore` (developer-only messages) are skipped.
      if (/^\s*(\/\/|\*|\/\*)/.test(line) || /^\s*import\b/.test(line) || line.includes('i18n-ignore')) return;
      const hits = [
        // <Text>Some words</Text>: text between tags
        ...[...line.matchAll(/(?<![=-])>([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</g)].map((m) => m[1]),
        // title="Words", placeholder="Words", alertMessage etc.
        ...[...line.matchAll(/\b(?:title|placeholder|label|accessibilityLabel)=["']([^"']*[A-Za-z]{2,}[^"']*)["']/g)].map((m) => m[1]),
        // title: 'Words' inside options objects
        ...[...line.matchAll(/\btitle:\s*'([^']*[A-Za-z]{2,}[^']*)'/g)].map((m) => m[1]),
        // `template ${with} words` rendered as text
        ...[...line.matchAll(/`([^`]*[A-Za-z]{3,} [A-Za-z]{2,}[^`]*)`/g)].map((m) => m[1]).filter((s) => !/^\/|https?:|^\$\{[^}]+\}$/.test(s)),
        // 'Two words' or "two words" in plain quotes (messages built in code, alerts, errors)
        ...[...line.matchAll(/(['"])([A-Za-z][^'"]*\s[^'"]*[A-Za-z][^'"]*)\1/g)].map((m) => m[2]),
      ];
      for (const h of hits) if (h.trim() && !BRAND.includes(h.trim())) found.push(`${relative(APP, file)}:${i + 1}: ${h.trim()}`);
    });
  }
  assert.deepEqual(found, []);
});
