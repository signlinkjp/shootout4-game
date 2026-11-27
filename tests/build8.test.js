/**
 * SHOOTOUT 4 — Build 8 の検証
 *
 *  1. ビルド番号 8（v1.0.0）が全ファイルで揃っている
 *  2. 効果音ラボの MP3 6本が assets/sfx にあり、www へ同期される
 *  3. fetch → decodeAudioData の再生基盤と、シンセ音への自動フォールバック
 *  4. 本物の音が無い／読めない環境でも voice() はエラーを出さず記録する
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG } from '../src/config.js';
import { makeWww } from '../tools/make-www.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

const SFX = [
  'people-stadium-cheer1.mp3',
  'air-horn1.mp3',
  'trumpet1.mp3',
  'mens-yeah1.mp3',
  'people-shout-oo1.mp3',
  'people-performance-uwaa1.mp3',
];

/* ------------------------------------------------------------------ *\
 * 1. ビルド番号
 * ------------------------------------------------------------------ */

test('Build 8 / v1.0.0 が全ファイルで揃っている', () => {
  assert.equal(CONFIG.version, '1.0.0');
  assert.equal(CONFIG.build, 8);
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.deepEqual([...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => m[1]), ['8', '8']);
  assert.equal((pbx.match(/MARKETING_VERSION = 1\.0\.0;/g) || []).length, 2);
  assert.match(read('package.json'), /Build 8/);
  assert.match(read('src/config.js'), /build: 8/);
  assert.match(read('README.md'), /v1\.0\.0 \/ Build 8/);
  assert.match(read('docs/testflight-setup.md'), /\*\*8\*\*/);
  assert.match(read('docs/ios-testflight.yml'), /TestFlight Build 8/);
});

/* ------------------------------------------------------------------ *\
 * 2. MP3 素材
 * ------------------------------------------------------------------ */

test('効果音ラボの MP3 6本が assets/sfx にあり、MPEG の音声として読める', () => {
  let total = 0;
  for (const name of SFX) {
    const path = resolve(ROOT, 'assets/sfx', name);
    assert.equal(existsSync(path), true, name);
    const bytes = readFileSync(path);
    total += bytes.length;
    assert.ok(bytes.length > 10000, `${name} は ${bytes.length}B`);
    const id3 = bytes.subarray(0, 3).toString('latin1') === 'ID3';
    const sync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    assert.ok(id3 || sync, `${name} の先頭が ID3 か MPEG フレーム同期`);
    /* 先頭 4KB のどこかにフレーム同期がある（ID3 タグ付きのため） */
    const head = bytes.subarray(0, 4096);
    let frame = false;
    for (let i = 0; i + 1 < head.length; i += 1) {
      if (head[i] === 0xff && (head[i + 1] & 0xe0) === 0xe0) { frame = true; break; }
    }
    assert.equal(frame, true, `${name} に MPEG フレーム同期がある`);
  }
  assert.ok(total < 500 * 1024, `合計 ${total}B（アプリを重くしない）`);
  assert.match(read('assets/sfx/SOURCES.md'), /soundeffect-lab\.info/);
  assert.match(read('assets/sfx/SOURCES.md'), /クレジット表記不要/);
});

test('assets/sfx が www/（Capacitor の webDir）へ同期される', async () => {
  await makeWww();
  for (const name of SFX) {
    assert.equal(existsSync(resolve(ROOT, 'www/assets/sfx', name)), true, name);
    assert.equal(
      statSync(resolve(ROOT, 'www/assets/sfx', name)).size,
      statSync(resolve(ROOT, 'assets/sfx', name)).size,
      name,
    );
  }
  assert.deepEqual(readdirSync(resolve(ROOT, 'www/assets/sfx')).filter((name) => name.endsWith('.mp3')).sort(), [...SFX].sort());
});

/* ------------------------------------------------------------------ *\
 * 3. 実装（audio.js / main.js）
 * ------------------------------------------------------------------ */

