import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG } from '../src/config.js';
import { tr, LANGUAGES } from '../src/i18n.js';
import { buildCharacter, setFooted, poseKick } from '../src/three/characters.js';
import { newMatch } from '../src/core/rules.js';
import { matchView } from '../src/ui/match.js';
import { rulesView } from '../src/ui/misc.js';
import {
  voice, audioState, configureAudio,
} from '../src/audio.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const tJa = (key, vars) => tr('ja', key, vars);
const prefs = { country: 'JP', opponent: 'BR', sound: true, bgm: true, vibrate: true, order: 'first', language: 'ja' };
const lower = (value) => String(value).toLowerCase();

/** window を差し替えて実行する（不要になったが、将来の検証用に残す） */
function withWindow(fake, run) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const before = globalThis.window;
  if (fake === null) delete globalThis.window;
  else globalThis.window = fake;
  try {
    return run();
  } finally {
    if (had) globalThis.window = before;
    else delete globalThis.window;
  }
}

/* ------------------------------------------------------------------ *\
 * 1. 利き足と蹴り足（Build 5 の修正の中心）
 * ------------------------------------------------------------------ */

test('1. 右利きは右足（legs[0]）・左利きは左足（legs[1]）で蹴る（両キャラクター）', () => {
  for (const style of ['voxel', 'stylized']) {
    const right = buildCharacter({ style, footed: 'right' });
    /* +Z が正面なので、本人の右は -X = legs[0]（side -1） */
    assert.equal(right.userData.parts.legs[0].leg.position.x < 0, true, `${style}: legs[0] は -X 側`);
    assert.equal(right.userData.parts.legs[1].leg.position.x > 0, true, `${style}: legs[1] は +X 側`);
    assert.equal(right.userData.kickLeg, 0, `${style}: 右利きの蹴り足は右足`);
    assert.equal(right.userData.supportLeg, 1, `${style}: 軸足は左足`);

    const left = buildCharacter({ style, footed: 'left' });
    assert.equal(left.userData.kickLeg, 1, `${style}: 左利きの蹴り足は左足`);
    assert.equal(left.userData.supportLeg, 0, `${style}: 軸足は右足`);

    /* ロッカーで利き足を変えたとき（setFooted）も同じ決め方 */
    const changed = buildCharacter({ style, footed: 'right' });
    setFooted(changed, 'left');
    assert.equal(changed.userData.footed, 'left');
    assert.equal(changed.userData.kickLeg, 1);
    assert.equal(changed.userData.supportLeg, 0);
    setFooted(changed, 'right');
    assert.equal(changed.userData.kickLeg, 0);
    assert.equal(changed.userData.supportLeg, 1);
  }
});

test('1b. 蹴りモーションは蹴り足だけが振り抜け、軸足は地面に残る', () => {
  for (const [footed, kickIndex, supportIndex] of [['right', 0, 1], ['left', 1, 0]]) {
    const character = buildCharacter({ style: 'voxel', footed });
    /* 0.6 = 振り抜きの途中（hip がマイナス＝つま先が前 +Z へ） */
    poseKick(character, 0.7);
    const kickHip = character.userData.parts.legs[kickIndex].leg.rotation.x;
    const supportHip = character.userData.parts.legs[supportIndex].leg.rotation.x;
    assert.ok(kickHip < -0.8, `${footed}: 蹴り足が前へ振れる (${kickHip})`);
    assert.ok(Math.abs(supportHip + 0.08) < 0.001, `${footed}: 軸足はそのまま (${supportHip})`);
  }
});

test('1c. 助走は右利き＝ボールの左（-X）から右足、左利き＝右（+X）から左足', () => {
  const stadium = read('src/three/stadium.js');
  const right = stadium.match(/right: \{([^}]*)\}/)[1];
  const left = stadium.match(/left: \{([^}]*)\}/)[1];
  const value = (block, key) => Number(block.match(new RegExp(`${key}:\\s*([-\\d.]+)`))[1]);
  const facing = (block) => Number(block.match(/facing: Math\.PI \* ([\d.]+)/)[1]);
  assert.ok(value(right, 'startX') < 0 && value(right, 'plantX') < 0, '右利きは画面の左から入る');
  assert.ok(value(right, 'kickLeg') === 0 && value(right, 'supportLeg') === 1, '右利きの蹴り足は legs[0]');
  assert.ok(value(left, 'startX') > 0 && value(left, 'plantX') > 0, '左利きは画面の右から入る');
  assert.ok(value(left, 'kickLeg') === 1 && value(left, 'supportLeg') === 0, '左利きの蹴り足は legs[1]');
  /* 画面の向き: カメラは +Z の後ろから -Z のゴールを見るので、-X が画面の左 */
  assert.ok(Math.cos(Math.PI * facing(right)) < 0, '右利きもゴールを向く');
  assert.ok(Math.cos(Math.PI * facing(left)) < 0, '左利きもゴールを向く');
  assert.ok(Math.abs(facing(right) - 0.93) < 0.001 && Math.abs(facing(left) - 1.07) < 0.001, '向きは左右で別');
  /* 3D の snapshot は「実際に使う蹴り足」を返す（userData.kickLeg） */
  assert.match(stadium, /kickLeg: shooter \? shooter\.userData\.kickLeg : run\.kickLeg/);
});

