import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIRECTIONS, newMatch, resolveKick, kickerNumber, phase, decidedWinner, pkBoard,
  validateOnlineKick, validateStamp, randomDirection, winRate, MAX_TOTAL_KICKS,
} from '../src/core/rules.js';

const kick = (state, shot, save) => resolveKick(state, { shot, save });

test('16通りの組み合わせ: 同じ方向だけがセーブ', () => {
  for (const shot of DIRECTIONS) {
    for (const save of DIRECTIONS) {
      const next = kick(newMatch(), shot, save);
      assert.equal(next.history[0].goal, shot !== save, `${shot}/${save}`);
      assert.equal(next.score.me, shot !== save ? 1 : 0);
    }
  }
});

test('交互に蹴り、state を書き換えない', () => {
  const start = newMatch();
  const one = kick(start, 'TL', 'TR');
  assert.equal(start.history.length, 0, '元の state は無傷');
  assert.equal(one.turn, 'opp');
  const two = kick(one, 'BL', 'BR');
  assert.equal(two.turn, 'me');
  assert.equal(two.kicks.me.length, 1);
  assert.equal(two.kicks.opp.length, 1);
});

test('キッカー番号は 1→5、サドンデスは6本目で1に戻る', () => {
  let state = newMatch();
  const seen = [];
  /* 互いに1本ずつ決め続けて 5-5 → 6-6（決着しない） */
  for (let i = 0; i < 12; i += 1) {
    seen.push(kickerNumber(state));
    state = kick(state, 'TL', 'BR');
  }
  assert.deepEqual(seen, [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  assert.equal(kickerNumber(state, 'opp'), 1, '7本目は1人目に戻る');
});

test('5本ずつ終えて同点ならサドンデス、両者が蹴って差がつけば決着', () => {
  /* 5本ずつ 3-2 にならないよう、全部セーブで 0-0 のまま */
  let state = newMatch();
  for (let i = 0; i < 10; i += 1) state = kick(state, 'TL', 'TL');
  assert.equal(state.winner, null);
  assert.equal(phase(state), 'sudden');

  /* 6本目: 自分が決めて、相手が外す */
  state = kick(state, 'TR', 'BR'); // ゴール
  assert.equal(state.winner, null, '相手の6本目が終わるまで決まらない');
  state = kick(state, 'BR', 'BR'); // 相手はセーブされる（同じ方向）
  assert.equal(state.winner, 'me');
  assert.equal(state.score.me, 1);
});

test('サドンデスが続いても公平: 同点なら決着しない', () => {
  let state = newMatch();
  for (let i = 0; i < 10; i += 1) state = kick(state, 'TL', 'BR'); // 5-5
  assert.equal(state.winner, null);
  for (let pair = 0; pair < 3; pair += 1) {
    state = kick(state, 'TR', 'BR');
    state = kick(state, 'TR', 'BR');
    assert.equal(state.winner, null, `pair ${pair}`);
  }
  assert.equal(state.score.me, 8);
  state = kick(state, 'TR', 'BR');
  state = kick(state, 'BL', 'BL'); // 相手は止められる
  assert.equal(state.winner, 'me');
});

test('早期決着: 残り本数で追いつけなくなったら終わる', () => {
  /* 自分3本連続ゴール、相手0本 → 3本ずつ終えた時点で 3-0 */
  let state = newMatch();
  for (let i = 0; i < 3; i += 1) {
    state = kick(state, 'TL', 'BR');
    state = kick(state, 'TL', 'TL');
  }
  assert.equal(state.score.me, 3);
  assert.equal(state.score.opp, 0);
  assert.equal(state.winner, 'me', '3-0 で残り2本ずつなら決着');
  assert.equal(decidedWinner(state), 'me');

  /* 2-0 では終わらない（相手に残り3本ある） */
  let state2 = newMatch();
  for (let i = 0; i < 2; i += 1) {
    state2 = kick(state2, 'TL', 'BR');
    state2 = kick(state2, 'TL', 'TL');
  }
  assert.equal(state2.winner, null);
});

test('相手が先攻でも交互に進み、相手の勝ちも記録できる', () => {
  let state = newMatch({ first: 'opp' });
  assert.equal(state.turn, 'opp');
  for (let i = 0; i < 6; i += 1) {
    /* 相手が全部決めて、自分が全部止められる: 3-0 で相手の勝ち */
    state = kick(state, i % 2 === 1 ? 'TR' : 'BL', i % 2 === 1 ? 'TR' : 'TL');
  }
  assert.equal(state.score.opp, 3);
  assert.equal(state.winner, 'opp');
});

test('勝敗が決まった試合には追加できない・不正な方向は拒否', () => {
  let state = newMatch();
  for (let i = 0; i < 6 && !state.winner; i += 1) {
    state = kick(state, 'TL', 'TL'); // 自分は止められる
    if (!state.winner) state = kick(state, 'TL', 'BR'); // 相手は決める
  }
  assert.equal(state.winner, 'opp');
  assert.throws(() => kick(state, 'TL', 'BR'), /match finished/);
  assert.throws(() => kick(newMatch(), 'XX', 'TL'), /invalid direction/);
  assert.throws(() => newMatch({ first: 'ref' }), /invalid first/);
});

test('PKスコアボード: 5本＋サドンデスの並びと現在の位置', () => {
  let state = newMatch();
  for (let i = 0; i < 10; i += 1) state = kick(state, 'TL', 'TL');
  const board = pkBoard(state);
  assert.equal(board.me.length, 5);
  assert.equal(board.opp.length, 5);
  assert.equal(board.sudden, false);
  assert.equal(board.me.every((cell) => cell.kicked && cell.goal === false), true);

  state = kick(state, 'TR', 'BR');
  const after = pkBoard(state);
  assert.equal(after.me.length, 6);
  assert.equal(after.sudden, true);
  assert.equal(after.me[5].goal, true);
  assert.equal(after.opp[5].current, true, '次は相手の6本目');
});

test('タイムアップの自動選択は4方向のみ・偏らない', () => {
  const counts = Object.fromEntries(DIRECTIONS.map((dir) => [dir, 0]));
  for (let i = 0; i < 400; i += 1) counts[randomDirection()] += 1;
  for (const dir of DIRECTIONS) assert.ok(counts[dir] > 60 && counts[dir] < 140, `${dir}: ${counts[dir]}`);
});

test('通信の検証: 自分の手・重複・範囲外・不正方向を捨てる', () => {
  const seen = new Set();
  assert.equal(validateOnlineKick({ from: 'a', round: 0, dir: 'TL' }, { self: 'me', seen }).ok, true);
  assert.equal(validateOnlineKick({ from: 'me', round: 0, dir: 'TL' }, { self: 'me', seen }).ok, false);
  assert.equal(validateOnlineKick({ from: 'a', round: 0, dir: 'XX' }, { self: 'me', seen }).ok, false);
  assert.equal(validateOnlineKick({ from: 'a', round: -1, dir: 'TL' }, { self: 'me', seen }).ok, false);
  assert.equal(validateOnlineKick({ from: 'a', round: MAX_TOTAL_KICKS, dir: 'TL' }, { self: 'me', seen }).ok, false);
  assert.equal(validateOnlineKick({ from: 'a', round: 0, dir: 'TL', pad: 'x'.repeat(600) }, { self: 'me', seen }).ok, false);
  const dup = new Set(['a:0']);
  assert.equal(validateOnlineKick({ from: 'a', round: 0, dir: 'TL' }, { self: 'me', seen: dup }).ok, false);
});

test('スタンプ: 定型のみ・4秒あき', () => {
  const now = 100000;
  assert.equal(validateStamp({ from: 'a', id: 'nice' }, { self: 'me', allowed: ['nice'], now }).ok, true);
  assert.equal(validateStamp({ from: 'a', id: 'free text' }, { self: 'me', allowed: ['nice'], now }).ok, false);
  assert.equal(validateStamp({ from: 'a', id: 'nice' }, { self: 'me', allowed: ['nice'], now, lastAt: now - 1000 }).ok, false);
});

test('勝率の計算', () => {
  assert.equal(winRate({ wins: 3, losses: 1 }), 75);
  assert.equal(winRate({ wins: 0, losses: 0 }), 0);
});
