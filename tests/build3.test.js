import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DIRECTIONS, mirrorDirection, newMatch, resolveKick,
} from '../src/core/rules.js';
import {
  EMPTY_RECORD, CPU_RECORD_KEYS, ONLINE_RECORD_KEYS, addResult, addOnlineResult,
  resetRecord, loadRecord, loadPrefs,
} from '../src/storage.js';
import { DEFAULT_PREFS } from '../src/config.js';
import { matchView, resultView, pkRows } from '../src/ui/match.js';
import { statsView, quickSettingsView } from '../src/ui/misc.js';
import { countryView } from '../src/ui/country.js';
import { lockerView } from '../src/ui/locker.js';
import { DEFAULT_SKIN } from '../src/core/skins.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

/* 画面の関数は文字列を返すだけなので、DOM 無しで中身を確かめられる */
const t = (key) => String(key);
const prefs = { country: 'JP', opponent: 'BR', sound: true, bgm: true, vibrate: true, order: 'first', language: 'ja' };

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('キーパーの画面は左右が反転する: mirrorDirection は TL↔TR / BL↔BR', () => {
  assert.equal(mirrorDirection('TL'), 'TR');
  assert.equal(mirrorDirection('TR'), 'TL');
  assert.equal(mirrorDirection('BL'), 'BR');
  assert.equal(mirrorDirection('BR'), 'BL');
  /* 時間切れの枠外・キーパー中央は反転しない */
  assert.equal(mirrorDirection('OUT'), 'OUT');
  assert.equal(mirrorDirection('CENTER'), 'CENTER');
  for (const dir of DIRECTIONS) {
    assert.equal(mirrorDirection(mirrorDirection(dir)), dir);
    assert.notEqual(mirrorDirection(dir), dir);
  }
});

test('キーパーが押したボタンと飛ぶ方向が一致する（反転してからエンジンへ）', () => {
  /* 画面の左下（BL）を押した → ゴール基準では右下（BR）。実際に飛ぶのも画面の左下 */
  const screenPick = 'BL';
  const goalPick = mirrorDirection(screenPick);
  assert.equal(goalPick, 'BR');
  /* キッカーが画面の左下（BL = ゴール左）へ蹴った → キーパーが同じ画面の左下へ飛んでも
     物理的には逆側なのでセーブにならない（＝見た目と判定が一致する） */
  const state = resolveKick(newMatch(), { shot: 'BL', save: goalPick });
  assert.equal(state.history[0].goal, true);
  /* キッカーが右下（BR）へ蹴った → キーパーが BL を押して飛んだ BR が一致してセーブ */
  const saved = resolveKick(newMatch(), { shot: 'BR', save: mirrorDirection('BL') });
  assert.equal(saved.history[0].goal, false);
});

test('先攻/後攻の設定は保存され、既定は先攻', () => {
  assert.equal(DEFAULT_PREFS.order, 'first');
  const storage = fakeStorage();
  assert.equal(loadPrefs(storage, ['ja']).order, 'first');
  storage.setItem('shootout4.settings.v1', JSON.stringify({ order: 'second' }));
  assert.equal(loadPrefs(storage, ['ja']).order, 'second');
  storage.setItem('shootout4.settings.v1', JSON.stringify({ order: 'nonsense' }));
  assert.equal(loadPrefs(storage, ['ja']).order, 'first');
});

test('CPU戦績とPRO通信対戦の通算は別枠で、リセットしても通信は消えない', () => {
  const cpu = addResult({ ...EMPTY_RECORD }, { winner: 'me', goals: 3, conceded: 1, saves: 2, shots: 5 });
  assert.equal(cpu.played, 1);
  assert.equal(cpu.wins, 1);
  assert.equal(cpu.onlinePlayed, 0, 'CPU戦は通信通算に足さない');

  const online = addOnlineResult(cpu, { winner: 'opp', goals: 1, conceded: 2 });
  assert.equal(online.played, 1, '通信戦はCPU戦績に足さない');
  assert.equal(online.onlinePlayed, 1);
  assert.equal(online.onlineLosses, 1);
  assert.equal(online.onlineGoals, 1);
  assert.equal(online.onlineConceded, 2);
  assert.equal(online.points, 0, '5本以内の敗北は0pt（マイナスにならない）');

  const win = addOnlineResult(online, { winner: 'me', goals: 4, conceded: 2 });
  assert.equal(win.points, 3, 'Build 4: 5本以内の勝利は+3pt');
  assert.equal(win.onlineStreak, 1);
  assert.equal(win.onlineBestStreak, 1);

  /* Build 4: サドンデスは勝ち+2 / 負け+1 */
  assert.equal(addOnlineResult(win, { winner: 'me', goals: 6, conceded: 5, sudden: true }).points, 5);
  assert.equal(addOnlineResult(win, { winner: 'opp', goals: 5, conceded: 6, sudden: true }).points, 4);

  const storage = fakeStorage();
  const afterReset = resetRecord(storage, win);
  for (const key of CPU_RECORD_KEYS) assert.equal(afterReset[key], 0, key);
  assert.equal(afterReset.onlinePlayed, 2);
  assert.equal(afterReset.onlineWins, 1);
  assert.equal(afterReset.points, 3);
  assert.deepEqual(loadRecord(storage), afterReset, '保存された値も同じ');

  /* 旧バージョンの保存値（CPUだけ）を読んでも壊れない */
  storage.setItem('shootout4.record.v1', JSON.stringify({ played: 4, wins: 3, losses: 1 }));
  const old = loadRecord(storage);
  assert.equal(old.played, 4);
  for (const key of ONLINE_RECORD_KEYS) assert.equal(old[key], 0, key);
});

