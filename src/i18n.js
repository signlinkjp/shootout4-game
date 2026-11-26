/**
 * SHOOTOUT 4 — 12言語の切り替えと端末言語の判定
 *
 * 日本語のiPhoneでは必ず日本語で起動すること（最優先）。判定は
 * navigator.languages を先頭から見て、対応言語の最初のものを選ぶ。
 * 対応外の言語（例 タイ語端末で……タイ語は対応）は英語で表示する（英語フォールバック）。
 */

import { BASE } from './locales.js';
import { EXTRA } from './locales-extra.js';

export const LANGUAGES = Object.freeze([
  'ja', 'en', 'zh-Hans', 'zh-Hant', 'ko', 'es', 'pt', 'fr', 'de', 'it', 'th', 'id',
]);

export const LANGUAGE_NAMES = Object.freeze([
  '日本語', 'English', '简体中文', '繁體中文', '한국어', 'Español',
  'Português', 'Français', 'Deutsch', 'Italiano', 'ไทย', 'Bahasa Indonesia',
]);

export const LANGUAGE_TAGS = Object.freeze([
  'ja-JP', 'en-US', 'zh-Hans', 'zh-Hant', 'ko-KR', 'es-ES',
  'pt-BR', 'fr-FR', 'de-DE', 'it-IT', 'th-TH', 'id-ID',
]);

export const DICT = Object.freeze({ ...BASE, ...EXTRA });

/** 端末の言語リスト（先頭が最優先）から、対応言語を1つ選ぶ */
export function detectLanguage(languages = []) {
  const list = Array.isArray(languages) ? languages : [languages];
  for (const raw of list) {
    const tag = String(raw || '').toLowerCase().replaceAll('_', '-');
    if (!tag) continue;
    const base = tag.split('-')[0];
    if (base === 'zh') {
      if (/(?:^|-)hans(?:-|$)/.test(tag)) return 'zh-Hans';
      if (/(?:^|-)(hant|tw|hk|mo)(?:-|$)/.test(tag)) return 'zh-Hant';
      return 'zh-Hans';
    }
    if (base === 'in') return 'id';
    if (base === 'pt') return 'pt';
    if (base === 'ja') return 'ja';
    if (LANGUAGES.includes(base)) return base;
  }
  return 'en';
}

export function isLanguage(value) {
  return LANGUAGES.includes(value);
}

/**
 * 辞書を引く。その言語に無いキーは英語、英語にも無ければ日本語、最後はキー名。
 * UI には key をそのまま出さない（翻訳漏れが画面に出ないように）。
 */
export function tr(language, key, vars) {
  const table = DICT[language] || {};
  let text = table[key];
  if (text == null) text = DICT.en[key];
  if (text == null) text = DICT.ja[key];
  if (text == null) return String(key);
  if (vars && typeof text === 'string') {
    return text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] == null ? '' : String(vars[name])));
  }
  return text;
}

/** 全言語のキーがそろっているか（テストが使う） */
export function missingKeys(language) {
  const base = Object.keys(DICT.ja);
  const table = DICT[language] || {};
  return base.filter((key) => typeof table[key] !== 'string' || !table[key].trim());
}

export function languageTag(language) {
  const index = LANGUAGES.indexOf(language);
  return index >= 0 ? LANGUAGE_TAGS[index] : 'en-US';
}

/** 数字の桁区切り（言語ごとのロケールで表示） */
export function formatNumber(value, language) {
  try {
    return new Intl.NumberFormat(languageTag(language)).format(value);
  } catch {
    return String(value);
  }
}