test('audio.js: fetch → decodeAudioData → バス再生。失敗時はシンセ音へ落ちる', () => {
  const audio = read('src/audio.js');
  assert.match(audio, /export const SFX_FILES/);
  assert.match(audio, /people-stadium-cheer1\.mp3/);
  assert.match(audio, /air-horn1\.mp3/);
  assert.match(audio, /trumpet1\.mp3/);
  assert.match(audio, /mens-yeah1\.mp3/);
  assert.match(audio, /people-shout-oo1\.mp3/);
  assert.match(audio, /people-performance-uwaa1\.mp3/);
  assert.match(audio, /fetch\(sampleUrl\(key\)/);
  assert.match(audio, /decodeAudioData\(bytes\.slice\(0\)\)/);
  assert.match(audio, /function playSample\(key/);
  assert.match(audio, /bus: 'crowdBus'/);
  /* 生バイトを残して、AudioContext を作り直しても取り直さない */
  assert.match(audio, /state\.sampleBytes\[key\] = bytes/);
  assert.match(audio, /for \(const key of Object\.keys\(state\.sampleBytes\)\) decodeSample\(key\)/);
  /* MP3 が1枚も鳴らないときの従来シンセ音 */
  assert.match(audio, /function goalShowcase\(\)[\s\S]*?stadiumHorn\(\);[\s\S]*?victoryFanfare\(\);/);
  assert.match(audio, /function saveShowcase\(\)[\s\S]*?crowdOoh\(\)/);
  assert.match(audio, /function missShowcase\(\)[\s\S]*?crowdAww\(\)/);
  /* 効果音OFFなら鳴らさない */
  assert.match(audio, /function playSample\(key[\s\S]*?if \(!state\.settings\.sound\) return false;/);
  /* 決着の演出 */
  assert.match(audio, /export function champion/);
  assert.match(read('src/main.js'), /champion\(\{ win: state\.winner === 'me' \}\)/);
});

/* ------------------------------------------------------------------ *\
 * 4. 実際に鳴らす経路（最小の AudioContext で確かめる）
 * ------------------------------------------------------------------ */

class FakeParam {
  constructor(value = 1) {
    this.value = value;
  }

  setValueAtTime(value) {
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value) {
    this.value = value;
    return this;
  }

  exponentialRampToValueAtTime(value) {
    this.value = value;
    return this;
  }

  setTargetAtTime(value) {
    this.value = value;
    return this;
  }
}

class FakeNode {
  constructor() {
    this.gain = new FakeParam(1);
    this.frequency = new FakeParam(440);
    this.playbackRate = new FakeParam(1);
    this.Q = new FakeParam(1);
  }

  connect(target) {
    return target;
  }

  start() {}

  stop() {}
}

class FakeContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = new FakeNode();
    this.decoded = 0;
  }

  createGain() {
    return new FakeNode();
  }

  createOscillator() {
    return new FakeNode();
  }

  createBufferSource() {
    return new FakeNode();
  }

  createBiquadFilter() {
    return new FakeNode();
  }

  createBuffer(channels, length, rate) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate: rate,
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    };
  }

  resume() {
    return Promise.resolve();
  }

  suspend() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }

  decodeAudioData() {
    this.decoded += 1;
    return Promise.resolve({ duration: 2.5 });
  }
}

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

async function waitFor(predicate, timeout = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return true;
    await new Promise((done) => setTimeout(done, 10));
  }
  return false;
}

test('MP3 をデコードできたら、ゴール/セーブ/ミス/決着が本物の音で鳴る', async () => {
  globalThis.window = { AudioContext: FakeContext };
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(4096).buffer });
  try {
    const audio = await import(new URL('../src/audio.js?build8=mp3', import.meta.url).href);
    audio.configureAudio({ sound: true, bgm: false });
    assert.equal(audio.unlockAudio(), true);
    const ready = await waitFor(() => Object.values(audio.audioState().samples).every((value) => value === 'ready'));
    assert.equal(ready, true, JSON.stringify(audio.audioState().samples));
    assert.deepEqual(Object.values(audio.audioState().samples), ['ready', 'ready', 'ready', 'ready', 'ready', 'ready']);

    assert.deepEqual(audio.voice('goal'), { kind: 'goal', mode: 'showcase' });
    assert.equal(audio.audioState().voice.source, 'mp3', 'ゴールは MP3');
    assert.deepEqual(audio.voice('save'), { kind: 'save', mode: 'showcase' });
    assert.equal(audio.audioState().voice.source, 'mp3', 'セーブは MP3');
    assert.deepEqual(audio.voice('miss'), { kind: 'miss', mode: 'showcase' });
    assert.equal(audio.audioState().voice.source, 'mixed', 'ミスはシンセ＋MP3 の反応');
    assert.equal(audio.champion({ win: true }).source, 'mp3');
    assert.equal(audio.champion({ win: false }).source, 'mp3');
    assert.equal(audio.voice('nope'), null);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('MP3 が取れない環境ではエラーを出さず、従来のシンセ音だけで鳴らす', async () => {
  globalThis.window = {
    AudioContext: class extends FakeContext {
      decodeAudioData() {
        return Promise.reject(new Error('decode unsupported'));
      }
    },
  };
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  try {
    const audio = await import(new URL('../src/audio.js?build8=fallback', import.meta.url).href);
    audio.configureAudio({ sound: true, bgm: false });
    assert.equal(audio.unlockAudio(), true);
    await waitFor(() => Object.values(audio.audioState().samples).every((value) => value === 'failed'));
    assert.deepEqual(Object.values(audio.audioState().samples), ['failed', 'failed', 'failed', 'failed', 'failed', 'failed']);

    assert.deepEqual(audio.voice('goal'), { kind: 'goal', mode: 'showcase' });
    assert.equal(audio.audioState().voice.source, 'synth');
    assert.equal(audio.voice('save').kind, 'save');
    assert.equal(audio.audioState().voice.source, 'synth');
    assert.equal(audio.voice('miss').kind, 'miss');
    assert.equal(audio.audioState().voice.source, 'synth');
    assert.equal(audio.champion({ win: true }).source, 'synth');
    assert.equal(audio.audioState().voices.goal >= 1, true);

    /* 音OFFでは何も鳴らさず null（従来どおり） */
    audio.configureAudio({ sound: false });
    assert.equal(audio.voice('goal'), null);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('AudioContext そのものが無い環境（Node）でも voice() は記録して返す', async () => {
  globalThis.window = undefined;
  try {
    const audio = await import(new URL('../src/audio.js?build8=none', import.meta.url).href);
    audio.configureAudio({ sound: true, bgm: false });
    assert.deepEqual(audio.voice('goal'), { kind: 'goal', mode: 'showcase' });
    assert.equal(audio.champion({ win: true }).kind, 'champion');
    assert.equal(audio.audioState().samples.cheer, 'idle');
  } finally {
    globalThis.window = originalWindow;
  }
});
