import test from 'node:test';
import assert from 'node:assert/strict';

import { newMatch, resolveKick, DIRECTIONS } from '../src/core/rules.js';
import { chooseCPU, LEVELS, LEVEL_PARAMS, levelStars, normalizeLevel, isLevel } from '../src/core/cpu.js';

/** 決まった乱数列（テストを再現可能にする） */
function seeded(seed = 12345) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

test('CPUは常に4方向のどれかを選び、state を変えない', () => {
  const state = newMatch();
  const snapshot = JSON.stringify(state);
  for (const level of LEVELS) {
    const random = seeded(7);
    for (let i = 0; i < 200; i += 1) {
      const dir = chooseCPU(state, { level, random });
      assert.ok(DIRECTIONS.includes(dir), `${level}: ${dir}`);
    }
  }
  assert.equal(JSON.stringify(state), snapshot);
});

test('CPUの判断は「終わった本」だけを見る（未来の手は見えない）', () => {
  /* 同じ履歴なら、これから人間が何を選ぶうかに関係なく同じ答え */
  let state = newMatch();
  state = resolveKick(state, { shot: 'TL', save: 'TL' });
  const a = chooseCPU(state, { level: 'legend', random: seeded(99) });
  const b = chooseCPU(state, { level: 'legend', random: seeded(99) });
  assert.equal(a, b);
});

test('最強は相手の癖を読む: 同じ方向ばかり蹴る相手には、その方向へ飛ぶ', () => {
  let state = newMatch();
  /* 人間がいつも TL へ蹴る履歴を作る（先攻は自分なので1本目が人間） */
  for (let i = 0; i < 8; i += 1) {
    state = resolveKick(state, { shot: 'TL', save: 'TL' }); // 人間はTLへ蹴る（止められる）
    state = resolveKick(state, { shot: 'BR', save: 'BR' }); // 相手も止められる
  }
  /* CPUはキーパー（turn は me に戻っている） */
  assert.equal(state.turn, 'me');
  const random = seeded(3);
  let hits = 0;
  for (let i = 0; i < 300; i += 1) {
    if (chooseCPU(state, { level: 'legend', random }) === 'TL') hits += 1;
  }
  assert.ok(hits > 110, `TL に寄るはず: ${hits}/300`);

  const rookieRandom = seeded(3);
  let rookieHits = 0;
  for (let i = 0; i < 300; i += 1) {
    if (chooseCPU(state, { level: 'rookie', random: rookieRandom }) === 'TL') rookieHits += 1;
  }
  assert.ok(rookieHits < hits, `初級は読まない: ${rookieHits} < ${hits}`);
});

test('レベルは4段階・未知の値は中級に落とす', () => {
  assert.deepEqual(LEVELS, ['rookie', 'normal', 'elite', 'legend']);
  assert.equal(normalizeLevel('god'), 'normal');
  assert.equal(isLevel('elite'), true);
  assert.equal(levelStars('legend'), 4);
  assert.equal(levelStars('rookie'), 1);
  assert.ok(LEVEL_PARAMS.legend.noise < LEVEL_PARAMS.rookie.noise);
});
