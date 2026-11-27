/**
 * SHOOTOUT 4 — Build 7 の検証
 *
 *  1. ビルド番号 7（v1.0.0）が全ファイルで揃っている
 *  2. キーパー視点の左右ドラッグ（指を右 → 画面の右）
 *  3. 通信でのキーパー位置はワールド座標（キッカー側では同じポスト側に見える）
 *  4. 時間切れ: 選んでいれば通常どおり／未選択だけ枠外・棒立ち（CPU・通信）
 *  5. スタンプ・定型文: id のみ・許可リスト・12言語・吹き出し・CPU の反応
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../vendor/three.module.min.js';

import { CONFIG } from '../src/config.js';
import {
  newMatch, resolveKick, mirrorDirection, timeoutChoice, validateStamp,
} from '../src/core/rules.js';
import { keeperOffsetFromRatio, ratioFromClientX } from '../src/core/controls.js';
import {
  EMOTES, EMOTE_IDS, EMOTE_WIRE_IDS, EMOTE_SECTIONS, emoteById, isEmoteId, cpuEmoteFor,
} from '../src/core/emotes.js';
import { DICT, LANGUAGES, LANGUAGE_TAGS, tr } from '../src/i18n.js';
import { ShootoutSession } from '../src/net/online.js';
import { matchView } from '../src/ui/match.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

/* ------------------------------------------------------------------ *\
 * 1. ビルド番号
 * ------------------------------------------------------------------ */

test('Build 7 / v1.0.0 が全ファイルで揃っている', () => {
  assert.equal(CONFIG.version, '1.0.0');
  assert.equal(CONFIG.build, 7);
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.deepEqual([...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => m[1]), ['7', '7']);
  assert.match(read('package.json'), /Build 7/);
  assert.match(read('README.md'), /Build 7/);
  assert.match(read('README.md'), /v1\.0\.0 \/ Build 7/);
  assert.match(read('docs/ios-testflight.yml'), /TestFlight Build 7/);
  assert.match(read('docs/testflight-setup.md'), /\*\*7\*\*/);
});

/* ------------------------------------------------------------------ *\
 * 2. キーパー視点の左右ドラッグ
 * ------------------------------------------------------------------ */

