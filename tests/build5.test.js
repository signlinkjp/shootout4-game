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
  speakableText, speechTag, voice, voiceVowels, audioState, audioSupport, configureAudio,
} from '../src/audio.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const tJa = (key, vars) => tr('ja', key, vars);
const prefs = { country: 'JP', opponent: 'BR', sound: true, bgm: true, vibrate: true, order: 'first', language: 'ja' };
const lower = (value) => String(value).toLowerCase();

/** window を差し替えて実行する（audio.js は呼び出し時に window を見る） */
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

test('2. 判定の言葉は絵文字・記号を落として読み上げる（12言語）', () => {
  assert.equal(speakableText('ゴール！'), 'ゴール');
  assert.equal(speakableText('セーブ！'), 'セーブ');
  assert.equal(speakableText('ミスキック！'), 'ミスキック');
  assert.equal(speakableText('MISS KICK 😭💦'), 'MISS KICK');
  assert.equal(speakableText('¡GOL!'), 'GOL');
  for (const language of LANGUAGES) {
    for (const key of ['goal', 'save', 'voiceMiss', 'missKick']) {
      const clean = speakableText(tr(language, key));
      assert.ok(clean.length > 0, `${language}.${key} が空`);
      assert.equal(/[\p{Extended_Pictographic}\p{So}]/u.test(clean), false, `${language}.${key} に絵文字: ${clean}`);
      assert.equal(/[!！]/.test(clean), false, `${language}.${key} に感嘆符: ${clean}`);
      assert.ok(voiceVowels(clean).length >= 2, `${language}.${key} の母音`);
    }
  }
});

test('2b. 言語コードは BCP-47 へ変換する（12言語＋予備）', () => {
  const expected = {
    ja: 'ja-JP', en: 'en-US', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW', ko: 'ko-KR', es: 'es-ES',
    pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', th: 'th-TH', id: 'id-ID',
  };
  for (const language of LANGUAGES) {
    assert.equal(speechTag(language), expected[language], language);
  }
  assert.equal(speechTag('ar'), 'ar-SA');
  assert.equal(speechTag(''), 'en-US');
  assert.equal(speechTag('vi'), 'en-US');
});

test('2c. iOS はネイティブ発声（ShootoutAudio.speak）を最優先し、記録を残す', () => {
  const calls = [];
  const fake = {
    Capacitor: {
      Plugins: {
        ShootoutAudio: {
          speak: (args) => { calls.push(args); return Promise.resolve({ spoken: true }); },
        },
      },
    },
  };
  withWindow(fake, () => {
    configureAudio({ sound: true });
    const before = audioState().voices.goal || 0;
    const result = voice('goal', { text: tr('ja', 'goal'), language: 'ja' });
    assert.equal(result.spoken, 'native');
    assert.equal(calls.length, 1, 'ブリッジを1回だけ呼ぶ');
    assert.deepEqual(calls[0], { text: 'ゴール', language: 'ja' }, '絵文字を除いた言葉と言語コード');
    const state = audioState();
    assert.equal(state.voices.goal, before + 1);
    assert.equal(state.voice.kind, 'goal');
    assert.equal(state.voice.spoken, 'native');
    assert.equal(state.voice.text, 'ゴール');
    assert.equal(state.voice.language, 'ja');
    assert.equal(state.voice.vowels, 'oou');
    assert.ok(audioSupport().native === true);

    /* 音OFFでは鳴らさない（ブリッジも呼ばない） */
    configureAudio({ sound: false });
    assert.equal(voice('save', { text: tr('ja', 'save'), language: 'ja' }), null);
    assert.equal(calls.length, 1, '音OFFではネイティブも呼ばない');
    configureAudio({ sound: true });
  });
});

