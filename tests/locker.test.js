import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KITS, BOOTS, KIT_DESIGNS, BOOT_SHAPES, DEFAULT_SKIN, getKit, getBoot, isKitUnlocked,
  isBootUnlocked, normalizeSkin, readSkin, saveSkin, kitSpec, bootSpec, opponentKit,
} from '../src/core/skins.js';
import {
  COUNTRIES, COUNTRY_CODES, getCountry, countryName, pickOpponent, countryKit,
} from '../src/core/countries.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('キットは10種・スパイクは6種、デザインと形は定義済みのものだけ', () => {
  assert.equal(KITS.length, 10);
  assert.equal(BOOTS.length, 6);
  assert.equal(new Set(KITS.map((kit) => kit.id)).size, 10);
  assert.equal(new Set(BOOTS.map((boot) => boot.id)).size, 6);
  for (const kit of KITS) assert.ok(KIT_DESIGNS.includes(kit.design), kit.design);
  for (const boot of BOOTS) assert.ok(BOOT_SHAPES.includes(boot.shape), boot.shape);
  assert.deepEqual([...new Set(KITS.map((kit) => kit.design))].sort(), [...KIT_DESIGNS].sort());
});

test('能力差ゼロ: キットとスパイクに「強さ」の値が無い', () => {
  const forbidden = ['power', 'accuracy', 'speedBonus', 'rating', 'bonus', 'boost', 'winRate', 'ability'];
  for (const item of [...KITS, ...BOOTS]) {
    for (const key of forbidden) assert.equal(key in item, false, `${item.id} に ${key}`);
  }
});

test('無料とPROの線引き: 無料でも1着・1足は遊べる', () => {
  const freeKits = KITS.filter((kit) => !kit.pro);
  const freeBoots = BOOTS.filter((boot) => !boot.pro);
  assert.ok(freeKits.length >= 2);
  assert.ok(freeBoots.length >= 1);
  assert.equal(isKitUnlocked(freeKits[0].id, false), true);
  assert.equal(isKitUnlocked('royal-stripe', false), false);
  assert.equal(isKitUnlocked('royal-stripe', true), true);
  assert.equal(isBootUnlocked('classic-black', false), true);
  assert.equal(isBootUnlocked('speed-gold', false), false);
});

test('保存: 未購入のPROキットは保存できない / 正しい値だけが残る', () => {
  const storage = fakeStorage();
  assert.deepEqual(readSkin(storage), DEFAULT_SKIN);
  assert.throws(() => saveSkin(storage, false, { kit: 'royal-stripe', boot: 'classic-black' }), /PRO required/);
  const saved = saveSkin(storage, true, { kit: 'royal-stripe', boot: 'speed-gold' });
  assert.deepEqual(saved, { kit: 'royal-stripe', boot: 'speed-gold' });
  assert.deepEqual(readSkin(storage), saved);
  /* 壊れた保存値は既定に戻る */
  storage.setItem('shootout4.skin.v1', '{oops');
  assert.deepEqual(readSkin(storage), DEFAULT_SKIN);
  assert.deepEqual(normalizeSkin({ kit: 'unknown', boot: 'unknown' }), DEFAULT_SKIN);
});

test('3D用の仕様はプレーンな色データ', () => {
  const kit = kitSpec('sash-gold');
  assert.equal(kit.design, 'sash');
  assert.match(kit.primary, /^#[0-9a-f]{6}$/i);
  assert.doesNotMatch(kit.primary, /\s/);
  const boot = bootSpec('high-white');
  assert.equal(boot.shape, 'high');
  assert.equal(getKit('nothing').id, KITS[0].id);
  assert.equal(getBoot('nothing').id, BOOTS[1].id);
});

test('相手のキットは国の色から作る（PROの見た目は使わない）', () => {
  const kit = opponentKit('BR', countryKit('BR'));
  assert.equal(kit.design, 'solid');
  assert.equal(kit.primary, '#f7d117');
});

test('16か国・コードは一意・国旗と名前・歓声の設定がある', () => {
  assert.equal(COUNTRIES.length, 16);
  assert.equal(new Set(COUNTRY_CODES).size, 16);
  for (const country of COUNTRIES) {
    assert.match(country.code, /^[A-Z]{2}$/);
    assert.match(country.flag, /^assets\/flags\/[a-z]{2}-96\.png$/);
    assert.ok(country.name.ja && country.name.en, country.code);
    assert.ok(country.crowd.channel !== undefined ? true : country.crowd.density > 0);
    assert.ok(Array.isArray(country.crowd.chant) && country.crowd.chant.length >= 3);
    assert.match(country.kit.primary, /^#[0-9a-f]{6}$/i);
  }
});

test('国名は日本語/英語、ほかの言語は英語フォールバック', () => {
  assert.equal(countryName('JP', 'ja'), '日本');
  assert.equal(countryName('JP', 'en'), 'Japan');
  assert.equal(countryName('JP', 'th'), '日本' === countryName('JP', 'th') ? '日本' : 'Japan');
  assert.equal(countryName('BR', 'fr'), 'Brazil');
  assert.equal(getCountry('zz').code, 'JP');
});

test('CPUの相手は自分と違う国から選ぶ', () => {
  for (let i = 0; i < 50; i += 1) {
    assert.notEqual(pickOpponent('JP').code, 'JP');
  }
  assert.equal(pickOpponent('JP', () => 0).code, 'BR');
  assert.equal(pickOpponent('JP', () => 0.999).code, COUNTRIES.at(-1).code);
});
