import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHIRTS, SHORTS, SOCKS, BOOTS, CHARACTERS, CHARACTER_STYLES, PARTS,
  DEFAULT_SKIN, PRO_SKIN, getShirt, getShorts, getSocks, getBoot, getPart, partList,
  isPartUnlocked, isCharacterUnlocked, normalizeSkin, readSkin, saveSkin,
  shirtSpec, shortsSpec, socksSpec, bootSpec, opponentKit, effectiveSkin,
} from '../src/core/skins.js';
import {
  COUNTRIES, FREE_COUNTRIES, PRO_COUNTRIES, COUNTRY_CODES, getCountry, countryName,
  pickOpponent, countryKit, isCountryUnlocked,
} from '../src/core/countries.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('4部位そろっていて、PRO 枠も十分な数がある', () => {
  assert.deepEqual([...PARTS], ['shirt', 'shorts', 'socks', 'boots']);
  assert.ok(SHIRTS.length >= 16, `shirts: ${SHIRTS.length}`);
  assert.ok(SHORTS.length >= 10, `shorts: ${SHORTS.length}`);
  assert.ok(SOCKS.length >= 10, `socks: ${SOCKS.length}`);
  assert.ok(BOOTS.length >= 10, `boots: ${BOOTS.length}`);
  for (const list of [SHIRTS, SHORTS, SOCKS, BOOTS]) {
    const ids = list.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, 'id は一意');
    assert.ok(list.filter((item) => !item.pro).length >= 2, '無料枠は各部位2種以上');
  }
  assert.deepEqual([...CHARACTER_STYLES], ['voxel', 'stylized']);
  assert.equal(CHARACTERS.find((item) => item.id === 'voxel').pro, false);
  assert.equal(CHARACTERS.find((item) => item.id === 'stylized').pro, true);
});

test('能力差ゼロ: どの部位・キャラクターにも「強さ」の値が無い', () => {
  const forbidden = ['power', 'accuracy', 'speedBonus', 'rating', 'bonus', 'boost', 'winRate', 'ability'];
  for (const item of [...SHIRTS, ...SHORTS, ...SOCKS, ...BOOTS, ...CHARACTERS]) {
    for (const key of forbidden) assert.equal(key in item, false, `${item.id} に ${key}`);
  }
});

test('無料とPROの線引き: ホーム/アウェイの2セットは無料で遊べる', () => {
  for (const part of PARTS) {
    const list = partList(part);
    const free = list.filter((item) => !item.pro);
    assert.equal(free.length, 2, `${part} の無料枠`);
    assert.deepEqual(free.map((item) => item.set).sort(), ['away', 'home'], `${part} のセット`);
    assert.equal(isPartUnlocked(part, free[0].id, false), true);
    assert.equal(isPartUnlocked(part, list.find((item) => item.pro).id, false), false);
    assert.equal(isPartUnlocked(part, list.find((item) => item.pro).id, true), true);
  }
  assert.equal(isCharacterUnlocked('voxel', false), true);
  assert.equal(isCharacterUnlocked('stylized', false), false);
  assert.equal(isCharacterUnlocked('stylized', true), true);
});

test('保存: 未加入のPRO部位・キャラクターは保存できない', () => {
  const storage = fakeStorage();
  assert.deepEqual(readSkin(storage), DEFAULT_SKIN);
  assert.throws(() => saveSkin(storage, false, { ...DEFAULT_SKIN, shirt: 'royal-stripe' }), /PRO required/);
  assert.throws(() => saveSkin(storage, false, { ...DEFAULT_SKIN, character: 'stylized' }), /PRO required/);
  const saved = saveSkin(storage, true, PRO_SKIN);
  assert.deepEqual(saved, PRO_SKIN);
  assert.deepEqual(readSkin(storage), saved);
  /* PRO を失ったらブロック型で表示する */
  assert.equal(effectiveSkin(saved, false).character, 'voxel');
  assert.equal(effectiveSkin(saved, true).character, 'stylized');
});