/* ------------------------------------------------------------------ *\
 * 2. ボイス（人の声）
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *\
 * 2. 演出音（Build 6: 棒読みの読み上げを廃止し、音だけで盛り上げる）
 * ------------------------------------------------------------------ */

test('2. 判定は音の演出だけで盛り上げる（音声合成なし・ゴール/セーブ/ミスで別の音）', () => {
  const audio = read('src/audio.js');
  /* 棒読みの読み上げは一切残さない */
  assert.equal(/AVSpeechSynthesizer|AVSpeechUtterance|speechSynthesis|SpeechSynthesisUtterance/.test(audio), false, '音声合成を呼ばない');
  assert.equal(/nativeSpeak|browserSpeak|speakableText|speechTag|voiceVowels|VOWEL_FORMANTS/.test(audio), false, '読み上げ用の補助も残さない');
  /* 判定ごとの演出音 */
  assert.match(audio, /export function stadiumHorn/, 'ゴール: スタジアムホーン');
  assert.match(audio, /export function victoryFanfare/, 'ゴール: 勝利のファンファーレ');
  assert.match(audio, /export function crowdOoh/, 'セーブ: 観客のどよめき');
  assert.match(audio, /export function gloveClear/, 'セーブ: グローブストップ＆クリア');
  assert.match(audio, /export function crowdAww/, 'ミス: 観客の落胆');
  /* Build 8: MP3 が無いときは、このシンセ音へ自動で落ちる（SHOWCASE は各関数へ） */
  assert.match(audio, /goal: goalShowcase/);
  assert.match(audio, /save: saveShowcase/);
  assert.match(audio, /miss: missShowcase/);
  /* ゴールは既存の goalRoar() / crowdSurge() に重ねる（main.js 側） */
  assert.match(read('src/main.js'), /goalRoar\(2\.4\); crowdSurge\(1\.1\)/);

  /* AudioContext が無くても記録し、音OFFでは鳴らさない */
  configureAudio({ sound: true });
  assert.deepEqual(voice('goal'), { kind: 'goal', mode: 'showcase' });
  assert.deepEqual(voice('save'), { kind: 'save', mode: 'showcase' });
  assert.deepEqual(voice('miss'), { kind: 'miss', mode: 'showcase' });
  const state = audioState();
  assert.ok(state.voices.goal >= 1 && state.voices.save >= 1 && state.voices.miss >= 1);
  assert.equal(state.voice.mode, 'showcase');
  configureAudio({ sound: false });
  assert.equal(voice('goal'), null, '音OFFでは鳴らさない');
  configureAudio({ sound: true });
});

