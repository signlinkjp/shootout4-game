/**
 * SHOOTOUT 4 — Build 9 の検証
 *
 *  1. ビルド番号 9（v1.0.0）が全ファイルで揃っている
 *  2. キーパー視点はゴール真後ろ（x = 0）・高め。左右の符号は今までどおり
 *  3. シンキングタイムは8秒（設定・UI・12言語の遊び方/説明・通信の締め）
 *  4. 結果カード（720×900 PNG）のモデル・描画・共有の段取り
 *  5. 画像つき共有が使えない環境でもエラーで止まらない（段取りの順番）
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../vendor/three.module.min.js';

import { CONFIG } from '../src/config.js';
import { LANGUAGES, DICT } from '../src/i18n.js';
import { newMatch, resolveKick, mirrorDirection } from '../src/core/rules.js';
import { keeperOffsetFromRatio, ratioFromClientX } from '../src/core/controls.js';
import {
  CARD_WIDTH, CARD_HEIGHT, buildShareText, buildResultCardModel, pickShareStrategy,
  formatCardDate, cardFileName,
} from '../src/core/share.js';
import {
  drawResultCard, canvasToPngBlob, dataUrlToBlob, renderResultCard, resultCardFile,
} from '../src/ui/result-card.js';
import { ONLINE_TURN_MS } from '../src/net/online.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* ------------------------------------------------------------------ *\
 * 1. ビルド番号
 * ------------------------------------------------------------------ */

test('Build 11 / v1.0.0 が全ファイルで揃っている', () => {
  assert.equal(CONFIG.version, '1.0.0');
  assert.equal(CONFIG.build, 11);
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.deepEqual([...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => match[1]), ['11', '11']);
  assert.equal((pbx.match(/MARKETING_VERSION = 1\.0\.0;/g) || []).length, 2);
  assert.match(read('package.json'), /Build 11/);
  assert.match(read('src/config.js'), /build: 11/);
  assert.match(read('README.md'), /v1\.0\.0 \/ Build 11/);
  assert.match(read('docs/ios-testflight.yml'), /TestFlight Build 11/);
  assert.match(read('docs/testflight-setup.md'), /\*\*11\*\*/);
  /* 貼り替え用のワークフロー（docs）が8秒。実ファイル .github/... は GitHub の
     workflows 権限が無いため、トモアキさんがこの docs を貼り替える */
  assert.match(read('docs/ios-testflight.yml'), /roundSeconds: 8/);
  assert.match(read('docs/ios-testflight.yml'), /8秒・4択・5本/);
});

/* ------------------------------------------------------------------ *\
 * 2. キーパー視点（ゴール真後ろ・高め）
 * ------------------------------------------------------------------ */

