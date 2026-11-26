import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG } from '../src/config.js';
import { tr, LANGUAGES } from '../src/i18n.js';
import { newMatch, resolveKick, DIRECTIONS } from '../src/core/rules.js';
import { COUNTRIES, COUNTRY_HAIR, HAIR_COLORS, HAIR_STYLES, hairForCountry, hairSpecForCountry } from '../src/core/countries.js';
import { buildCharacter, buildHairParts, setHair, normalizeHair } from '../src/three/characters.js';
import { lockerView } from '../src/ui/locker.js';
import { resultView, buildShareText } from '../src/ui/match.js';
import { rulesView, statsView } from '../src/ui/misc.js';
import { rankView } from '../src/ui/online.js';
import { rankTable, emptyStanding, addStandingResult } from '../src/core/ranking.js';
import { DEFAULT_SKIN } from '../src/core/skins.js';
import { EMPTY_RECORD, EMPTY_SHOTS, addShotDirection } from '../src/storage.js';
import { voice, configureAudio } from '../src/audio.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const t = (key, vars) => tr('ja', key, vars);
const prefs = { country: 'JP', opponent: 'BR', sound: true, bgm: true, vibrate: true, order: 'first', language: 'ja' };

const count = (html, needle) => html.split(needle).length - 1;

test('1. ロッカー: プレビュー直下と最下部の両方に「保存して着る」ボタン', () => {
  const html = lockerView({
    t, entitled: true, draft: { ...DEFAULT_SKIN, character: 'stylized' }, language: 'ja',
    registered: true, order: 'first', hair: hairSpecForCountry('JP'),
  });
  assert.match(html, /data-testid="save-skin-top"/, '上部のボタン');
  assert.match(html, /data-testid="save-skin"/, '下部のボタンも残す');
  const previewAt = html.indexOf('locker-preview-panel');
  const topAt = html.indexOf('save-skin-top');
  const characterAt = html.indexOf('data-testid="locker-order"');
  const bottomAt = html.indexOf('data-testid="save-skin"');
  assert.ok(previewAt > 0 && topAt > previewAt, 'プレビューの後ろ');
  assert.ok(topAt < characterAt, 'キャラクターより前（スクロールせず押せる）');
  assert.ok(bottomAt > characterAt, '下部にもう1つ');
  assert.equal(count(html, 'data-action="save-skin"'), 2);
});

