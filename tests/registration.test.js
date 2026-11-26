import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_REGISTRATION, FOOTS, ROSTER_SIZE, MAX_NAME, MAX_TEAM, normalizeRegistration,
  readRegistration, writeRegistration, isRegistered, playerName, playerFoot, roster,
  playerFor, cpuFoot, cpuPlayer, officialCountry, registrationSummary,
} from '../src/core/registration.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('登録なしでも遊べる: 既定は5人ぶんの名前と右足', () => {
  const reg = normalizeRegistration({});
  assert.deepEqual([...FOOTS], ['right', 'left']);
  assert.equal(ROSTER_SIZE, 5);
  assert.equal(isRegistered(reg), false);
  assert.equal(playerName(reg, 1, { countryLabel: '日本' }), '日本');
  assert.equal(playerName(reg, 2), 'Player 2');
  assert.equal(playerName(reg, 5), 'Player 5');
  for (let number = 1; number <= 5; number += 1) assert.equal(playerFoot(reg, number), 'right');
  const list = roster(reg, { countryLabel: '日本' });
  assert.equal(list.length, 5);
  assert.deepEqual(list.map((item) => item.number), [1, 2, 3, 4, 5]);
});

test('名前・チーム名・利き足が5人ぶん反映され、キッカー番号は1〜5で回る', () => {
  const reg = normalizeRegistration({
    country: 'UY',
    teamName: 'OKINAWA FC',
    userName: 'トモアキ',
    foot: 'left',
    teammates: [
      { name: 'タカシ', foot: 'right' },
      { name: 'ケン', foot: 'left' },
      { name: '', foot: 'right' },
      { name: 'ソウ', foot: 'left' },
    ],
  });
  assert.equal(isRegistered(reg), true);
  assert.equal(playerName(reg, 1), 'トモアキ');
  assert.equal(playerFoot(reg, 1), 'left');
  assert.equal(playerName(reg, 2), 'タカシ');
  assert.equal(playerFoot(reg, 2), 'right');
  assert.equal(playerName(reg, 4), 'Player 4');
  assert.equal(playerFoot(reg, 5), 'left');
  /* サドンデスで6本目以降も1〜5を繰り返す */
  assert.equal(playerFor(reg, 6).number, 1);
  assert.equal(playerFor(reg, 7).name, 'タカシ');
});

test('入力は1行だけ・長さ制限・国と利き足は既知の値だけ', () => {
  const reg = normalizeRegistration({
    country: 'ZZ',
    teamName: 'A'.repeat(40),
    userName: 'a\nb\tc',
    foot: 'up',
    teammates: [{ name: 'x'.repeat(40), foot: 'right' }],
  });
  assert.equal(reg.country, 'JP');
  assert.equal(reg.teamName.length, MAX_TEAM);
  assert.equal(reg.userName.includes('\n'), false);
  assert.equal(reg.userName, 'a b c');
  assert.equal(reg.foot, 'right');
  assert.equal(reg.teammates[0].name.length, MAX_NAME);
  assert.equal(reg.teammates.length, 4);
  assert.equal(normalizeRegistration({ teammates: 'oops' }).teammates.length, 4);
});

test('保存と読み込み（壊れた保存値は既定へ）', () => {
  const storage = fakeStorage();
  assert.deepEqual(readRegistration(storage), normalizeRegistration(DEFAULT_REGISTRATION));
  const saved = writeRegistration(storage, {
    country: 'BR', teamName: 'SUNSET', userName: 'MAKS', foot: 'left',
    teammates: [{ name: 'A', foot: 'left' }],
  });
  assert.deepEqual(readRegistration(storage), saved);
  storage.setItem('shootout4.player.v1', '{oops');
  assert.equal(readRegistration(storage).userName, '');
});

test('CPU の利き足はラウンド／選手ごとに決まり、毎回同じ（通信でも一致）', () => {
  const a = cpuFoot(3, 2, 'BR:JP');
  const b = cpuFoot(3, 2, 'BR:JP');
  assert.equal(a, b);
  assert.ok(['right', 'left'].includes(a));
  const variety = new Set();
  for (let round = 0; round < 10; round += 1) {
    for (let number = 1; number <= 5; number += 1) variety.add(cpuFoot(round, number, 'BR'));
  }
  assert.equal(variety.size, 2, '両方の利き足が出る');
  const player = cpuPlayer(4, 3, { countryLabel: 'Brazil', seed: 'BR' });
  assert.equal(player.number, 3);
  assert.equal(player.name, 'Brazil 3');
  assert.equal(player.foot, cpuFoot(4, 3, 'BR'));
});

test('公式戦は登録した代表国で戦う（未登録なら普段の国）', () => {
  assert.equal(officialCountry({ country: 'SN' }, 'JP'), 'SN');
  assert.equal(officialCountry({ country: 'ZZ' }, 'BR'), 'BR');
  const summary = registrationSummary(
    { country: 'SN', teamName: 'TERANGA', userName: 'MAKS', foot: 'left' },
    { countryLabel: 'セネガル', languageName: '日本語' },
  );
  assert.equal(summary.registered, true);
  assert.equal(summary.country, 'SN');
  assert.equal(summary.countryLabel, 'セネガル');
  assert.equal(summary.teammates.length, 4);
  assert.equal(summary.teammates[0].name, 'Player 2');
});