test('旧バージョン（kit/boot の2部位）の保存値を4部位へ移行する', () => {
  const storage = fakeStorage();
  storage.setItem('shootout4.skin.v1', JSON.stringify({ kit: 'sash-gold', boot: 'speed-gold' }));
  const migrated = readSkin(storage);
  assert.equal(migrated.shirt, 'sash-gold');
  assert.equal(migrated.boots, 'speed-gold');
  assert.equal(partList('shorts').some((item) => item.id === migrated.shorts), true);
  /* 壊れた値は既定へ */
  storage.setItem('shootout4.skin.v2', '{oops');
  assert.deepEqual(readSkin(storage), DEFAULT_SKIN);
  assert.deepEqual(normalizeSkin({ shirt: 'nope', shorts: 'nope', socks: 'nope', boots: 'nope' }), DEFAULT_SKIN);
});

test('3D用の仕様はプレーンな色データ（4部位ぶん）', () => {
  const shirt = shirtSpec('sash-gold');
  assert.equal(shirt.design, 'sash');
  assert.match(shirt.primary, /^#[0-9a-f]{6}$/i);
  assert.doesNotMatch(shirt.primary, /\s/);
  assert.match(shortsSpec('red-shorts').color, /^#[0-9a-f]{6}$/i);
  assert.match(socksSpec('gold-socks').band, /^#[0-9a-f]{6}$/i);
  assert.equal(bootSpec('high-white').shape, 'high');
  assert.equal(getShirt('nothing').id, SHIRTS[0].id);
  assert.equal(getShorts('nothing').id, SHORTS[0].id);
  assert.equal(getSocks('nothing').id, SOCKS[0].id);
  assert.equal(getBoot('nothing').id, BOOTS[0].id);
  assert.equal(getPart('boots', 'speed-gold').id, 'speed-gold');
  assert.equal(getPart('unknown', 'x'), null);
});

test('相手のキットは国の色から作る（PROの見た目は使わない）', () => {
  const kit = opponentKit(countryKit('BR'));
  assert.equal(kit.design, 'solid');
  assert.equal(kit.primary, '#f7d117');
});

const PRO_COUNTRY_CODES = new Set(PRO_COUNTRIES.map((country) => country.code));

test('32か国（無料16 + PRO16）・コードは一意・国旗と歓声がある', () => {
  assert.equal(COUNTRIES.length, 32);
  assert.equal(FREE_COUNTRIES.length, 16);
  assert.equal(PRO_COUNTRIES.length, 16);
  assert.equal(new Set(COUNTRY_CODES).size, 32);
  for (const country of COUNTRIES) {
    assert.match(country.code, /^[A-Z]{2}$/);
    assert.match(country.flag, /^assets\/flags\/[a-z]{2}-96\.png$/);
    assert.ok(country.name.ja && country.name.en, country.code);
    assert.ok(Array.isArray(country.crowd.chant) && country.crowd.chant.length >= 3);
    assert.match(country.kit.primary, /^#[0-9a-f]{6}$/i);
    assert.equal(Boolean(country.pro), PRO_COUNTRY_CODES.has(country.code), country.code);
  }
  /* 指定の16か国が PRO 枠に入っている */
  for (const code of ['UY', 'BE', 'CO', 'SN', 'CH', 'DK', 'PL', 'AU', 'SE', 'EG', 'GH', 'CM', 'EC', 'CA', 'TR', 'AT']) {
    assert.equal(PRO_COUNTRY_CODES.has(code), true, code);
  }
});

test('国名は日本語/英語、ほかの言語は英語フォールバック', () => {
  assert.equal(countryName('JP', 'ja'), '日本');
  assert.equal(countryName('JP', 'en'), 'Japan');
  assert.equal(countryName('BR', 'fr'), 'Brazil');
  assert.equal(countryName('UY', 'ja'), 'ウルグアイ');
  assert.equal(getCountry('zz').code, 'JP');
});

test('国のロック: PRO の16か国は未加入では選べない', () => {
  assert.equal(isCountryUnlocked('JP', false), true);
  assert.equal(isCountryUnlocked('UY', false), false);
  assert.equal(isCountryUnlocked('UY', true), true);
  assert.equal(isCountryUnlocked('ZZ', true), false);
});

test('CPUの相手は自分と違う国から選ぶ（未加入なら無料16か国）', () => {
  for (let i = 0; i < 60; i += 1) {
    assert.notEqual(pickOpponent('JP', Math.random, { entitled: false }).code, 'JP');
    assert.equal(pickOpponent('JP', Math.random, { entitled: false }).pro, undefined);
  }
  assert.equal(pickOpponent('JP', () => 0).code, 'BR');
  assert.equal(pickOpponent('JP', () => 0.999).code, COUNTRIES.at(-1).code);
});