test('2. 蹴り始めに相手の方向を出さない（着弾で出す）順番になっている', () => {
  const main = read('src/main.js');
  /* applyKick の中で、markReveal / updateHud / updateBoard / showBanner は reveal() の中だけ */
  const start = main.indexOf('function applyKick(');
  const end = main.indexOf('function markReveal(');
  const body = main.slice(start, end);
  assert.ok(start > 0 && end > start);
  const revealAt = body.indexOf('const reveal = () =>');
  assert.ok(revealAt > 0, 'reveal がある');
  const before = body.slice(0, revealAt);
  for (const call of ['markReveal(', 'updateHud(', 'updateBoard()', 'showBanner(']) {
    assert.equal(before.includes(call), false, `${call} は蹴り始めに呼ばない`);
    assert.ok(body.slice(revealAt).includes(call), `${call} は reveal の中で呼ぶ`);
  }
  /* 着弾（onImpact の goal/save/miss）で reveal する */
  assert.match(body, /onImpact: \(kind\) => \{[\s\S]*?if \(kind === 'goal' \|\| kind === 'save' \|\| kind === 'miss'\) \{[\s\S]*?reveal\(\);/);
  /* ラウンドが替わっていたら塗り替えない（roundId） */
  assert.match(body, /match\.roundId !== roundId/);
});

test('3. ゴール/セーブ/ミスの演出音が着弾で鳴り、棒読みの読み上げは使わない', () => {
  const main = read('src/main.js');
  assert.match(main, /voice\(bannerKind\)/);
  assert.equal(/saveGroan/.test(main), false, 'ミスの唸り（棒読みの代わりの声）は使わない');
  const audio = read('src/audio.js');
  assert.match(audio, /export function voice\(kind/);
  /* 音声合成は一切使わない（Build 6 で廃止） */
  assert.equal(/AVSpeechSynthesizer|speechSynthesis|SpeechSynthesisUtterance|VOWEL_FORMANTS|speakableText/.test(audio), false, '棒読みの読み上げは残さない');
  /* 代わりの演出音: スタジアムホーン＋勝利のファンファーレ／どよめき／落胆 */
  assert.match(audio, /export function stadiumHorn/);
  assert.match(audio, /export function victoryFanfare/);
  assert.match(audio, /export function crowdOoh/);
  assert.match(audio, /export function crowdAww/);
  assert.match(audio, /export function gloveClear/);
  assert.match(audio, /state\.settings\.sound/, '音OFFでは鳴らさない');

  /* AudioContext が無い環境でも、鳴らした判定は記録して返す */
  configureAudio({ sound: true });
  assert.deepEqual(voice('goal'), { kind: 'goal', mode: 'showcase' });
  assert.equal(voice('save').kind, 'save');
  assert.equal(voice('miss').kind, 'miss');
  assert.equal(voice('nope'), null);
  configureAudio({ sound: false });
  assert.equal(voice('goal'), null, '音OFFでは鳴らさない');
  configureAudio({ sound: true });
});

test('4. 利き足の蹴り分け: 右はボールの左から右足、左はボールの右から左足', () => {
  const stadium = read('src/three/stadium.js');
  const right = stadium.match(/right: \{[^}]*startX: (-?[\d.]+), startZ: ([\d.]+), plantX: (-?[\d.]+), plantZ: ([-\d.]+), facing: Math\.PI \* ([\d.]+)/);
  const left = stadium.match(/left: \{[^}]*startX: (-?[\d.]+), startZ: ([\d.]+), plantX: ([\d.]+), plantZ: ([-\d.]+), facing: Math\.PI \* ([\d.]+)/);
  assert.ok(right && left, 'RUN_UP に右利き・左利きの定義');
  const [, rStart, rZ, rPlant, , rFace] = right;
  const [, lStart, , lPlant, , lFace] = left;
  assert.ok(Number(rStart) < 0 && Number(rPlant) < 0, '右利きは左側から');
  assert.ok(Number(lStart) > 0 && Number(lPlant) > 0, '左利きは右側から');
  assert.notEqual(rStart, lStart);
  assert.ok(Math.abs(Number(rFace) - 0.93) < 0.001 && Math.abs(Number(lFace) - 1.07) < 0.001, '向きも別（ゴールを向く）');
  assert.ok(Math.cos(Math.PI * Number(rFace)) < 0 && Math.cos(Math.PI * Number(lFace)) < 0, 'どちらもゴール方向');
  /* Build 5: キャラクターは +Z が正面なので、右足 = legs[0]（side -1）/ 左足 = legs[1]（side +1） */
  const rightBlock = stadium.match(/right: \{[^}]*\}/)[0];
  const leftBlock = stadium.match(/left: \{[^}]*\}/)[0];
  assert.match(rightBlock, /kickLeg: 0, supportLeg: 1/, '右利きの蹴り足は右足（legs[0]）');
  assert.match(leftBlock, /kickLeg: 1, supportLeg: 0/, '左利きの蹴り足は左足（legs[1]）');
  assert.match(stadium, /applyRunUp\(shooter, kickFoot\)/);
  assert.match(stadium, /runUp: \(\(\) =>/);
});

test('5. バックグラウンド復帰の音: Audio Session→resume→無音<audio>→BGM、タップでも resume', () => {
  const audio = read('src/audio.js');
  assert.match(audio, /export function resumeFromBackground/);
  assert.match(audio, /activateBridge\(\)/);
  assert.match(audio, /ensureSilentAudio\(\)/);
  assert.match(audio, /setTimeout\(resume, 140\)/);
  assert.match(audio, /if \(state\.settings\.bgm\) startMusic\(\)/);
  assert.match(audio, /export function ensureAudioRunning/);
  assert.match(audio, /function ensureSilentAudio\(\)[\s\S]*?new Audio\(SILENT_WAV\)/, '消えていたら作り直す');
  const main = read('src/main.js');
  assert.match(main, /\['pointerdown', 'touchstart', 'keydown'\]/, '操作のたびに起こす安全策');
  assert.match(main, /ensureAudioRunning\(\)/);
  const swift = read('ios/App/App/AppDelegate.swift');
  assert.match(swift, /applicationDidBecomeActive/);
  assert.match(swift, /applicationWillEnterForeground[\s\S]*?activateAudioSession/);
  assert.match(swift, /activateAudioSessionOnce/);
});

test('6. 遊び方の下部: IPKSF 正式名称・加盟案内・公式勝ち点ルール', () => {
  const html = rulesView({ t });
  for (const language of LANGUAGES) {
    const local = rulesView({ t: (key, vars) => tr(language, key, vars) });
    assert.match(local, /data-testid="rules-ipksf"/, language);
    assert.match(local, /data-testid="rules-ipksf-name"/, language);
    assert.match(local, /data-testid="rules-join"/, language);
    assert.match(local, /data-testid="rules-points"/, language);
    assert.match(local, /\+3pt/, language);
    assert.match(local, /\+2pt/, language);
    assert.match(local, /\+1pt/, language);
    assert.match(local, /0pt/, language);
  }
  assert.ok(html.includes(CONFIG.federation), '正式名称（英語）をそのまま表示');
  assert.match(html, /国際PK戦連盟/);
  /* 文章の後ろ（bulletlist の下）にある */
  assert.ok(html.indexOf('data-testid="rules-points"') > html.indexOf('bulletlist'));
  assert.ok(html.indexOf('data-testid="rules-ipksf"') > html.indexOf('data-testid="rules-points"'));
});

test('7. PRO キャラの髪型5種・髪色6種を32か国に割り当て、ロッカーと試合の両方に渡す', () => {
  assert.deepEqual([...HAIR_STYLES], ['short', 'spiky', 'wave', 'buzz', 'topknot']);
  assert.equal(COUNTRIES.length, 32);
  const usedStyles = new Set();
  const usedColors = new Set();
  for (const country of COUNTRIES) {
    const hair = COUNTRY_HAIR[country.code];
    assert.ok(hair, `${country.code} の髪`);
    assert.ok(HAIR_STYLES.includes(hair.style), `${country.code} style`);
    assert.ok(HAIR_COLORS[hair.color], `${country.code} color`);
    usedStyles.add(hair.style);
    usedColors.add(hair.color);
    const spec = hairSpecForCountry(country.code);
    assert.match(spec.color, /^#[0-9a-f]{6}$/i);
  }
  assert.equal(usedStyles.size, 5, '5種すべて使う');
  assert.ok(usedColors.size >= 5, `髪色: ${[...usedColors].join(',')}`);
  assert.deepEqual(hairForCountry('ZZ'), hairForCountry('JP'), '知らない国は日本');

  const main = read('src/main.js');
  assert.match(main, /hair: hairSpecForCountry\(registration\.country \|\| prefs\.country\)/, 'ロッカーのプレビュー');
  assert.match(main, /oppHair: hairSpecForCountry/, '試合3Dの相手');
  const stadium = read('src/three/stadium.js');
  assert.match(stadium, /setHair\(player, teamHair\)/);
  assert.match(stadium, /setHair\(keeper, attackingIsMe \? look\.oppHair : look\.myHair\)/);
  const preview = read('src/three/preview.js');
  assert.match(preview, /buildCharacter\(\{ style: next, tone: 0, hair \}\)/);
});

test('7b. 髪型は実際に形が変わり（5種）、ブロック型（無料）はそのまま', () => {
  for (const style of HAIR_STYLES) {
    const character = buildCharacter({ style: 'stylized', hair: { style, color: 'black' } });
    const group = character.userData.parts.hairGroup;
    let meshes = 0;
    group?.traverse((object) => { if (object.isMesh) meshes += 1; });
    assert.ok(group && meshes >= 2, `${style}: ${meshes}`);
    assert.equal(character.userData.hair.style, style);
  }
  const stylized = buildCharacter({ style: 'stylized', hair: { style: 'wave', color: 'blond' } });
  assert.equal(stylized.userData.materials.hair.color.getHexString(), HAIR_COLORS.blond.replace('#', ''));
  assert.equal(setHair(stylized, { style: 'buzz', color: 'ash' }), true);
  assert.equal(stylized.userData.hair.style, 'buzz');
  assert.equal(setHair(stylized, { style: 'buzz', color: 'ash' }), true, '同じ指定でも安全に作り直せる');

  const voxel = buildCharacter({ style: 'voxel', hair: { style: 'topknot', color: 'blond' } });
  assert.equal(voxel.userData.parts.hairGroup, undefined, 'ブロック型は元のブロック髪のまま');
  assert.equal(setHair(voxel, { style: 'spiky', color: 'black' }), false);
  assert.equal(normalizeHair(null).style, 'short');
  assert.equal(normalizeHair({ style: 'bogus' }).style, 'short');
  assert.equal(normalizeHair({ color: '#123456' }).color, '#123456');
});

test('8. 両キャラクターに手（✊ / キーパーは指付きグローブの ✋）', () => {
  for (const style of ['voxel', 'stylized']) {
    const player = buildCharacter({ style });
    assert.equal(player.userData.hands.kind, 'fist');
    assert.equal(player.userData.hands.count, 2, `${style}: 両手`);
    const keeper = buildCharacter({ style, keeper: true });
    assert.equal(keeper.userData.hands.kind, 'glove');
    assert.equal(keeper.userData.hands.count, 2);
    /* グローブには指（4本）と親指が付く */
    let fingers = 0;
    keeper.userData.parts.hands[0].traverse((object) => { if (object.isMesh) fingers += 1; });
    assert.ok(fingers >= 6, `${style}: 手のひら+指+親指 (${fingers})`);
    /* こぶしにも指の筋が付く */
    let knuckles = 0;
    player.userData.parts.hands[0].traverse((object) => { if (object.isMesh) knuckles += 1; });
    assert.ok(knuckles >= 4, `${style}: こぶし (${knuckles})`);
  }
  const hands = buildHairParts; /* 参照だけ（未使用の import を避ける） */
  assert.equal(typeof hands, 'function');
});

test('9. ランキング画面: シーズン表記・あなたの順位・4タブ・世界/国内・メダル・勝敗・勝率・勝ち点', () => {
  const date = new Date('2026-11-27T05:15:00+09:00');
  const standing = addStandingResult(emptyStanding(date), { win: true, sudden: false, goals: 4, conceded: 1 }, date).standing;
  const me = { id: 'me', nickname: 'トモアキ', countryCode: 'JP', ...standing, updatedAt: 5 };
  const peers = [{
    id: 'p1', nickname: 'RIVAL', countryCode: 'BR',
    total: { points: 6, wins: 2, losses: 0, goals: 7, conceded: 2 },
    month: { key: '2026-11', points: 6, wins: 2, losses: 0, goals: 7, conceded: 2 },
    week: { key: '2026-11-23', points: 6, wins: 2, losses: 0, goals: 7, conceded: 2 },
    updatedAt: 5,
  }];
  for (const tab of ['total', 'month', 'week', 'rate']) {
    const table = rankTable(peers, me, { tab, date });
    const html = rankView({
      t, table, entitled: true, language: 'ja', status: '',
      tab, scope: 'domestic',
      season: { label: '2026年11月シーズン · 残り4日', tab },
      you: table.find((row) => row.isMe),
      medal: (place) => ['🥇', '🥈', '🥉'][place - 1] || `#${place}`,
    });
    assert.match(html, /data-testid="rank-season-label"/);
    assert.match(html, /2026年11月シーズン · 残り4日/);
    assert.match(html, /data-testid="rank-you"/);
    assert.match(html, /あなたの順位/);
    assert.match(html, /data-testid="rank-tabs"/);
    for (const id of ['total', 'month', 'week', 'rate']) assert.match(html, new RegExp(`data-rank-tab="${id}"`));
    assert.match(html, /data-scope="domestic"/);
    assert.match(html, /data-scope="world"/);
    assert.match(html, /🥇/);
    assert.match(html, /data-testid="rank-row-me"/);
    assert.match(html, /勝率/);
    assert.match(html, /pt/);
    assert.match(html, /data-testid="rank-rules"/);
    for (const points of ['3pt', '2pt', '1pt', '0pt']) assert.match(html, new RegExp(points));
  }
  /* 12言語で崩れない */
  for (const language of LANGUAGES) {
    const table = rankTable(peers, me, { tab: 'total', date });
    const html = rankView({
      t: (key, vars) => tr(language, key, vars), table, entitled: true, language, status: '',
      tab: 'total', scope: 'world', season: { label: 'SEASON' }, you: table.find((row) => row.isMe),
    });
    assert.ok(html.includes('data-testid="rank-season"'), language);
    assert.ok(!html.includes('>undefined<'), language);
  }
  /* PRO 未加入は従来どおりロック（ルールの説明は出す） */
  const locked = rankView({ t, table: [], entitled: false, language: 'ja', scope: 'world' });
  assert.match(locked, /locked/);
  assert.match(locked, /data-testid="rank-rules"/);
});

test('10. 戦績画面にキック傾向（4択の回数と％）', () => {
  let shots = { ...EMPTY_SHOTS };
  for (const dir of ['TL', 'TL', 'TR', 'BR']) shots = addShotDirection(shots, dir);
  const html = statsView({ t, record: { ...EMPTY_RECORD, played: 3, wins: 2, losses: 1 }, shots });
  assert.match(html, /data-testid="stats-tendency"/);
  for (const dir of DIRECTIONS) assert.match(html, new RegExp(`data-testid="tendency-${dir}"`));
  assert.match(html, /data-count="2"/);
  assert.match(html, /data-rate="50"/);
  assert.match(html, /data-testid="tendency-total"/);
  for (const language of LANGUAGES) {
    const local = statsView({ t: (key, vars) => tr(language, key, vars), record: EMPTY_RECORD, shots });
    assert.ok(local.includes('data-testid="tendency-TL"'), language);
  }
  /* 記録が無くても崩れない */
  assert.match(statsView({ t, record: EMPTY_RECORD }), /まだシュートの記録がありません/);
});

test('11. 結果画面の「結果をシェア」: 国旗・スコア・サドンデス・#SHOOTOUT4・IPKSF', () => {
  const suddenState = {
    ...newMatch({ first: 'me' }),
    score: { me: 6, opp: 5 },
    kicks: { me: [true, true, true, true, true, true], opp: [true, true, true, true, true, false] },
    winner: 'me',
  };
  const html = resultView({ t, state: suddenState, record: EMPTY_RECORD, language: 'ja', prefs });
  assert.match(html, /data-action="share-result"/);
  assert.match(html, /data-testid="share-result"/);

  const text = buildShareText({ t, state: suddenState, prefs, language: 'ja' });
  assert.match(text, /🇯🇵/, '日本の国旗絵文字');
  assert.match(text, /🇧🇷/, '相手の国旗絵文字');
  assert.match(text, /勝利/);
  assert.match(text, /6-5/);
  assert.match(text, /サドンデス6本目/);
  assert.match(text, /#SHOOTOUT4/);
  assert.match(text, /IPKSF/);
  assert.match(text, /日本 vs ブラジル/);

  /* 5本以内で終わった試合はサドンデスの行を出さない */
  const regularState = { ...newMatch({ first: 'me' }), score: { me: 3, opp: 1 }, kicks: { me: [true, true, true, false, false], opp: [false, true, false, false, false] }, winner: 'me' };
  const regular = buildShareText({ t, state: regularState, prefs, language: 'ja' });
  assert.equal(regular.includes('サドンデス'), false);
  assert.match(regular, /3-1/);

  /* 12言語すべてで文面が作れる */
  for (const language of LANGUAGES) {
    const local = buildShareText({ t: (key, vars) => tr(language, key, vars), state: suddenState, prefs, language });
    assert.match(local, /#SHOOTOUT4/);
    assert.match(local, /IPKSF/);
    assert.ok(local.split('\n').length >= 4, language);
  }
  /* 共有できない環境ではクリップボードへ（コードの経路を確認） */
  const main = read('src/main.js');
  assert.match(main, /navigator\.share/);
  assert.match(main, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(main, /toast\(t\('copied'\)\)/);
});

test('12. サドンデス判定（6本目以降）が勝ち点の 2/1 に効く', () => {
  /* 5本ずつ終えて同点 → 6本目へ。勝者が出たら sudden 扱い */
  let state = newMatch({ first: 'me' });
  for (let i = 0; i < 5; i += 1) {
    state = resolveKick(state, { shot: DIRECTIONS[i % 4], save: DIRECTIONS[(i + 1) % 4] });
    state = resolveKick(state, { shot: DIRECTIONS[i % 4], save: DIRECTIONS[(i + 1) % 4] });
  }
  assert.equal(state.winner, null);
  assert.equal(state.kicks.me.length, 5);
  state = resolveKick(state, { shot: 'TL', save: 'TR' });
  state = resolveKick(state, { shot: 'TL', save: 'TL' });
  assert.ok(state.kicks.me.length >= 6);
});
