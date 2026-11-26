import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LANGUAGES, LANGUAGE_NAMES, DICT, detectLanguage, tr, missingKeys, isLanguage, formatNumber,
} from '../src/i18n.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('12言語そろっていて、どの言語も全キーが空でない', () => {
  assert.equal(LANGUAGES.length, 12);
  assert.deepEqual(LANGUAGES, ['ja', 'en', 'zh-Hans', 'zh-Hant', 'ko', 'es', 'pt', 'fr', 'de', 'it', 'th', 'id']);
  assert.equal(LANGUAGE_NAMES.length, 12);
  for (const language of LANGUAGES) {
    assert.deepEqual(missingKeys(language), [], language);
  }
  /* キーの数が言語間で同じ（余分なキーが無い） */
  const base = Object.keys(DICT.ja).sort();
  for (const language of LANGUAGES) {
    assert.deepEqual(Object.keys(DICT[language]).sort(), base, language);
  }
  assert.ok(base.length >= 150, `キー数: ${base.length}`);
});

test('日本語のiPhoneは必ず日本語で起動する', () => {
  assert.equal(detectLanguage(['ja-JP', 'en-US']), 'ja');
  assert.equal(detectLanguage(['ja']), 'ja');
  assert.equal(detectLanguage(['en-US', 'ja-JP']), 'en');
  assert.equal(detectLanguage(['ja_JP']), 'ja');
});

test('端末言語の優先順と中国語の簡体/繁体の判定', () => {
  assert.equal(detectLanguage(['zh-CN']), 'zh-Hans');
  assert.equal(detectLanguage(['zh-TW']), 'zh-Hant');
  assert.equal(detectLanguage(['zh-HK']), 'zh-Hant');
  assert.equal(detectLanguage(['zh-Hans-CN']), 'zh-Hans');
  assert.equal(detectLanguage(['ko-KR']), 'ko');
  assert.equal(detectLanguage(['pt-BR']), 'pt');
  assert.equal(detectLanguage(['id-ID']), 'id');
  assert.equal(detectLanguage(['in-ID']), 'id');
  assert.equal(detectLanguage(['th-TH']), 'th');
});

test('対応外の言語は英語（日本語にしない）', () => {
  assert.equal(detectLanguage(['vi-VN']), 'en');
  assert.equal(detectLanguage(['ar']), 'en');
  assert.equal(detectLanguage([]), 'en');
  assert.equal(detectLanguage(undefined), 'en');
  assert.equal(detectLanguage(['ja']), 'ja');
});

test('tr はキー欠けを英語→日本語で補い、キー名を画面に出さない', () => {
  assert.equal(tr('ja', 'goal'), 'ゴール！');
  assert.equal(tr('en', 'goal'), 'GOAL!');
  assert.equal(tr('th', 'goal'), 'ประตู!');
  assert.equal(tr('unknown-lang', 'goal'), 'GOAL!');
  assert.equal(isLanguage('ja'), true);
  assert.equal(isLanguage('vi'), false);
  assert.equal(formatNumber(1234, 'ja'), '1,234');
});

test('12言語すべてに、遊び方とプライバシーの本文がある', () => {
  for (const language of LANGUAGES) {
    assert.ok(tr(language, 'rulesText').length > 80, language);
    assert.ok(tr(language, 'privacyText').length > 80, language);
    if (language !== 'ja') assert.notEqual(tr(language, 'rulesText'), tr('ja', 'rulesText'), language);
  }
});

test('辞書の文字列に { } の入れ忘れが無い', () => {
  for (const language of LANGUAGES) {
    for (const [key, value] of Object.entries(DICT[language])) {
      assert.equal(typeof value, 'string', `${language}.${key}`);
      assert.equal(value.includes('{'), false, `${language}.${key} にプレースホルダ`);
      assert.equal(value.includes('undefined'), false, `${language}.${key}`);
    }
  }
});

test('国旗の画像ファイルが実在する（16か国）', async () => {
  const { COUNTRIES } = await import('../src/core/countries.js');
  for (const country of COUNTRIES) {
    assert.ok(existsSync(resolve(ROOT, country.flag)), country.flag);
  }
  const bytes = readFileSync(resolve(ROOT, 'assets/icon-1024.png'));
  assert.equal(bytes.subarray(0, 4).toString('hex'), '89504e47');
});