test('2d. ブラウザは speechSynthesis（声があるとき）で読み上げる', () => {
  const spoken = [];
  const fake = {
    speechSynthesis: {
      getVoices: () => [{ lang: 'ja-JP', name: 'Kyoko' }],
      cancel: () => {},
      speak: (utterance) => spoken.push({ text: utterance.text, lang: utterance.lang }),
    },
    SpeechSynthesisUtterance: class {
      constructor(text) { this.text = text; }
    },
  };
  withWindow(fake, () => {
    configureAudio({ sound: true });
    const result = voice('save', { text: tr('ja', 'save'), language: 'ja' });
    assert.equal(result.spoken, 'browser');
    assert.deepEqual(spoken[0], { text: 'セーブ', lang: 'ja-JP' });
    assert.equal(audioState().voice.spoken, 'browser');
  });
});

test('2e. 声が無い環境でも記録は残し、フォルマント合成へ落ちる', () => {
  withWindow(null, () => {
    configureAudio({ sound: true });
    const result = voice('miss', { text: tr('ja', 'voiceMiss'), language: 'ja' });
    assert.ok(result);
    assert.equal(result.spoken, 'none', 'AudioContext が無いので合成もできない');
    const state = audioState();
    assert.equal(state.voice.kind, 'miss');
    assert.equal(state.voice.text, 'ミスキック');
    assert.equal(state.voice.spoken, 'none');
    assert.match(read('src/audio.js'), /bandpass/, 'フォルマント合成は残す（最終フォールバック）');
  });
});

test('2f. iOS 側に AVSpeechSynthesizer の発声があり、プラグインに登録されている', () => {
  const swift = read('ios/App/App/AppDelegate.swift');
  assert.match(swift, /import AVFoundation/);
  assert.match(swift, /static let synthesizer = AVSpeechSynthesizer\(\)/, 'ARC で消えないようクラス保持');
  assert.match(swift, /@objc public func speak\(_ call: CAPPluginCall\)/);
  assert.match(swift, /CAPPluginMethod\(name: "speak", returnType: CAPPluginReturnPromise\)/);
  assert.match(swift, /stopSpeaking\(at: \.immediate\)/, '前の声を止める');
  assert.match(swift, /AVAudioSession[\s\S]*?setCategory\(\.playback, mode: \.default, options: \[\.mixWithOthers\]\)/);
  assert.match(swift, /setActive\(true\)/);
  assert.match(swift, /utterance\.volume = 1\.0/);
  assert.match(swift, /"ja": "ja-JP"[\s\S]*?"th": "th-TH"/, 'BCP-47 の変換表');
  /* Web 側は Capacitor があるときだけネイティブへ渡す */
  const audio = read('src/audio.js');
  assert.match(audio, /window\?\.Capacitor|typeof window !== 'undefined' \? window\.Capacitor/);
  assert.match(audio, /Plugins\.ShootoutAudio/);
  assert.match(audio, /speak: \(args\)|bridge\.speak\(\{ text, language/);
});

/* ------------------------------------------------------------------ *\
 * 3. 音が消えない（Build 5）
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

test('3b. 復帰後は state が running に見えても1回は必ず起こし直す', () => {
  const audio = read('src/audio.js');
  assert.match(audio, /needsGestureRecovery/);
  assert.match(audio, /if \(state\.ctx\.state === 'closed'\)[\s\S]*?createContext\(\)/, 'closed は作り直す');
  assert.match(audio, /if \(!force && ctx\.state === 'running'\)[\s\S]*?return true;/, '復帰直後は running でも強制');
  assert.match(audio, /function silentPoke\(\)/, '無音1サンプル');
  assert.match(audio, /function applyVolumes\(\)/, '新しいバスに設定を当て直す');
  assert.match(audio, /export function ensureAudioRunning/);
  assert.match(audio, /export function resumeFromBackground/);
  const main = read('src/main.js');
  assert.match(main, /\['pointerdown', 'touchstart', 'keydown'\]/);
  assert.match(main, /ensureAudioRunning\(\)/);
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

test('5. Build 5 / v1.0.0 で揃っている', () => {
  assert.equal(CONFIG.version, '1.0.0');
  assert.equal(CONFIG.build, 5);
  assert.equal((read('ios/App/App.xcodeproj/project.pbxproj').match(/CURRENT_PROJECT_VERSION = 5;/g) || []).length, 2);
});