test('戦績画面は CPU（リセット可）と PRO 通信通算の2枠', () => {
  const record = { ...EMPTY_RECORD, played: 10, wins: 6, losses: 4, onlinePlayed: 3, onlineWins: 2, onlineLosses: 1, points: 25 };
  const html = statsView({ t, record });
  assert.match(html, /data-testid="stats-cpu"/);
  assert.match(html, /data-testid="stats-online"/);
  assert.match(html, /data-testid="reset-record"/);
  /* リセットのボタンは CPU 枠の側にだけあり、通信枠の後ろには無い */
  const resetAt = html.indexOf('data-testid="reset-record"');
  const onlineAt = html.indexOf('data-testid="stats-online"');
  assert.ok(resetAt > 0 && onlineAt > resetAt, '通信枠はリセットの後ろ（別枠）');
  assert.match(html, /online-played">3</);
  assert.match(html, /statsProNote/);
});

test('PK表は上段=先攻・下段=後攻で、あなた/相手のラベルが付く', () => {
  const orderFirst = pkRows(newMatch({ first: 'me' }), t, { meCode: 'JP', oppCode: 'BR' });
  const firstRow = orderFirst.slice(0, orderFirst.indexOf('pk-row-opp'));
  assert.match(firstRow, /pk-row-me/);
  assert.match(firstRow, /firstKick/);
  const secondHalf = orderFirst.slice(orderFirst.indexOf('pk-row-opp'));
  assert.match(secondHalf, /secondKick/);

  const orderSecond = pkRows(newMatch({ first: 'opp' }), t, { meCode: 'JP', oppCode: 'BR' });
  assert.ok(orderSecond.indexOf('pk-row-opp') < orderSecond.indexOf('pk-row-me'), '後攻が自分なら相手が上段');
  assert.match(orderSecond.slice(0, orderSecond.indexOf('pk-row-me')), /firstKick/);
  assert.match(orderSecond.slice(orderSecond.indexOf('pk-row-me')), /secondKick/);
});

test('試合画面の右上にスピーカーと設定のボタンがある（戻る・スコアと干渉しない位置）', () => {
  const html = matchView({ t, prefs, state: newMatch(), language: 'ja', kickerFor: () => ({ name: 'A', foot: 'right' }) });
  assert.match(html, /data-testid="match-sound"/);
  assert.match(html, /data-testid="match-settings"/);
  assert.match(html, /data-action="toggle-sound"/);
  assert.match(html, /data-action="match-settings"/);
  assert.match(html, /class="stage__tools"/);
  /* 右上のボタン群は戻るボタン（hud の先頭）より後ろ＝別の場所 */
  assert.ok(html.indexOf('stage__tools') > html.indexOf('data-action="quit"'));
  assert.match(html, /aria-pressed="true"/);
  const quiet = matchView({ t, prefs: { ...prefs, sound: false, bgm: false }, state: newMatch(), language: 'ja' });
  assert.match(quiet, /aria-pressed="false"/);
  /* 設定シートは試合を描き直さずに開ける（同じ画面の上に出す） */
  const sheet = quickSettingsView({ t, prefs });
  assert.match(sheet, /data-quick-settings/);
  assert.match(sheet, /data-quick-toggle="sound"/);
  assert.match(sheet, /data-quick-toggle="bgm"/);
  assert.match(sheet, /data-quick="close"/);
});

test('結果画面の凡例は ⚽ vs 🧤 が近くに並ぶ', () => {
  const state = newMatch();
  const html = resultView({ t, state, record: { ...EMPTY_RECORD }, language: 'ja', prefs });
  const head = html.slice(html.indexOf('kicklog__head'), html.indexOf('kicklog__head') + 400);
  assert.match(head, /⚽/);
  assert.match(head, /🧤/);
  assert.match(head, /kicklog__vs/);
  assert.match(head, /kickLogShot/);
  assert.match(head, /kickLogSave/);
});

test('国えらぶ画面に横スクロールの案内が2か所（あなたの国・対戦相手）', () => {
  const html = countryView({ t, prefs, entitled: true, language: 'ja' });
  const hints = html.match(/data-testid="strip-hint"/g) || [];
  assert.equal(hints.length, 2);
  assert.match(html, /scrollHint/);
  assert.match(html, /section-head__label/);
});

test('ロッカーは3Dプレビュー・キャラ名バッジ・先攻/後攻のボタンを持つ', () => {
  const html = lockerView({
    t, entitled: true, draft: { ...DEFAULT_SKIN }, language: 'ja', registered: true, order: 'second',
  });
  assert.match(html, /data-testid="locker-preview"/);
  assert.match(html, /<canvas/);
  assert.match(html, /data-testid="preview-badge"/);
  assert.match(html, /charVoxel/);
  assert.match(html, /data-testid="order-first"/);
  assert.match(html, /data-testid="order-second"/);
  assert.match(html, /data-order="second"/);
  assert.match(html, /class="seg is-on"[^>]*data-order="second"|data-order="second"[^>]*class="seg is-on"/);
  assert.match(html, /kickOrder/);
  /* 旧来の2D並びは WebGL が無いときの控えとして残す（hidden） */
  assert.match(html, /id="locker-lineup" hidden/);
});

test('ロッカーのプレビューは斜め正面・近めで、切り替え時に回転ジャンプする', () => {
  const preview = read('src/three/preview.js');
  assert.match(preview, /createPreview/);
  assert.match(preview, /SPIN_MS/);
  assert.match(preview, /rotation\.y/);
  assert.match(preview, /position\.y = lift/);
  const camera = preview.match(/pos: new THREE\.Vector3\(([-\d.]+), ([\d.]+), ([\d.]+)\)/);
  assert.ok(camera, 'カメラ位置');
  const [, x, y, z] = camera.map(Number);
  assert.ok(x > 0.6 && x < 2, `斜め（左右に寄る）: x=${x}`);
  assert.ok(z > 1.8 && z < 4, `近い（アップ寄り）: z=${z}`);
  assert.ok(y > 1 && y < 2.2, `目の高さ: y=${y}`);
  /* 切替時は animate=true で作られ、1回転する */
  assert.match(preview, /if \(animate\) state\.spinStart = performance\.now\(\)/);
  assert.match(read('src/main.js'), /createPreview\(canvas/);
  assert.match(read('src/main.js'), /animate: changed/);
});

test('キーパーのダイビングは選んだコースへ頭と手から飛ぶ（倒れる向きの符号）', () => {
  const stadium = read('src/three/stadium.js');
  /* Build 2 の「逆側へ倒れる」符号が残っていない */
  assert.doesNotMatch(stadium, /keeper\.rotation\.z = dive\.side \* eased/);
  assert.match(stadium, /keeper\.rotation\.z = -dive\.side \* eased/);
  assert.match(stadium, /poseDiveArms/);
  assert.match(stadium, /const KEEPER_DIVE_Z = GOAL_Z \+ 0\.45/);
  assert.match(stadium, /clamp|Math\.max\(-\(GOAL_HALF - 0\.4\), Math\.min\(GOAL_HALF - 0\.4/);
  /* 動けなかったとき（stuck）は飛ばない */
  assert.match(stadium, /const noDive = Boolean\(stuck\)/);
  /* キーパー視点は得点後もゴール裏のまま（前からのカメラに切り替えない） */
  const impact = stadium.slice(stadium.indexOf('function impact(goal)'), stadium.indexOf('function updateFlight'));
  assert.match(impact, /state\.role === 'keep'/);
  assert.match(impact, /-20\.8/);
});

test('バックグラウンドで音を止め、戻ったら再開する（Web + iOS）', () => {
  const audio = read('src/audio.js');
  assert.match(audio, /export function suspendForBackground/);
  assert.match(audio, /ctx\.suspend\(\)/);
  assert.match(audio, /export function resumeFromBackground/);
  assert.match(audio, /state\.silent\?\.pause/);
  const main = read('src/main.js');
  assert.match(main, /visibilitychange/);
  assert.match(main, /pagehide/);
  /* Build 5: blur（共有シート・課金シート・通知）では止めない（音が消える原因だった） */
  assert.equal(/addEventListener\('blur'/.test(main), false);
  assert.match(main, /suspendForBackground\(\)/);
  assert.match(main, /pauseRound\(\)/);
  const swift = read('ios/App/App/AppDelegate.swift');
  assert.match(swift, /applicationWillResignActive/);
  assert.match(swift, /applicationDidEnterBackground/);
  assert.match(swift, /setActive\(false, options: \.notifyOthersOnDeactivation\)/);
  assert.match(swift, /applicationDidBecomeActive/);
});