/** キーパー視点カメラを stadium.js の定義から作る（値が変わったらここで気づく） */
function keeperCamera() {
  const stadium = read('src/three/stadium.js');
  const match = stadium.match(/keep: \{ pos: new THREE\.Vector3\(([-\d.]+), ([-\d.]+), ([-\d.]+)\), look: new THREE\.Vector3\(([-\d.]+), ([-\d.]+), ([-\d.]+)\), fov: (\d+)/);
  assert.ok(match, 'keep カメラの定義');
  const [x, y, z, lx, ly, lz, fov] = match.slice(1).map(Number);
  const camera = new THREE.PerspectiveCamera(fov, 393 / 500, 0.1, 500);
  camera.position.set(x, y, z);
  camera.lookAt(new THREE.Vector3(lx, ly, lz));
  camera.updateMatrixWorld(true);
  return camera;
}

function keeperWorldX(offset) {
  const stadium = read('src/three/stadium.js');
  const half = Number(stadium.match(/const GOAL_HALF = ([\d.]+);/)[1]);
  const range = half - 0.55; /* KEEPER_RANGE = GOAL_HALF - 0.55 */
  return offset * range; /* keeperBase.x = 0 */
}

test('指の位置 → キーパーの左右は、キーパー視点で符号が反転する（画面の右＝ワールド -X）', () => {
  assert.equal(keeperOffsetFromRatio(0), 0);
  assert.equal(keeperOffsetFromRatio(1), -1);
  assert.equal(keeperOffsetFromRatio(-1), 1);
  assert.equal(keeperOffsetFromRatio(0.5), -0.5);
  assert.equal(keeperOffsetFromRatio(9), -1, '範囲外は丸める');
  assert.equal(keeperOffsetFromRatio(-9), 1);
  assert.equal(keeperOffsetFromRatio('なにか'), 0);

  /* 指の位置（clientX）→ -1〜+1 */
  const rect = { left: 0, width: 200 };
  assert.equal(ratioFromClientX(100, rect), 0);
  assert.equal(ratioFromClientX(200, rect), 1);
  assert.equal(ratioFromClientX(0, rect), -1);
  assert.equal(ratioFromClientX(400, rect), 1, '画面外も丸める');
});

test('指を右へ動かすと、キーパーはキーパー視点の画面でも右へ動く', () => {
  const camera = keeperCamera();
  const screenX = (offset) => {
    const point = new THREE.Vector3(keeperWorldX(offset), 0.9, -8.15).project(camera);
    return point.x;
  };
  const left = keeperOffsetFromRatio(-0.8);
  const middle = keeperOffsetFromRatio(0);
  const right = keeperOffsetFromRatio(0.8);
  assert.ok(screenX(left) < screenX(middle), `左へドラッグ: ${screenX(left)} < ${screenX(middle)}`);
  assert.ok(screenX(middle) < screenX(right), `右へドラッグ: ${screenX(middle)} < ${screenX(right)}`);
});

test('キッカー視点では、相手キーパーがワールド座標どおりのポスト側に見える', () => {
  const stadium = read('src/three/stadium.js');
  const [x, y, z, lx, ly, lz, fov] = stadium
    .match(/shoot: \{ pos: new THREE\.Vector3\(([-\d.]+), ([-\d.]+), ([-\d.]+)\), look: new THREE\.Vector3\(([-\d.]+), ([-\d.]+), ([-\d.]+)\), fov: (\d+)/)
    .slice(1).map(Number);
  const camera = new THREE.PerspectiveCamera(fov, 393 / 500, 0.1, 500);
  camera.position.set(x, y, z);
  camera.lookAt(new THREE.Vector3(lx, ly, lz));
  camera.updateMatrixWorld(true);
  const screenX = (offset) => new THREE.Vector3(keeperWorldX(offset), 0.9, -8.15).project(camera).x;
  /*
   * キッカー視点は +Z から -Z を見る（画面の右＝ワールド +X）。
   * キーパーが自分の画面で右へ寄った（offset はワールド -X）ときは、キッカー側では左に見える。
   */
  const keeperOwnRight = keeperOffsetFromRatio(1);
  const keeperOwnLeft = keeperOffsetFromRatio(-1);
  assert.ok(keeperOwnRight < 0 && keeperOwnLeft > 0, `${keeperOwnRight} / ${keeperOwnLeft}`);
  assert.ok(screenX(keeperOwnRight) < screenX(0));
  assert.ok(screenX(keeperOwnLeft) > screenX(0));
  assert.ok(screenX(keeperOwnRight) < screenX(keeperOwnLeft));
});

test('試合画面のキーパードラッグは、反転した値をワールド座標として送る', () => {
  const main = read('src/main.js');
  assert.match(main, /keeperOffsetFromRatio\(ratio\)/);
  assert.match(main, /stadium\.setKeeperOffset\(value\)/);
  assert.match(main, /session\.sendKeeper\(value\)/);
  assert.match(read('src/core/controls.js'), /画面の右がワールドの -X/);
});

/* ------------------------------------------------------------------ *\
 * 3. 時間切れ（選んでいれば普通に蹴る／飛ぶ）
 * ------------------------------------------------------------------ */

test('時間切れ: 方向を選んでいれば、その方向で普通に蹴る／飛ぶ', () => {
  const shooter = timeoutChoice({ role: 'shoot', selection: 'TR' });
  assert.deepEqual(shooter, { dir: 'TR', auto: false, stuck: false });
  const keeper = timeoutChoice({ role: 'keep', selection: 'BL' });
  assert.deepEqual(keeper, { dir: 'BL', auto: false, stuck: false });
});

test('時間切れ: 何も選んでいないときだけ、枠外（蹴る）・動けない（キーパー）', () => {
  assert.deepEqual(timeoutChoice({ role: 'shoot', selection: null }), { dir: 'OUT', auto: true, stuck: false });
  assert.deepEqual(timeoutChoice({ role: 'keep', selection: null }), { dir: 'OUT', auto: true, stuck: true });
  assert.deepEqual(timeoutChoice({}), { dir: 'OUT', auto: true, stuck: false });
});

test('時間切れ（選んでいた方向）は MISS にも棒立ちにもならない', () => {
  /* 蹴る側: TR を選んだまま時間切れ → 枠外ではなく普通のシュート */
  const shot = timeoutChoice({ role: 'shoot', selection: 'TR' });
  const saved = resolveKick(newMatch({ first: 'me' }), { shot: shot.dir, save: 'TL' });
  const savedEvent = saved.history.at(-1);
  assert.equal(savedEvent.miss, false);
  assert.equal(savedEvent.shot, 'TR');
  assert.equal(savedEvent.goal, true);
  assert.equal(savedEvent.timeout, false);

  /* キーパー: 画面で BL を押したまま時間切れ → 反転した BR へ飛ぶ */
  const keeper = timeoutChoice({ role: 'keep', selection: 'BL' });
  const state = { ...newMatch({ first: 'me' }), turn: 'opp' };
  const kept = resolveKick(state, { shot: 'BR', save: mirrorDirection(keeper.dir) });
  const keptEvent = kept.history.at(-1);
  assert.equal(keptEvent.stuck, false);
  assert.equal(keptEvent.save, 'BR');
  assert.equal(keptEvent.goal, false, '同じ方向へ飛べばセーブ');
});

test('時間切れ（未選択）のキーパーは棒立ちで必ず失点する', () => {
  const choice = timeoutChoice({ role: 'keep' });
  const state = { ...newMatch({ first: 'me' }), turn: 'opp' };
  const event = resolveKick(state, { shot: 'TL', save: null, timeout: true, stuck: choice.stuck }).history.at(-1);
  assert.equal(event.stuck, true);
  assert.equal(event.save, null);
  assert.equal(event.goal, true);
  assert.equal(event.timeout, true);
});

/* ------------------------------------------------------------------ *\
 * 4. 通信対戦: 時間切れの扱いが両者で一致する
 * ------------------------------------------------------------------ */

function captureClient(id, sent = []) {
  return {
    clientId: id,
    sent,
    broadcast: (name, event, payload) => { sent.push({ name, event, payload }); return true; },
    subscribe: () => {},
    unsubscribe: () => {},
    track: () => {},
  };
}

test('通信: キーパーが動けない（MISS を合図）と、両者が「棒立ちの失点」で一致する', () => {
  const events = [];
  const client = captureClient('me');
  const session = new ShootoutSession({ client, onEvent: (event) => events.push(event) });
  session.channel = 'shootout-match:me-other';
  session.matchName = session.channel;
  session.mySide = 'home';
  session.first = 'home';
  /* 1本目: 自分（home）が蹴る → 相手（away）は時間切れで動けない（OUT を送ってきた） */
  assert.equal(session.pick(0, 'TR'), true);
  session.handleBroadcast(session.channel, 'pick', { from: 'other', round: 0, dir: 'OUT' });
  const kick = events.filter((event) => event.type === 'kick').at(-1);
  assert.ok(kick, '1本が解決する');
  assert.equal(kick.shot, 'TR');
  assert.equal(kick.stuck, true);
  assert.equal(kick.save, null);
  assert.equal(kick.goal, true);
});

test('通信: キーパーが選んだ方向は、そのまま飛ぶ（棒立ちにしない）', () => {
  const events = [];
  const client = captureClient('me');
  const session = new ShootoutSession({ client, onEvent: (event) => events.push(event) });
  session.channel = 'shootout-match:me-other';
  session.matchName = session.channel;
  session.mySide = 'home';
  session.first = 'home';
  session.pick(0, 'TR');
  session.handleBroadcast(session.channel, 'pick', { from: 'other', round: 0, dir: 'TR' });
  const kick = events.filter((event) => event.type === 'kick').at(-1);
  assert.equal(kick.stuck, false);
  assert.equal(kick.save, 'TR');
  assert.equal(kick.goal, false, '同じ方向はセーブ');
});

test('通信: 蹴る側が選んだ方向で時間切れになっても、枠外にしない', () => {
  const events = [];
  const session = new ShootoutSession({ client: captureClient('me'), onEvent: (event) => events.push(event) });
  session.channel = 'shootout-match:me-other';
  session.matchName = session.channel;
  session.mySide = 'home'; /* 自分（home）が蹴る → 相手（away）がキーパー */
  session.first = 'home';
  const choice = timeoutChoice({ role: 'shoot', selection: 'BL' });
  assert.equal(session.pick(0, choice.dir, { timeout: choice.auto }), true);
  session.handleBroadcast(session.channel, 'pick', { from: 'other', round: 0, dir: 'TL' });
  const kick = events.filter((event) => event.type === 'kick').at(-1);
  assert.equal(kick.miss, false);
  assert.equal(kick.shot, 'BL');
  assert.equal(kick.goal, true);
});

/* ------------------------------------------------------------------ *\
 * 5. スタンプ・定型文
 * ------------------------------------------------------------------ */

test('スタンプ・定型文: 16個（スタンプ8・駆け引き4・リアクション4）で id は一意', () => {
  assert.equal(EMOTES.length, 16);
  assert.equal(new Set(EMOTES.map((emote) => emote.id)).size, 16);
  assert.deepEqual([...new Set(EMOTES.map((emote) => emote.kind))].sort(), ['react', 'stamp', 'taunt']);
  for (const section of EMOTE_SECTIONS) {
    assert.ok(EMOTES.some((emote) => emote.kind === section.kind), section.kind);
  }
  for (const emote of EMOTES) assert.ok(emote.face.length > 0 && emote.key.length > 0, emote.id);
  assert.equal(isEmoteId('taunt_left'), true);
  assert.equal(isEmoteId('wow'), true, '旧 Build 6 のスタンプも受信できる');
  assert.equal(isEmoteId('free text'), false);
  assert.equal(emoteById('nice_goal').key, 'emote_nice_goal');
  assert.equal(emoteById('unknown'), null);
});

test('スタンプ・定型文: 12言語すべてに文言がある（キー名が画面に出ない）', () => {
  const keys = [
    'emoteTray', ...EMOTE_SECTIONS.map((section) => section.label),
    ...EMOTE_WIRE_IDS.map((id) => emoteById(id).key),
  ];
  const missing = [];
  for (const language of LANGUAGES) {
    for (const key of keys) {
      const text = DICT[language]?.[key];
      if (typeof text !== 'string' || !text.trim()) missing.push(`${language}:${key}`);
    }
  }
  assert.deepEqual(missing, [], `翻訳が足りない: ${missing.slice(0, 6).join(' ')}`);

  /* 言語ごとに違う文言になっている（同じ英語の使い回しではない） */
  assert.equal(tr('ja', 'emote_taunt_left'), '左に蹴るよ？');
  assert.equal(tr('en', 'emote_taunt_left'), 'Going left, I swear');
  assert.equal(tr('ko', 'emote_nice_save'), '나이스 세이브🧤');
  assert.equal(LANGUAGE_TAGS.length, LANGUAGES.length);
});

test('スタンプ: 自由入力は送れない（許可リストとサイズ・4秒あき）', () => {
  const now = 100000;
  const allowed = EMOTE_WIRE_IDS;
  assert.equal(validateStamp({ from: 'a', id: 'taunt_read' }, { self: 'me', allowed, now }).ok, true);
  assert.equal(validateStamp({ from: 'a', id: 'ナイスゴール👍' }, { self: 'me', allowed, now }).ok, false);
  assert.equal(validateStamp({ from: 'a', id: 'wow' }, { self: 'me', allowed, now }).ok, true);
  assert.equal(validateStamp({ from: 'a', id: 'nice' }, { self: 'me', allowed, now, lastAt: now - 1000 }).ok, false);
  assert.equal(validateStamp({ from: 'me', id: 'nice' }, { self: 'me', allowed, now }).ok, false);
  assert.equal(validateStamp({ from: 'a', id: 'nice', text: 'x'.repeat(600) }, { self: 'me', allowed, now }).ok, false);
});

test('スタンプ: 送る側も許可リストの id 以外は送らない', () => {
  const sent = [];
  const session = new ShootoutSession({ client: captureClient('me', sent) });
  session.channel = 'shootout-match:me-other';
  session.matchName = session.channel;
  assert.equal(session.sendStamp('taunt_left'), true);
  assert.equal(session.sendStamp('自由入力のテキスト'), false);
  assert.equal(session.sendStamp(''), false);
  assert.deepEqual(sent.map((item) => item.event), ['stamp']);
  assert.equal(sent[0].payload.id, 'taunt_left');
});

test('スタンプ: CPU はときどき、その場に合ったリアクションを返す', () => {
  const always = cpuEmoteFor('conceded', { random: () => 0, chance: 1 });
  assert.ok(EMOTE_IDS.includes(always), always);
  assert.equal(cpuEmoteFor('conceded', { random: () => 0.99, chance: 0.45 }), null, '確率で間引く');
  for (const kind of ['conceded', 'cpuSave', 'cpuGoal', 'iSaved', 'iMiss']) {
    for (const id of ['conceded', 'cpuSave', 'cpuGoal', 'iSaved', 'iMiss'].map(() => cpuEmoteFor(kind, { random: () => 0, chance: 1 }))) {
      assert.ok(EMOTE_IDS.includes(id), `${kind} → ${id}`);
    }
  }
  assert.equal(cpuEmoteFor('unknown', { chance: 1 }), null);
});

test('試合画面: 右上（PK表の右）にスタンプボタンとトレイ、吹き出しがある', () => {
  const state = newMatch({ first: 'me' });
  const prefs = { country: 'JP', opponent: 'BR', sound: true, bgm: true };
  const view = matchView({ t: (key) => tr('ja', key), prefs, state, language: 'ja' });
  assert.match(view, /data-testid="emote-toggle"/);
  assert.match(view, /aria-controls="emote-tray"/);
  assert.match(view, /id="emote-tray"/);
  assert.match(view, /id="emote-bubble"/);
  for (const id of EMOTE_IDS) assert.match(view, new RegExp(`data-emote="${id}"`), id);
  assert.equal((view.match(/class="emotepill"/g) || []).length, 16);
  assert.doesNotMatch(view, /data-stamp=/, '旧スタンプバーは残っていない');
  assert.match(view, /左に蹴るよ？/);
  assert.match(view, /ナイスセーブ🧤/);
  /* PK表の行はトレイの外側で、ボタンは表の右に並ぶ */
  assert.match(view, /<div class="pkboard__rows">/);
  assert.ok(view.indexOf('emote-btn') > view.indexOf('pk-row-me'), 'ボタンはPK表の右');
});

test('試合画面: 12言語すべてでスタンプの文言が出る（キー名を出さない）', () => {
  const state = newMatch({ first: 'me' });
  const prefs = { country: 'JP', opponent: 'BR', sound: true, bgm: true };
  for (const language of LANGUAGES) {
    const view = matchView({ t: (key) => tr(language, key), prefs, state, language });
    assert.equal((view.match(/class="emotepill"/g) || []).length, 16, language);
    for (const emote of EMOTES) {
      const text = tr(language, emote.key);
      assert.ok(text && text !== emote.key, `${language}:${emote.id}`);
      assert.ok(view.includes(text.replace(/&/g, '&amp;')), `${language}:${emote.id} が画面にない`);
    }
  }
});

test('試合画面: スタンプの文言は必ずエスケープする', () => {
  const state = newMatch({ first: 'me' });
  const prefs = { country: 'JP', opponent: 'BR', sound: true, bgm: true };
  const view = matchView({ t: () => '<script>alert(1)</script>', prefs, state, language: 'ja' });
  assert.doesNotMatch(view, /<script>alert/);
  assert.match(view, /&lt;script&gt;/);
});