test('2b. iOS 側に音声合成（AVSpeechSynthesizer / speak）が残っていない', () => {
  const swift = read('ios/App/App/AppDelegate.swift');
  assert.equal(/AVSpeechSynthesizer|AVSpeechUtterance|func speak\(/.test(swift), false, '読み上げを外した');
  assert.equal(/CAPPluginMethod\(name: "speak"/.test(swift), false, 'speak を登録しない');
  assert.match(swift, /CAPPluginMethod\(name: "activate"/);
  assert.match(swift, /CAPPluginMethod\(name: "deactivate"/);
  /* 音そのものは AVAudioSession の activate / deactivate だけで支える */
  assert.match(swift, /import AVFoundation/);
  assert.match(swift, /AVAudioSession[\s\S]*?setCategory\(\.playback, mode: \.default, options: \[\.mixWithOthers\]\)/);
  assert.match(swift, /setActive\(true\)/);
  assert.match(read('src/audio.js'), /Plugins\.ShootoutAudio/);
  assert.match(read('src/audio.js'), /bridge\.activate\(\)/);
});

/* ------------------------------------------------------------------ *\
 * 3. 音が消えない（Build 5 / Build 6）
 * ------------------------------------------------------------------ */

test('3. 通知・共有シート・課金シート（blur）では音を止めない', () => {
  const main = read('src/main.js');
  assert.equal(/addEventListener\('blur'/.test(main), false, 'blur で suspend しない');
  assert.match(main, /addEventListener\('visibilitychange'/);
  assert.match(main, /document\.hidden/);
  assert.match(main, /window\.addEventListener\('pagehide', onAppHidden\)/);
  const swift = read('ios/App/App/AppDelegate.swift');
  assert.match(swift, /func applicationWillResignActive/);
  assert.match(swift, /func applicationDidEnterBackground/);
});

test('3b. 復帰後の最初の操作で AudioContext を作り直す（onAppVisible では消費しない）', () => {
  const audio = read('src/audio.js');
  assert.match(audio, /needsGestureRecovery/);
  assert.match(audio, /const force = state\.needsGestureRecovery \|\| state\.ctx\.state === 'closed'/);
  assert.match(audio, /state\.ctx\.close\(\)[\s\S]*?createContext\(\)/, '古い Context を捨てて作り直す');
  assert.match(audio, /if \(state\.settings\.bgm\) \{[\s\S]*?stopMusic\(\);\s*startMusic\(\);/, '作り直した Context で BGM を張り直す');
  assert.match(audio, /function silentPoke\(\)/, '無音1サンプル');
  assert.match(audio, /function applyVolumes\(\)/, '新しいバスに設定を当て直す');
  assert.match(audio, /export function ensureAudioRunning/);
  assert.match(audio, /export function resumeFromBackground/);
  /* suspend では古い無音 <audio> を捨てる */
  assert.match(audio, /state\.silent\?\.pause\?\.\(\)[\s\S]*?state\.silent = null/);
  const main = read('src/main.js');
  assert.match(main, /\['pointerdown', 'touchstart', 'keydown'\]/);
  assert.match(main, /const rebuilt = ensureAudioRunning\(\)/);
  assert.match(main, /if \(rebuilt && prefs\.sound && screen === 'match' && match && !match\.confirmed\) \{[\s\S]*?startCrowd\(getCountry\(prefs\.country\)\)/, '試合中の歓声も張り直す');
  /* onAppVisible（visibilitychange / focus）では needsGestureRecovery を空消費しない */
  const start = main.indexOf('function onAppVisible()');
  const visible = main.slice(start, main.indexOf('\n}\n', start) + 3);
  assert.equal(/ensureAudioRunning\(\);/.test(visible), false, 'onAppVisible では呼ばない');
});

/* ------------------------------------------------------------------ *\
 * 4. キーパーの方向説明（12言語）
 * ------------------------------------------------------------------ */

test('4. キーパーの方向の選び方（映っている画面のまま）を12言語で説明している', () => {
  for (const language of LANGUAGES) {
    const t = (key, vars) => tr(language, key, vars);
    const zone = lower(t('zone_TL'));
    const hint = t('keeperDirHint');
    const rules = t('rulesText');
    assert.ok(hint.length > 8, `${language}: 短い案内がある`);
    assert.ok(hint.length <= 60, `${language}: 短い案内はコンパクト（${hint.length}）`);
    assert.ok(lower(hint).includes(zone), `${language}: 例がボタンの文言（${t('zone_TL')}）を使う`);
    assert.ok(lower(rules).includes(zone), `${language}: 遊び方にも例がある`);
    assert.match(rules, /keeper|キーパー|门将|門將|골키퍼|portero|goleiro|gardien|Torwart|portiere|ผู้รักษาประตู|kiper/i, `${language}: 遊び方にキーパーの説明`);
    if (language !== 'ja') assert.notEqual(hint, tr('ja', 'keeperDirHint'), language);
  }
  assert.match(tr('ja', 'rulesText'), /画面の左上をタップすると、画面の左上に飛び/);
});

test('4b. キーパーの番の画面に短い案内が出る（シュートの番では出さない）', () => {
  const view = (role) => {
    const state = { ...newMatch({ first: 'me' }), turn: role === 'keep' ? 'opp' : 'me' };
    return matchView({ t: tJa, prefs, state, language: 'ja' });
  };
  const keeper = view('keep');
  assert.match(keeper, /data-testid="keeper-dir-hint"/);
  assert.ok(keeper.includes(tr('ja', 'keeperDirHint')));
  assert.match(keeper, /id="dir-hint"[^>]*hidden/, '初期は隠しておき、キーパーの番だけ出す');
  /* キーパー視点の4択ラベルはそのまま（画面の左上＝画面の左上へ飛ぶ） */
  assert.match(keeper, /data-dir="TL"/);
  const main = read('src/main.js');
  assert.match(main, /const hint = \$\('#dir-hint'\);[\s\S]*?hint\.hidden = !active;/, 'キーパーの番だけ表示');
  const css = read('styles.css');
  assert.match(css, /\.dirhint\s*\{[\s\S]*?white-space: normal[\s\S]*?overflow-wrap: anywhere/, '特大文字でも折り返す');
});

test('4c. キーパーの選択は「画面で押した位置」と一致する（mirrorDirection）', async () => {
  const { mirrorDirection, ZONES } = await import('../src/core/rules.js');
  /* 画面の左上（TL）を押す → ゴール基準では TR だが、キッカーから見た TR はキーパーの画面では左 */
  assert.equal(mirrorDirection('TL'), 'TR');
  assert.equal(mirrorDirection('TR'), 'TL');
  assert.equal(mirrorDirection('BL'), 'BR');
  assert.equal(mirrorDirection('BR'), 'BL');
  assert.ok(ZONES.TL.x < 0, 'TL はキッカーから見て左');
  const match = read('src/ui/match.js');
  assert.match(match, /role === 'keep' \? mirrorDirection\(dir\) : dir/);
});

/* ------------------------------------------------------------------ *\
 * 5. ビルド番号
 * ------------------------------------------------------------------ */

test('5. Build 9 / v1.0.0 で揃っている', () => {
  assert.equal(CONFIG.version, '1.0.0');
  assert.equal(CONFIG.build, 9);
  assert.equal((read('ios/App/App.xcodeproj/project.pbxproj').match(/CURRENT_PROJECT_VERSION = 9;/g) || []).length, 2);
});