function keeperCamera() {
  const stadium = read('src/three/stadium.js');
  const match = stadium.match(/keep: \{ pos: new THREE\.Vector3\(([-\d.]+), ([-\d.]+), ([-\d.]+)\), look: new THREE\.Vector3\(([-\d.]+), ([-\d.]+), ([-\d.]+)\), fov: (\d+)/);
  assert.ok(match, 'keep カメラの定義');
  const [x, y, z, lx, ly, lz, fov] = match.slice(1).map(Number);
  const camera = new THREE.PerspectiveCamera(fov, 393 / 852, 0.1, 500);
  camera.position.set(x, y, z);
  camera.lookAt(new THREE.Vector3(lx, ly, lz));
  camera.updateMatrixWorld(true);
  return { camera, x, y, z, lx, ly, lz, fov };
}

test('キーパー視点はゴールの真後ろ（x = 0）・高め（Build 9）', () => {
  const { x, y, z, lx, ly, lz, fov } = keeperCamera();
  assert.equal(x, 0, '真後ろ');
  assert.equal(lx, 0, '真っ直ぐ前を見る');
  assert.ok(y >= 4.5 && y <= 5.2, `高め: y=${y}`);
  assert.ok(z <= -19, `ゴール裏へ引く: z=${z}`);
  assert.ok(ly > 0 && ly < 1.5, `見る高さ: y=${ly}`);
  assert.ok(lz > z + 10, `ピッチ側を見る: z=${lz}`);
  assert.equal(fov, 60);
  /* カメラの向きは +Z（キッカー方向）のまま＝画面の右はワールドの -X */
  const forward = new THREE.Vector3();
  keeperCamera().camera.getWorldDirection(forward);
  assert.ok(forward.z > 0.9, `+Z を見る: ${forward.z}`);
});

test('真後ろのカメラでも「指を右 → 画面の右」（符号の反転）が成り立つ', () => {
  assert.equal(keeperOffsetFromRatio(1), -1);
  assert.equal(keeperOffsetFromRatio(-1), 1);
  assert.equal(ratioFromClientX(200, { left: 0, width: 200 }), 1);

  const { camera } = keeperCamera();
  const half = Number(read('src/three/stadium.js').match(/const GOAL_HALF = ([\d.]+);/)[1]);
  const range = half - 0.55;
  const screenX = (offset) => new THREE.Vector3(offset * range, 0.9, -8.15).project(camera).x;
  const left = keeperOffsetFromRatio(-0.9);
  const right = keeperOffsetFromRatio(0.9);
  assert.ok(screenX(left) < screenX(0), `左: ${screenX(left)}`);
  assert.ok(screenX(right) > screenX(0), `右: ${screenX(right)}`);
  /* 真後ろなので、ゴール幅いっぱいでも画面の外へはみ出さない */
  assert.ok(Math.abs(screenX(keeperOffsetFromRatio(1))) < 1, '右ポスト側が画面内');
  assert.ok(Math.abs(screenX(keeperOffsetFromRatio(-1))) < 1, '左ポスト側が画面内');
  /* キッカー側（+Z から -Z）では、キーパーの右は画面の左 */
  const shoot = read('src/three/stadium.js')
    .match(/shoot: \{ pos: new THREE\.Vector3\(([-\d.]+), ([-\d.]+), ([-\d.]+)\), look: new THREE\.Vector3\(([-\d.]+), ([-\d.]+), ([-\d.]+)\), fov: (\d+)/)
    .slice(1).map(Number);
  const shooterCamera = new THREE.PerspectiveCamera(shoot[6], 393 / 852, 0.1, 500);
  shooterCamera.position.set(shoot[0], shoot[1], shoot[2]);
  shooterCamera.lookAt(new THREE.Vector3(shoot[3], shoot[4], shoot[5]));
  shooterCamera.updateMatrixWorld(true);
  const shooterX = (offset) => new THREE.Vector3(offset * range, 0.9, -8.15).project(shooterCamera).x;
  assert.ok(shooterX(keeperOffsetFromRatio(1)) < shooterX(0), 'キッカー側では左に見える');
  assert.ok(shooterX(keeperOffsetFromRatio(-1)) > shooterX(0));
  assert.equal(mirrorDirection('TL'), 'TR');
});

/* ------------------------------------------------------------------ *\
 * 3. シンキングタイム 8秒
 * ------------------------------------------------------------------ */

test('シンキングタイムは8秒（設定・UI・通信の締め）', () => {
  assert.equal(CONFIG.roundSeconds, 8);
  assert.equal(ONLINE_TURN_MS, 8000);
  assert.match(read('src/ui/match.js'), /CONFIG\.roundSeconds\}s/);
  assert.match(read('tools/verify-ios-project.mjs'), /roundSeconds: 8/);
  assert.doesNotMatch(read('src/config.js'), /roundSeconds: 7/);
  assert.doesNotMatch(read('src/net/online.js'), /ONLINE_TURN_MS = 7000/);
});

test('12言語の遊び方・説明が「8秒」に揃っている（7秒の残りが無い）', () => {
  assert.equal(LANGUAGES.length, 12);
  const seven = /(^|[^0-9])7([^0-9]|$)|七|seven|sept|sieben|sette|siete|tujuh|เจ็ด/i;
  const eight = /8|八|eight|huit|acht|otto|ocho|delapan|แปด/i;
  const problems = [];
  for (const language of LANGUAGES) {
    const dict = DICT[language] || {};
    for (const key of ['rulesText', 'handoverShootHint']) {
      const text = String(dict[key] || '');
      if (!text) problems.push(`${language}:${key} 空`);
      else if (seven.test(text)) problems.push(`${language}:${key} に7が残る`);
      else if (!eight.test(text)) problems.push(`${language}:${key} に8が無い`);
    }
  }
  assert.deepEqual(problems, []);
  /* 代表的な言語で、実際の文言を確認する */
  assert.match(DICT.ja.handoverShootHint, /8秒/);
  assert.match(DICT.en.handoverShootHint, /8 seconds/);
  assert.match(DICT.de.handoverShootHint, /8 Sekunden/);
  assert.match(DICT.th.handoverShootHint, /8 วินาที/);
  assert.match(DICT['zh-Hans'].rulesText, /8秒/);
  assert.match(DICT['zh-Hant'].rulesText, /8秒/);
});

/* ------------------------------------------------------------------ *\
 * 4. 結果カード（モデル）
 * ------------------------------------------------------------------ */

const PREFS = { country: 'JP', opponent: 'BR' };

test('結果カードのモデル: 720×900・勝敗・スコア・PKの○×・日時・戦績', () => {
  const state = {
    first: 'me',
    kicks: { me: [true, false, true, true, false], opp: [false, true, false, false, true] },
    score: { me: 3, opp: 2 },
    history: [],
    winner: 'me',
  };
  const model = buildResultCardModel({
    state,
    prefs: PREFS,
    language: 'ja',
    t: (key, vars) => {
      const table = { victory: '勝利', defeat: '敗北', matchSummary: '試合結果', suddenDeath: 'サドンデス', firstKick: '先攻', secondKick: '後攻', rankRecord: '{wins}勝{losses}敗 · 勝率{rate}%' };
      const value = table[key] ?? key;
      return vars ? Object.entries(vars).reduce((text, [name, item]) => text.replaceAll(`{${name}}`, String(item)), value) : value;
    },
    record: { played: 10, wins: 7, losses: 3 },
    date: new Date(2026, 10, 27, 19, 42),
  });
  assert.equal(model.width, CARD_WIDTH);
  assert.equal(model.height, CARD_HEIGHT);
  assert.equal(CARD_WIDTH, 720);
  assert.equal(CARD_HEIGHT, 900);
  assert.equal(model.win, true);
  assert.equal(model.headline, '勝利');
  assert.equal(model.eyebrow, '試合結果');
  assert.deepEqual(model.score, { me: 3, opp: 2 });
  assert.equal(model.sides.me.name, '日本');
  assert.equal(model.sides.opp.name, 'ブラジル');
  assert.equal(model.sides.me.code, 'JP');
  assert.match(model.sides.me.flag, /assets\/flags\/jp-96\.png$/);
  assert.equal(model.rounds, 5);
  assert.deepEqual(model.cells.me, ['goal', 'miss', 'goal', 'goal', 'miss']);
  assert.deepEqual(model.cells.opp, ['miss', 'goal', 'miss', 'miss', 'goal']);
  assert.equal(model.date, '2026.11.27 19:42');
  assert.equal(model.info, '7勝3敗 · 勝率70%');
  assert.match(model.tags, /#SHOOTOUT4/);
  assert.match(model.footer, /SHOOTOUT 4/);
  assert.equal(model.build, 11);
});

test('結果カードのモデル: サドンデスは本数が増え、通信対戦は勝ち点を出す', () => {
  const state = {
    first: 'opp',
    kicks: { me: [true, true, true, true, true, true], opp: [true, true, true, true, true, false] },
    score: { me: 6, opp: 5 },
    history: [],
    winner: 'me',
  };
  const model = buildResultCardModel({
    state,
    prefs: PREFS,
    language: 'ja',
    t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
    standing: { total: { points: 15 } },
    online: true,
    date: new Date(2026, 10, 27, 19, 42),
  });
  assert.equal(model.sudden, true);
  assert.equal(model.rounds, 6);
  assert.equal(model.cells.me.length, 6);
  assert.equal(model.sides.opp.order, 'firstKick');
  assert.match(model.eyebrow, /suddenDeath/);
  assert.match(model.info, /points/);
  assert.match(model.info, /\+2/);
  assert.match(model.info, /15/);
});

test('カードのファイル名・日時（日本時間の端末時刻）', () => {
  const date = new Date(2026, 0, 5, 8, 3);
  assert.equal(formatCardDate(date), '2026.01.05 08:03');
  assert.equal(cardFileName(date), 'shootout4-result-20260105-0803.png');
  assert.equal(formatCardDate(null), '');
});

test('シェア文面: 国旗・勝敗・スコア・本数・ハッシュタグ', () => {
  const state = {
    first: 'me',
    kicks: { me: [true, true, true, true, true, true], opp: [false, false, false, false, false, true] },
    score: { me: 6, opp: 1 },
    history: [],
    winner: 'me',
  };
  const text = buildShareText({
    t: (key, vars) => (vars ? `${key}${vars.kicks}` : key),
    state,
    prefs: PREFS,
    language: 'ja',
  });
  assert.match(text, /🇯🇵/);
  assert.match(text, /🇧🇷/);
  assert.match(text, /victory/);
  assert.match(text, /6-1/);
  assert.match(text, /shareSudden6/);
  assert.match(text, /日本 vs ブラジル/);
  assert.match(text, /#SHOOTOUT4 #IPKSF/);
});

/* ------------------------------------------------------------------ *\
 * 5. 結果カード（描画・PNG・共有）
 * ------------------------------------------------------------------ */

function mockContext() {
  const calls = [];
  const gradient = (kind) => ({ kind, addColorStop: () => {} });
  const ctx = {
    calls,
    measureText(text) {
      const match = /(\d+(?:\.\d+)?)px/.exec(String(ctx.font));
      const size = match ? Number(match[1]) : 16;
      return { width: [...String(text)].length * size * 0.56 };
    },
    createLinearGradient: (...args) => gradient(`linear:${args.join(',')}`),
    createRadialGradient: (...args) => gradient(`radial:${args.join(',')}`),
  };
  for (const name of [
    'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'rect',
    'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText',
    'drawImage', 'translate', 'rotate', 'scale', 'setTransform', 'quadraticCurveTo',
  ]) {
    ctx[name] = (...args) => { calls.push({ name, args }); };
  }
  for (const key of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'textAlign', 'textBaseline', 'shadowColor',
    'shadowBlur', 'globalAlpha', 'lineCap', 'font',
  ]) {
    let value = key === 'font' ? '700 16px sans-serif' : '';
    Object.defineProperty(ctx, key, {
      get: () => value,
      set: (next) => { value = next; },
      enumerable: true,
      configurable: true,
    });
  }
  return ctx;
}

function cardModel(overrides = {}) {
  return buildResultCardModel({
    state: {
      first: 'me',
      kicks: { me: [true, true, false, true, true], opp: [false, true, true, false, false] },
      score: { me: 4, opp: 2 },
      history: [],
      winner: 'me',
    },
    prefs: PREFS,
    language: 'ja',
    t: (key, vars) => {
      const table = { victory: '勝利', defeat: '敗北', matchSummary: '試合結果', suddenDeath: 'サドンデス', firstKick: '先攻', secondKick: '後攻', rankRecord: '{wins}勝{losses}敗 · 勝率{rate}%' };
      const value = table[key] ?? key;
      return vars ? Object.entries(vars).reduce((text, [name, item]) => text.replaceAll(`{${name}}`, String(item)), value) : value;
    },
    date: new Date(2026, 10, 27, 19, 42),
    ...overrides,
  });
}

test('描画: 720×900 の中で、ロゴ・勝敗・スコア・PK表・ハッシュタグを描き切る（例外なし）', () => {
  const ctx = mockContext();
  const model = cardModel();
  assert.equal(drawResultCard(ctx, model), true);

  const texts = ctx.calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
  const joined = texts.join('｜');
  assert.match(joined, /I｜P｜K｜S｜F/, 'ロゴ');
  assert.match(joined, /SHOOTOUT 4/);
  assert.match(joined, /勝利/, '勝敗見出し');
  assert.match(joined, /4|2/, 'スコア');
  assert.match(joined, /日本/);
  assert.match(joined, /ブラジル/);
  assert.match(joined, /#｜S｜H｜O｜O｜T｜O｜U｜T｜4/);
  assert.match(joined, /2026\.11\.27 19:42/);

  /* 描いた文字・図形がキャンバスの外へ出ていない */
  const outside = [];
  for (const call of ctx.calls) {
    if (call.name === 'fillText') {
      const [value, x, y] = call.args;
      if (!(x >= -2 && x <= CARD_WIDTH + 2 && y >= 0 && y <= CARD_HEIGHT)) outside.push({ value, x, y });
    }
    /* fillRect は translate 後の局所座標（中央の菱形）でも使うので、位置の検査はしない */
    if (call.name === 'arc') {
      const [x, y, radius] = call.args;
      if (x - radius < -2 || y - radius < -2 || x + radius > CARD_WIDTH + 2 || y + radius > CARD_HEIGHT + 2) outside.push({ name: 'arc', x, y, radius });
    }
  }
  assert.deepEqual(outside, [], 'キャンバスの外に描いていない');

  /* ○（goal）と×（miss）が本数ぶん描かれている */
  const arcs = ctx.calls.filter((call) => call.name === 'arc').length;
  /* ゴール6本の○（半径12）＋エンブレムの円 */
  const goalRings = ctx.calls.filter((call) => call.name === 'arc' && Math.abs(Number(call.args[2]) - 12) < 0.01).length;
  assert.equal(goalRings, 6, '○は決めた本数ぶん');
  assert.ok(arcs >= 8, `円（○・ボール・エンブレム）: ${arcs}`);
  const strokes = ctx.calls.filter((call) => call.name === 'stroke').length;
  assert.ok(strokes >= 20, `線: ${strokes}`);
});

test('描画: 敗北・サドンデス・長い国名でも収まる', () => {
  const ctx = mockContext();
  const model = cardModel({
    state: {
      first: 'opp',
      kicks: { me: [false, false, false, true, false, false, false], opp: [true, true, true, true, true, true, true] },
      score: { me: 1, opp: 7 },
      history: [],
      winner: 'opp',
    },
    language: 'en',
    t: (key) => ({ victory: 'VICTORY', defeat: 'DEFEAT', matchSummary: 'Match result', suddenDeath: 'Sudden death', firstKick: 'First', secondKick: 'Second', rankRecord: '{wins}W {losses}L · {rate}% win rate' }[key] ?? key),
  });
  assert.equal(model.sudden, true);
  assert.equal(model.rounds, 7);
  assert.equal(drawResultCard(ctx, model), true);
  const texts = ctx.calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
  assert.ok(texts.includes('DEFEAT'));
  assert.ok(texts.includes('7'));
  /* 7本を超えたら、最後の7本だけを描く（列は増やさない） */
  const wide = cardModel({
    state: {
      first: 'me',
      kicks: { me: Array(9).fill(true), opp: Array(9).fill(false) },
      score: { me: 9, opp: 0 },
      history: [],
      winner: 'me',
    },
  });
  const wideCtx = mockContext();
  assert.equal(drawResultCard(wideCtx, wide), true);
  assert.ok(wideCtx.calls.filter((call) => call.name === 'fillText').some((call) => String(call.args[0]).startsWith('+2')));
});

test('PNG: Blob（image/png）を作り、toBlob が無い環境は dataURL から作る', async () => {
  const bytes = Uint8Array.from(atob(PNG_1X1), (character) => character.charCodeAt(0));
  const blobCanvas = {
    toBlob(callback, type) {
      assert.equal(type, 'image/png');
      callback(new Blob([bytes], { type: 'image/png' }));
    },
  };
  const blob = await canvasToPngBlob(blobCanvas);
  assert.equal(blob.type, 'image/png');
  assert.equal(blob.size, bytes.length);
  const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 8);
  assert.deepEqual([...head], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const dataUrlCanvas = { toDataURL: () => `data:image/png;base64,${PNG_1X1}` };
  const fromUrl = await canvasToPngBlob(dataUrlCanvas);
  assert.equal(fromUrl.type, 'image/png');
  assert.equal(fromUrl.size, bytes.length);

  assert.equal(await canvasToPngBlob({ toBlob: (callback) => callback(null) }), null);
  assert.equal(await canvasToPngBlob(null), null);
  assert.equal(dataUrlToBlob('data:image/jpeg;base64,AAAA'), null);
});

test('renderResultCard: Canvas を作って描き、PNG を返す（描画エラーなし）', async () => {
  const ctx = mockContext();
  const png = Uint8Array.from(atob(PNG_1X1), (character) => character.charCodeAt(0));
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind) => (kind === '2d' ? ctx : null),
    toBlob: (callback) => callback(new Blob([png], { type: 'image/png' })),
  };
  const doc = { createElement: (tag) => { assert.equal(tag, 'canvas'); return canvas; } };
  const model = cardModel();
  const result = await renderResultCard(model, { doc, images: {} });
  assert.equal(result.canvas, canvas);
  assert.equal(canvas.width, 720);
  assert.equal(canvas.height, 900);
  assert.equal(result.blob.type, 'image/png');
  assert.ok(result.blob.size > 0);

  const file = resultCardFile(result.blob, new Date(2026, 10, 27, 19, 42));
  assert.equal(file.type, 'image/png');
  assert.equal(file.name, 'shootout4-result-20261127-1942.png');
  assert.equal(resultCardFile(null), null);
});

test('共有の段取り: 画像つき → 文面 → コピー → 保存 → 画面表示 の順に落ちる', () => {
  assert.deepEqual(pickShareStrategy({ hasShare: true, hasFiles: true, canShareFiles: true, hasClipboard: true }), ['share-image', 'share-text', 'clipboard']);
  assert.deepEqual(pickShareStrategy({ hasShare: true, hasFiles: true, canShareFiles: false, hasClipboard: true }), ['share-text', 'clipboard']);
  assert.deepEqual(pickShareStrategy({ hasShare: true, hasFiles: false, canShareFiles: false, hasClipboard: true, canDownload: true }), ['share-text', 'clipboard']);
  assert.deepEqual(pickShareStrategy({ hasShare: false, hasFiles: true, hasClipboard: true, canDownload: true }), ['clipboard', 'download']);
  assert.deepEqual(pickShareStrategy({ hasShare: false, hasFiles: false, hasClipboard: false }), ['show']);
  /* 何も無い環境でも必ず1つは手段がある（エラーで止まらない） */
  assert.ok(pickShareStrategy({}).length >= 1);
});

test('main.js は結果カードを共有し、失敗しても次の手段へ進む', () => {
  const main = read('src/main.js');
  assert.match(main, /renderResultCard/);
  assert.match(main, /pickShareStrategy/);
  assert.match(main, /files: \[card\.file\]/);
  assert.match(main, /await nav\.share\(\{ title, text \}\)/);
  assert.match(main, /nav\.clipboard\.writeText\(text\)/);
  assert.match(main, /AbortError/);
  assert.match(main, /downloadBlob/);
  assert.equal(existsSync(resolve(ROOT, 'src/core/share.js')), true);
  assert.equal(existsSync(resolve(ROOT, 'src/ui/result-card.js')), true);
});
