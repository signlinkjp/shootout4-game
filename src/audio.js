/**
 * SHOOTOUT 4 — 音（Web Audio API で合成。音源ファイルを持たない）
 *
 *  iPhond / WKWebView でも操作のたびに AudioContext を起こし直す。
 *  国別の歓声は countries.js の crowd（明るさ・密度・チャント・太鼓）から作る。
 *  設定: 効果音 / BGM / バイブ は独立に ON/OFF。
 */

const state = {
  ctx: null,
  master: null,
  sfxBus: null,
  musicBus: null,
  crowdBus: null,
  crowdSource: null,
  crowdFilter: null,
  crowdGain: null,
  crowdTimer: null,
  musicTimer: null,
  musicStep: 0,
  noise: null,
  settings: { sound: true, bgm: true, vibrate: true },
  country: null,
  unlocked: false,
  backgrounded: false,
  silent: null,
  voices: {},
  lastVoice: null,
  recoveries: 0,
  /* Build 8: 効果音ラボの MP3（デコード済みバッファと、Context を作り直すための生バイト） */
  samples: Object.create(null),
  sampleBytes: Object.create(null),
  sampleState: Object.create(null),
  sampleAt: Object.create(null),
  /* Build 5/6: バックグラウンドから戻った最初の操作で、1回だけ強制的に音を起こし直す */
  needsGestureRecovery: false,
};

const AC = () => (typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext);

function bus(name, volume) {
  const ctx = state.ctx;
  if (!ctx) return null;
  if (state[name]) return state[name];
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(state.master);
  state[name] = gain;
  return gain;
}

/** 無音の WAV（iOS で Web Audio を起こすための下支え） */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

/**
 * AudioContext とバス（master / sfx / music / crowd）を作り直す。
 * Build 5: iOS で `closed` になってしまったときは、新しい Context を張り直す。
 */
function createContext() {
  const Ctor = AC();
  if (!Ctor) return false;
  try {
    state.ctx = new Ctor({ latencyHint: 'interactive' });
  } catch {
    state.ctx = null;
    return false;
  }
  state.master = state.ctx.createGain();
  state.master.gain.value = 1;
  state.master.connect(state.ctx.destination);
  /* 古いバス・ノードは新しい Context のものではないので作り直す */
  state.sfxBus = null;
  state.musicBus = null;
  state.crowdBus = null;
  bus('sfxBus', 1);
  bus('musicBus', 0.45);
  bus('crowdBus', 0.95);
  state.noise = null;
  state.crowdSource = null;
  state.crowdGain = null;
  state.crowdFilter = null;
  /* Build 8: デコード済みバッファは古い Context のもの。生バイトから作り直す
     （iOS で復帰時に Context を捨てても、MP3 を取り直さずに済む） */
  state.samples = Object.create(null);
  for (const key of Object.keys(state.sampleBytes)) decodeSample(key);
  applyVolumes();
  return true;
}

/** 無音の1サンプルを実際に再生する（WKWebView のオーディオパイプラインを起こす） */
function silentPoke() {
  const ctx = state.ctx;
  if (!ctx) return false;
  try {
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    return true;
  } catch {
    /* 起こせなくても次の操作で再挑戦する */
    return false;
  }
}

/** 設定の ON/OFF を、いまのバスに当て直す */
function applyVolumes() {
  const ctx = state.ctx;
  if (!ctx) return;
  const now = ctx.currentTime;
  state.sfxBus?.gain.setTargetAtTime(state.settings.sound ? 1 : 0.0001, now, 0.05);
  state.musicBus?.gain.setTargetAtTime(state.settings.bgm ? 0.42 : 0.0001, now, 0.08);
  state.crowdBus?.gain.setTargetAtTime(state.settings.sound ? 0.92 : 0.0001, now, 0.08);
}

export function unlockAudio() {
  try {
    /* Build 5: AudioContext が closed になっていたら作り直す（バスも張り直す） */
    if (!state.ctx || state.ctx.state === 'closed') {
      if (!createContext()) return false;
    }
    /* resume() は環境によっては返ってこない。await せずに走らせる
       （音が鳴らなくてもゲームは止めない） */
    if (state.ctx.state !== 'running') {
      state.ctx.resume().catch(() => {});
    }
    /* iOS: 無音の1サンプルを実際に再生して AudioContext を起こす
       （Build 1 はここが無く、実機で音が出なかった） */
    silentPoke();
    /* iOS: アプリ側の Audio Session を playback にする（AppDelegate のブリッジ） */
    activateBridge();
    /* Build 8: 最初の操作で本物のスタジアム音（MP3）を取りに行く */
    ensureSamples();
    if (!state.unlocked) {
      state.unlocked = true;
      ensureSilentAudio();
    }
    return true;
  } catch {
    return false;
  }
}

export function configureAudio(settings) {
  state.settings = { ...state.settings, ...settings };
  if (!state.ctx) return;
  applyVolumes();
  if (state.settings.bgm) startMusic();
  else stopMusic();
}

/**
 * 音を出せる状態か。
 * 予約した音は resume() の完了後に鳴るので、'suspended' でも「鳴らす」側に倒す
 * （Build 1 は running になるまで全て捨てていて、実機で無音になった）。
 */
export function ready() {
  return Boolean(state.ctx && state.ctx.state !== 'closed');
}

function noiseBuffer() {
  const ctx = state.ctx;
  if (state.noise) return state.noise;
  const length = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    last = (last + (Math.random() * 2 - 1) * 0.25) * 0.86;
    data[i] = last;
  }
  state.noise = buffer;
  return buffer;
}

function tone({ freq, end = freq, dur = 0.2, gain = 0.08, type = 'sine', delay = 0, glide = 'exp', bus: target = 'sfxBus' }) {
  const ctx = state.ctx;
  if (!ctx || !ready()) return;
  const out = state[target];
  if (!out) return;
  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (glide === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), now + dur);
  else osc.frequency.linearRampToValueAtTime(Math.max(20, end), now + dur);
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.linearRampToValueAtTime(gain, now + Math.min(0.02, dur * 0.3));
  amp.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(amp).connect(out);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

function noise({ dur = 0.3, gain = 0.1, low = 200, high = 3000, delay = 0, q = 0.8, bus: target = 'sfxBus' }) {
  const ctx = state.ctx;
  if (!ctx || !ready()) return;
  const out = state[target];
  if (!out) return;
  const now = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = (low + high) / 2;
  filter.Q.value = q;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = high;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.linearRampToValueAtTime(gain, now + Math.min(0.03, dur * 0.25));
  amp.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(filter).connect(lowpass).connect(amp).connect(out);
  src.start(now);
  src.stop(now + dur + 0.03);
}

function vibrate(pattern) {
  if (!state.settings.vibrate) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* 未対応 */
  }
}

/* ------------------------------------------------------------------ *\
 * 操作音・試合の音
 * ------------------------------------------------------------------ */

export function click() {
  if (!state.settings.sound) return;
  tone({ freq: 660, end: 880, dur: 0.05, gain: 0.03, type: 'triangle' });
}

export function whistle() {
  if (!state.settings.sound) return;
  tone({ freq: 1850, end: 2100, dur: 0.14, gain: 0.05, type: 'sine' });
  tone({ freq: 2300, end: 1900, dur: 0.12, gain: 0.03, type: 'sine', delay: 0.12 });
  vibrate(12);
}

export function countdownTick(urgent = false) {
  if (!state.settings.sound) return;
  tone({ freq: urgent ? 1200 : 880, end: urgent ? 1200 : 880, dur: 0.05, gain: 0.035, type: 'square' });
}

export function select() {
  if (!state.settings.sound) return;
  tone({ freq: 520, end: 780, dur: 0.09, gain: 0.05, type: 'triangle' });
  vibrate(8);
}

export function kickSound() {
  if (!state.settings.sound) return;
  /* 踏み込み → ミート音 */
  tone({ freq: 140, end: 46, dur: 0.11, gain: 0.16, type: 'triangle' });
  noise({ dur: 0.12, gain: 0.16, low: 120, high: 1900 });
  vibrate(18);
}

export function netSound() {
  if (!state.settings.sound) return;
  noise({ dur: 0.34, gain: 0.1, low: 900, high: 5200, q: 0.6 });
  tone({ freq: 220, end: 90, dur: 0.22, gain: 0.06, type: 'triangle' });
}

export function gloveSound() {
  if (!state.settings.sound) return;
  tone({ freq: 190, end: 70, dur: 0.16, gain: 0.13, type: 'square' });
  noise({ dur: 0.2, gain: 0.12, low: 90, high: 1400 });
  vibrate([30, 25, 30]);
}

export function goalRoar(seconds = 2.2) {
  if (!state.settings.sound) return;
  const d = Math.max(0.6, Math.min(3.4, seconds));
  /* Build 8: 本物の歓声（MP3）が鳴らせる環境では、それを主役にして
     ノイズの盛り上げは控えめに。シンセのホーン／ファンファーレは重ねない
     （voice('goal') が本物のホーン＋ファンファーレを鳴らすため）。 */
  const realistic = Boolean(state.samples.cheer);
  noise({ dur: d, gain: realistic ? 0.22 : 0.36, low: 220, high: 4400, q: 0.5, bus: 'crowdBus' });
  noise({ dur: d * 0.8, gain: realistic ? 0.11 : 0.2, low: 900, high: 6400, q: 0.4, bus: 'crowdBus' });
  if (!realistic) {
    /* スタジアムホーン */
    tone({ freq: 233, end: 233, dur: 0.5, gain: 0.075, type: 'sawtooth', bus: 'sfxBus' });
    tone({ freq: 349, end: 349, dur: 0.5, gain: 0.05, type: 'sawtooth', bus: 'sfxBus' });
    /* ファンファーレ */
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
      tone({ freq, end: freq, dur: 0.32, gain: 0.035, type: 'triangle', delay: 0.1 + index * 0.11 });
    });
  }
  vibrate([40, 40, 70]);
}

export function uiSwitch() {
  if (!state.settings.sound) return;
  tone({ freq: 420, end: 620, dur: 0.07, gain: 0.04, type: 'triangle' });
}

export function purchaseChime(ok = true) {
  if (!state.settings.sound) return;
  const notes = ok ? [659.25, 783.99, 1046.5] : [392, 330, 262];
  notes.forEach((freq, index) => {
    tone({ freq, end: freq, dur: 0.26, gain: 0.05, type: 'triangle', delay: index * 0.1 });
  });
  vibrate(ok ? [30, 30, 60] : 40);
}

/* ------------------------------------------------------------------ *\
 * 本物のスタジアムの音（Build 8: 効果音ラボの MP3）
 *
 * 出典: 効果音ラボ（https://soundeffect-lab.info/）。商用利用無料・クレジット表記
 * 不要の音源を、ゲーム内の演出音としてそのまま使う（再配布には当たらない）。
 *
 *   fetch → ArrayBuffer → decodeAudioData でデコードして state.samples に持つ。
 *   生のバイトも state.sampleBytes に残すので、iOS で AudioContext を閉じて
 *   作り直しても、取り直さずにもう一度デコードするだけで鳴らせる。
 *
 *   ！ ここは絶対に throw しない。オフライン・ブラウザ制約・Node / Playwright の
 *   ように fetch も decodeAudioData も使えない環境では、playSample() が false を
 *   返し、呼び出し側（SHOWCASE）が従来の Web Audio シンセ音へ落ちる。
 * ------------------------------------------------------------------ */

/** 使う MP3（すべて assets/sfx/ に同梱） */
export const SFX_FILES = Object.freeze({
  cheer: 'people-stadium-cheer1.mp3', /* スタジアムの大歓声＋拍手 */
  horn: 'air-horn1.mp3', /* エアーホーン */
  fanfare: 'trumpet1.mp3', /* ラッパのファンファーレ */
  yeah: 'mens-yeah1.mp3', /* 男衆の「イエーイ！」 */
  oo: 'people-shout-oo1.mp3', /* 男声の「オーッ！」 */
  uwaa: 'people-performance-uwaa1.mp3', /* 「わぁーーっ♪」の歓声 */
});

const SFX_BASE = 'assets/sfx/';

function sampleUrl(key) {
  const path = `${SFX_BASE}${SFX_FILES[key]}`;
  try {
    const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : 'http://localhost/';
    return new URL(path, base).href;
  } catch {
    return path;
  }
}

/** 生バイト → デコード済みバッファ（失敗しても state に failed を残すだけ） */
function decodeSample(key) {
  const ctx = state.ctx;
  const bytes = state.sampleBytes[key];
  if (!ctx || !bytes || typeof ctx.decodeAudioData !== 'function') return false;
  state.sampleState[key] = 'decoding';
  let request = null;
  try {
    request = ctx.decodeAudioData(bytes.slice(0));
  } catch {
    request = null;
  }
  if (!request || typeof request.then !== 'function') {
    /* コールバック形式しか無い／そもそも非対応 → シンセ音へ */
    state.sampleState[key] = 'failed';
    return false;
  }
  request.then(
    (buffer) => {
      if (!buffer) {
        state.sampleState[key] = 'failed';
        return;
      }
      state.samples[key] = buffer;
      state.sampleState[key] = 'ready';
    },
    () => {
      state.sampleState[key] = 'failed';
    },
  );
  return true;
}

/**
 * MP3 を取りに行く（何度呼んでもよい）。
 *   · 取得中／デコード中／再生可能 なら何もしない
 *   · 失敗は 15 秒あけて再挑戦（一瞬の通信断で永久にシンセ音にならないように）
 */
function ensureSamples() {
  if (typeof fetch !== 'function') return;
  const now = Date.now();
  for (const key of Object.keys(SFX_FILES)) {
    const status = state.sampleState[key];
    if (status === 'loading' || status === 'decoding' || status === 'ready' || status === 'bytes') continue;
    if (status === 'failed' && now - (state.sampleAt[key] || 0) < 15000) continue;
    state.sampleState[key] = 'loading';
    state.sampleAt[key] = now;
    let request = null;
    try {
      request = fetch(sampleUrl(key), { cache: 'force-cache' });
    } catch {
      request = null;
    }
    if (!request || typeof request.then !== 'function') {
      state.sampleState[key] = 'failed';
      continue;
    }
    request
      .then((response) => {
        if (!response || response.ok === false) throw new Error('sfx fetch failed');
        if (typeof response.arrayBuffer !== 'function') throw new Error('sfx arrayBuffer unsupported');
        return response.arrayBuffer();
      })
      .then((bytes) => {
        if (!bytes || !bytes.byteLength) throw new Error('sfx empty');
        state.sampleBytes[key] = bytes;
        state.sampleState[key] = 'bytes';
        decodeSample(key);
      })
      .catch(() => {
        state.sampleState[key] = 'failed';
        state.sampleAt[key] = Date.now();
      });
  }
}

/**
 * デコード済み MP3 を1枚鳴らす。鳴らせたら true。
 * バッファがまだ無いときは読み込みを促して false を返す（呼び出し側がシンセ音へ落ちる）。
 */
function playSample(key, { delay = 0, gain = 0.35, rate = 1, bus: target = 'sfxBus' } = {}) {
  if (!state.settings.sound) return false;
  const ctx = state.ctx;
  const buffer = state.samples[key];
  if (!ctx || !buffer || !ready()) {
    /* バイトはあるのにバッファが無い（Context を作り直した直後）→ 再デコードだけ試す。
       取りに行くのは unlockAudio() の役目（ジェスチャーの前に通信しない）。 */
    if (ctx && !buffer && state.sampleState[key] === 'bytes') decodeSample(key);
    return false;
  }
  const out = state[target];
  if (!out) return false;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (src.playbackRate) src.playbackRate.value = Math.max(0.25, Math.min(4, rate));
    const amp = ctx.createGain();
    const start = ctx.currentTime + Math.max(0, delay);
    const level = Math.max(0.0002, gain);
    const duration = Number(buffer.duration) > 0 ? Number(buffer.duration) / rate : 1.2;
    const end = start + duration;
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.linearRampToValueAtTime(level, start + Math.min(0.02, duration * 0.2));
    /* 終わりは軽く絞って、ぶつ切りの「プツ」を避ける */
    amp.gain.setValueAtTime(level, Math.max(start + 0.03, end - Math.min(0.09, duration * 0.25)));
    amp.gain.linearRampToValueAtTime(0.0001, end);
    src.connect(amp).connect(out);
    src.start(start);
    src.stop(end + 0.02);
    return true;
  } catch {
    return false;
  }
}

/** 何枚鳴らせたかを数える（1枚でも鳴れば mp3、0枚ならシンセ） */
function playSamples(layers) {
  let played = 0;
  for (const layer of layers) {
    if (playSample(layer.key, layer)) played += 1;
  }
  return played;
}

/* ------------------------------------------------------------------ *\
 * 演出音（Build 6: 棒読みの読み上げを廃止し、音だけで判定を盛り上げる）
 *
 *  Build 4/5 は判定を言葉で叫んでいた（iOS の音声読み上げ機能、ブラウザの
 *  音声合成、どちらも無ければ電子音の合成）。しかし、どの経路も棒読み・電子音に
 *  しかならず、スタジアムの熱狂には届かなかった。Build 6 は音声の読み上げを
 *  完全に外し、着弾の瞬間の「音」だけで演出する:
 *    goal … 低音の厚みのあるブラス和音（スタジアムホーン）
 *            ＋上昇する勝利のファンファーレ。goalRoar() / crowdSurge() と重ねる
 *    save … 観客の「オオオッ！」というどよめき＋力強いグローブストップ＆クリア音
 *    miss … 観客の「アァ〜…」という落胆（ピッチが下がる歓声＋ため息）
 *  鳴らした判定は state.voices / state.lastVoice に残す（テスト・実機検証用）。
 * ------------------------------------------------------------------ */

/** ブラスらしい1音（のこぎり波 → ローパスで開く → ビブラート） */
function brass({ freq, delay = 0, dur = 0.5, gain = 0.05, vibrato = 5.2, bus: target = 'sfxBus' }) {
  const ctx = state.ctx;
  if (!ctx || !ready()) return;
  const out = state[target];
  if (!out) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, start);
  /* ビブラート（人の息が通るブラスらしい揺れ） */
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = vibrato;
  const depth = ctx.createGain();
  depth.gain.value = freq * 0.004;
  lfo.connect(depth).connect(osc.frequency);
  /* 立ち上がりでフィルターが開く（「パァン」と抜ける感じ） */
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.9;
  filter.frequency.setValueAtTime(320, start);
  filter.frequency.linearRampToValueAtTime(2600, start + Math.min(0.14, dur * 0.35));
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.linearRampToValueAtTime(gain, start + Math.min(0.05, dur * 0.2));
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(filter).connect(amp).connect(out);
  osc.start(start);
  lfo.start(start);
  osc.stop(start + dur + 0.02);
  lfo.stop(start + dur + 0.02);
}

/**
 * スタジアムホーン: 低音の厚みのあるブラス和音。
 * F2・A2・C3・F3 の明るく力強い和音に、1オクターブ下を重ねて「ズン」と響かせる。
 */
export function stadiumHorn({ delay = 0, dur = 1.5, gain = 0.075 } = {}) {
  if (!state.settings.sound) return;
  for (const [freq, level] of [[43.65, 0.9], [87.31, 1], [116.54, 0.72], [174.61, 0.85], [349.23, 0.4]]) {
    brass({ freq, delay, dur, gain: gain * level, vibrato: 4.6 });
  }
  /* ホーンの息づかい（空気が抜けるノイズ） */
  noise({ dur: 0.34, gain: 0.06, low: 260, high: 2800, delay, bus: 'sfxBus' });
  vibrate([30, 30, 70]);
}

/**
 * 勝利のファンファーレ: 上昇するブラスのアルペジオ → 最後に高い和音を伸ばす。
 * 「ゴーーーーーール‼️」の達成感を、音程の上昇と余韻で作る。
 */
export function victoryFanfare({ delay = 0.3, gain = 0.045 } = {}) {
  if (!state.settings.sound) return;
  const notes = [[349.23, 0], [440, 0.14], [523.25, 0.28], [698.46, 0.44], [880, 0.66]];
  for (const [freq, step] of notes) {
    brass({ freq, delay: delay + step, dur: 0.44, gain, vibrato: 5.8 });
    brass({ freq: freq / 2, delay: delay + step, dur: 0.42, gain: gain * 0.45, vibrato: 5.2 });
  }
  /* 最後の和音（F メジャー）を重ねて1秒伸ばす */
  for (const [freq, level] of [[523.25, 0.8], [659.25, 0.6], [783.99, 0.6], [1046.5, 0.5]]) {
    brass({ freq, delay: delay + 0.86, dur: 1.1, gain: gain * level, vibrato: 5.4 });
  }
  /* きらめき（ファンファーレの余韻） */
  [1567.98, 2093, 2637.02].forEach((freq, index) => {
    tone({ freq, end: freq, dur: 0.5, gain: 0.018, type: 'triangle', delay: delay + 0.9 + index * 0.07, bus: 'sfxBus' });
  });
}

/** 観客の「オオオッ！」: 上がっていくどよめき（セーブ・好プレー） */
export function crowdOoh({ amount = 1 } = {}) {
  if (!state.settings.sound) return;
  const strength = Math.max(0.3, Math.min(1.6, amount));
  noise({ dur: 0.8, gain: 0.24 * strength, low: 300, high: 2600, q: 0.7, bus: 'crowdBus' });
  /* 「オ」の共鳴が上へ跳ねる（驚き → 称賛） */
  tone({ freq: 208, end: 330, dur: 0.44, gain: 0.055 * strength, type: 'sawtooth', bus: 'crowdBus' });
  tone({ freq: 312, end: 494, dur: 0.38, gain: 0.028 * strength, type: 'sawtooth', bus: 'crowdBus', delay: 0.06 });
  crowdSurge(0.9 * strength);
  vibrate(35);
}

/** 観客の「アァ〜…」: 下がっていく落胆＋ため息（ミスキック） */
export function crowdAww({ amount = 1 } = {}) {
  if (!state.settings.sound) return;
  const strength = Math.max(0.3, Math.min(1.6, amount));
  noise({ dur: 0.95, gain: 0.22 * strength, low: 180, high: 1900, q: 0.6, bus: 'crowdBus' });
  tone({ freq: 300, end: 148, dur: 0.82, gain: 0.05 * strength, type: 'sawtooth', bus: 'crowdBus' });
  tone({ freq: 204, end: 96, dur: 0.72, gain: 0.038 * strength, type: 'sine', bus: 'crowdBus', delay: 0.08 });
  /* ため息（息が抜けるノイズ） */
  noise({ dur: 0.6, gain: 0.085 * strength, low: 500, high: 3200, q: 0.5, delay: 0.2, bus: 'crowdBus' });
  vibrate([18, 45]);
}

/** 力強いグローブストップ＆クリア音（セーブの瞬間の「バシッ」＋抜け） */
export function gloveClear() {
  if (!state.settings.sound) return;
  noise({ dur: 0.13, gain: 0.15, low: 220, high: 3400, q: 1.1 });
  tone({ freq: 240, end: 72, dur: 0.16, gain: 0.1, type: 'square' });
  noise({ dur: 0.36, gain: 0.06, low: 1400, high: 6800, q: 0.4, delay: 0.1 });
}

/* ------------------------------------------------------------------ *\
 * Build 8: 本物のスタジアム音を重ねる判定演出
 *
 * MP3 が1枚でも鳴ればそれを主役にし、1枚も鳴らない（読み込み前・失敗・
 * 非対応環境）ときは従来のシンセ音（Build 6 のスタジアムホーン／ファンファーレ／
 * どよめき／落胆）へそのまま落ちる。どちらの道でも途中で throw しない。
 * ------------------------------------------------------------------ */

/** ゴール: スタジアム大歓声 ＋ エアーホーン ＋ 勝利ファンファーレ ＋ 男衆の「イエーイ！」 */
function goalShowcase() {
  const played = playSamples([
    { key: 'cheer', gain: 0.55, bus: 'crowdBus' },
    { key: 'horn', gain: 0.46, delay: 0.04 },
    { key: 'fanfare', gain: 0.4, delay: 0.16 },
    { key: 'yeah', gain: 0.26, delay: 0.36, bus: 'crowdBus' },
  ]);
  if (!played) {
    stadiumHorn();
    victoryFanfare();
    return 'synth';
  }
  return 'mp3';
}

/** セーブ: 「オーッ！」＋小さめの「わぁーーっ」＋グローブのクリア音 */
function saveShowcase() {
  const played = playSamples([
    { key: 'oo', gain: 0.5, bus: 'crowdBus' },
    { key: 'uwaa', gain: 0.16, delay: 0.1, bus: 'crowdBus' },
  ]);
  gloveClear();
  if (!played) crowdOoh();
  return played ? 'mp3' : 'synth';
}

/** ミス: 従来の落胆＋スタジアムの反応を少しだけ（低くゆっくり＝ため息寄り） */
function missShowcase() {
  crowdAww();
  const added = playSample('oo', { gain: 0.18, rate: 0.78, bus: 'crowdBus' });
  return added ? 'mixed' : 'synth';
}

/**
 * 優勝・決着の演出。勝ちはファンファーレ＋大歓声＋「イエーイ！」で華やかに、
 * 負け・引き分けはスタジアムの反応を小さく添える。
 */
export function champion({ win = true } = {}) {
  if (!state.settings.sound) return null;
  let played = 0;
  if (win) {
    played = playSamples([
      { key: 'fanfare', gain: 0.48, delay: 0.05 },
      { key: 'cheer', gain: 0.5, bus: 'crowdBus' },
      { key: 'yeah', gain: 0.26, delay: 0.32, bus: 'crowdBus' },
    ]);
    if (!played) {
      victoryFanfare({ delay: 0.05 });
      crowdOoh({ amount: 1.1 });
    }
  } else {
    played = playSample('oo', { gain: 0.22, rate: 0.86, bus: 'crowdBus' }) ? 1 : 0;
    crowdAww({ amount: 0.8 });
  }
  const kind = win ? 'champion' : 'defeat';
  state.voices[kind] = (state.voices[kind] || 0) + 1;
  state.lastVoice = { kind, mode: 'showcase', source: played ? 'mp3' : 'synth', at: Date.now() };
  return { ...state.lastVoice };
}

/** 判定ごとの演出音の組み合わせ */
const SHOWCASE = {
  goal: goalShowcase,
  save: saveShowcase,
  miss: missShowcase,
};

/**
 * 判定の演出音。kind = 'goal' | 'save' | 'miss'。
 * 棒読みの読み上げは行わない（Build 6 で廃止）。音OFFなら null。
 * 鳴らしたら { kind, mode: 'showcase' } を返し、state に記録する。
 */
export function voice(kind) {
  if (!state.settings.sound) return null;
  const play = SHOWCASE[kind];
  if (!play) return null;
  const source = play();
  state.voices[kind] = (state.voices[kind] || 0) + 1;
  state.lastVoice = { kind, mode: 'showcase', source: source || 'synth', at: Date.now() };
  return { kind, mode: 'showcase' };
}

/* ------------------------------------------------------------------ *\
 * 国別の歓声（試合中ずっと薄く流す）
 * ------------------------------------------------------------------ */

function chantPattern(crowd, step) {
  const beat = crowd.chant[step % crowd.chant.length];
  const beatsPerBar = 8;
  return beat < beatsPerBar;
}

export function startCrowd(country) {
  const ctx = state.ctx;
  if (!ctx || !ready()) return;
  state.country = country || state.country;
  stopCrowd();
  const crowd = (state.country && state.country.crowd) || { density: 0.9, bright: 3200, chant: [0, 2, 4], drums: 0.5 };
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = crowd.bright;
  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 140;
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  src.connect(filter).connect(high).connect(gain).connect(state.crowdBus);
  src.start();
  gain.gain.setTargetAtTime(0.22 * crowd.density, ctx.currentTime, 0.6);
  state.crowdSource = src;
  state.crowdFilter = filter;
  state.crowdGain = gain;

  /* 太鼓とチャント（8分音符ごと） */
  let step = 0;
  const interval = 240; /* ms ≒ 125 BPM の8分 */
  state.crowdTimer = setInterval(() => {
    if (!state.settings.sound || !ready()) return;
    step += 1;
    const bar = step % 8;
    if (bar === 0 || (bar === 4 && crowd.drums > 0.6)) {
      tone({ freq: 92, end: 52, dur: 0.18, gain: 0.05 * (crowd.drums || 0.5), type: 'sine', bus: 'crowdBus' });
      noise({ dur: 0.1, gain: 0.05 * (crowd.drums || 0.5), low: 120, high: 900, bus: 'crowdBus' });
    }
    if (chantPattern(crowd, step)) {
      /* 「オォー」のような共鳴（フォルマント2つ） */
      tone({ freq: 196 + (step % 3) * 12, end: 210 + (step % 3) * 8, dur: 0.34, gain: 0.016, type: 'sawtooth', bus: 'crowdBus' });
      noise({ dur: 0.28, gain: 0.02, low: 400, high: 1200, q: 1.2, bus: 'crowdBus' });
    }
  }, interval);
}

export function stopCrowd() {
  clearInterval(state.crowdTimer);
  state.crowdTimer = null;
  const ctx = state.ctx;
  if (state.crowdGain && ctx) {
    state.crowdGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
    const src = state.crowdSource;
    setTimeout(() => {
      try {
        src?.stop();
      } catch {
        /* already stopped */
      }
    }, 700);
  }
  state.crowdSource = null;
  state.crowdGain = null;
  state.crowdFilter = null;
}

/** 盛り上がり（得点後・試合終盤） */
export function crowdSurge(amount = 1) {
  const ctx = state.ctx;
  if (!ctx || !state.crowdGain || !ready()) return;
  const target = Math.min(0.52, 0.22 + amount * 0.2);
  state.crowdGain.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
  setTimeout(() => {
    if (!state.crowdGain) return;
    state.crowdGain.gain.setTargetAtTime(0.24, ctx.currentTime, 1.1);
  }, 1200);
}

/* ------------------------------------------------------------------ *\
 * BGM（スタジアムのグルーヴ・軽く）
 * ------------------------------------------------------------------ */

const CHORDS = [
  [110, 164.81, 220],
  [98, 146.83, 196],
  [87.31, 130.81, 174.61],
  [98, 146.83, 196],
];

export function startMusic() {
  if (!state.ctx || !state.settings.bgm || state.musicTimer) return;
  const beat = () => {
    if (!state.settings.bgm || !ready()) return;
    const step = state.musicStep % 8;
    const chord = CHORDS[Math.floor(state.musicStep / 8) % CHORDS.length];
    if (step % 2 === 0) {
      tone({ freq: chord[0] / 2, end: chord[0] / 2, dur: 0.3, gain: 0.05, type: 'triangle', bus: 'musicBus' });
      chord.forEach((freq) => tone({ freq, end: freq, dur: 0.55, gain: 0.012, type: 'sine', bus: 'musicBus' }));
    }
    if (step === 2 || step === 6) noise({ dur: 0.1, gain: 0.02, low: 2000, high: 8000, bus: 'musicBus' });
    if (step === 0 || step === 4) noise({ dur: 0.12, gain: 0.035, low: 80, high: 500, bus: 'musicBus' });
    state.musicStep += 1;
  };
  beat();
  state.musicTimer = setInterval(beat, 300);
}

export function stopMusic() {
  clearInterval(state.musicTimer);
  state.musicTimer = null;
}

/* ------------------------------------------------------------------ *\
 * OP（オープニング）の歓声
 * ------------------------------------------------------------------ */

export function openingCrowd(seconds = 3) {
  if (!state.settings.sound) return;
  const d = Math.max(0.3, Math.min(4, seconds));
  noise({ dur: d, gain: 0.14, low: 200, high: 3600, q: 0.5, bus: 'crowdBus' });
  [392, 523.25, 659.25, 783.99].forEach((freq, index) => {
    if (index * 0.18 < d) {
      tone({ freq, end: freq, dur: Math.min(0.5, d), gain: 0.02, type: 'triangle', delay: index * 0.16, bus: 'crowdBus' });
    }
  });
  tone({ freq: 116, end: 58, dur: d * 0.8, gain: 0.06, type: 'triangle', bus: 'crowdBus' });
}

/**
 * 設定画面の「音をテスト」。スピーカー・消音スイッチ・音量の確認用に、
 * ホイッスル → キック → ゴール歓声 を1回鳴らす。
 */
export function testSound() {
  const ok = unlockAudio();
  const before = { ...state.settings };
  /* テスト中だけ音を出す（終わったら元のON/OFFへ戻す） */
  configureAudio({ sound: true, bgm: before.bgm });
  whistle();
  kickSound();
  setTimeout(() => netSound(), 220);
  setTimeout(() => goalRoar(1.6), 300);
  setTimeout(() => crowdSurge(1), 320);
  setTimeout(() => voice('goal'), 340);
  setTimeout(() => configureAudio(before), 2600);
  return ok;
}

/**
 * アプリを離れるとき（ホーム画面・他アプリ・ロック）に、鳴っているものを全部止める。
 *   · BGM・歓声のタイマーを止める
 *   · 無音の下支え <audio> を止める（Dynamic Island のスピーカー印のため）
 *   · AudioContext を suspend（音声セッションを握り続けない）
 * 戻ってきたら resumeFromBackground() で再開する。
 */
/* ------------------------------------------------------------------ *\
 * バックグラウンドから戻ったとき（Build 4で補強）
 *
 * iPhone でホームに戻ったり、他のアプリへ移ってから戻ると音が出なくなる
 * （WKWebView の AudioContext も、下支えの無音 <audio> も止まるため）。
 * 戻ったら次の順で確実に起こし直す:
 *   1. アプリ側の AVAudioSession を再アクティブ化（Capacitor ブリッジ activate）
 *   2. AudioContext.resume()（返らない環境があるので、少し後にもう一度）
 *   3. 無音 <audio> を（消えていれば作り直して）再再生
 *   4. BGM・歓声を再開
 * どの段が失敗してもゲームは止めない。
 * ------------------------------------------------------------------ */

/** 無音の下支え <audio> を（必要なら作り直して）鳴らす */
function ensureSilentAudio() {
  if (!state.unlocked) return null;
  if (!state.silent) {
    try {
      const audio = new Audio(SILENT_WAV);
      audio.loop = true;
      audio.volume = 0.001;
      state.silent = audio;
    } catch {
      return null;
    }
  }
  try {
    state.silent.play?.()?.catch?.(() => {});
  } catch {
    /* 下支えが無くても鳴る */
  }
  return state.silent;
}

/** iOS 側の Audio Session を起こし直す（プラグインが無い環境では何もしない） */
function activateBridge() {
  if (typeof navigator !== 'undefined' && navigator.audioSession) {
    try {
      navigator.audioSession.type = 'playback';
    } catch {
      /* 未対応 */
    }
  }
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  const bridge = cap && cap.Plugins && cap.Plugins.ShootoutAudio;
  if (bridge && typeof bridge.activate === 'function') {
    try {
      bridge.activate().catch(() => {});
    } catch {
      /* ブリッジが古くても続ける */
    }
  }
}

/**
 * タップ・クリック・キー入力のたびに呼ぶ安全策。
 *
 * Build 6: iOS の WKWebView では、バックグラウンドで AVAudioSession を手放して
 * `ctx.suspend()` した後、古い AudioContext に `resume()` を呼んでも OS の
 * オーディオ出力と再接続されず無音のままになることがある（`ctx.state` は
 * 'running' に見えても音が出ない）。そこで、復帰後の最初のユーザー操作（この関数が
 * 呼ばれるタイミング＝本物のタップ）で、古い Context を `close()` して捨て、
 * `createContext()` で新しく作り直し、バス・BGM・歓声を張り直す。
 *   ！ 復帰直後（needsGestureRecovery）／closed → Context を作り直す（戻り値 true）
 *   ！ suspended / interrupted → resume + ブリッジ + 無音1サンプル + 下支え
 *   ！ running → 下支えだけ確かめる（戻り値 false）
 * 戻り値 true は「作り直した」＝呼び出し側で歓声を張り直す合図。
 */
export function ensureAudioRunning() {
  if (!state.ctx) return false;
  const force = state.needsGestureRecovery || state.ctx.state === 'closed';
  if (!force) {
    if (state.ctx.state === 'running') {
      ensureSilentAudio();
      return false;
    }
    try {
      state.ctx.resume().catch(() => {});
    } catch {
      /* closed でもゲームは続ける */
    }
    activateBridge();
    silentPoke();
    ensureSilentAudio();
    state.recoveries += 1;
    return false;
  }
  /* 復帰後・closed: 古い Context は捨てて、新しいものを作る */
  stopCrowd();
  stopMusic();
  try {
    state.ctx.close();
  } catch {
    /* すでに閉じていても続ける */
  }
  state.ctx = null;
  if (!createContext()) {
    state.needsGestureRecovery = true;
    return false;
  }
  state.needsGestureRecovery = false;
  /* createContext() がバスと音量を作り直す。念のため当て直す */
  applyVolumes();
  activateBridge();
  silentPoke();
  ensureSilentAudio();
  /* BGM はタイマーごと張り直す（古いタイマーは古い Context を指している） */
  if (state.settings.bgm) {
    stopMusic();
    startMusic();
  }
  state.recoveries += 1;
  return true;
}

export function suspendForBackground() {
  state.backgrounded = true;
  /* Build 5: 戻った後の最初の操作で、必ず一度は音の経路を起こし直す */
  state.needsGestureRecovery = true;
  stopCrowd();
  stopMusic();
  try {
    state.silent?.pause?.();
  } catch {
    /* 下支えが無くても止められる */
  }
  /* Build 6: pause() した古い <audio> を再利用せず捨てる */
  state.silent = null;
  const ctx = state.ctx;
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
  /* iOS: アプリ側の Audio Session も手放す（Dynamic Island のスピーカー印対策） */
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  const bridge = cap && cap.Plugins && cap.Plugins.ShootoutAudio;
  if (bridge && typeof bridge.deactivate === 'function') bridge.deactivate().catch(() => {});
  return audioState();
}

export function resumeFromBackground({ crowd = false } = {}) {
  const wasBackground = state.backgrounded;
  state.backgrounded = false;
  /* Build 5: 戻った直後の最初のユーザー操作で、もう一度パイプラインを起こす */
  state.needsGestureRecovery = true;
  /* closed になっていたら作り直す（バスも張り直す） */
  if (state.ctx && state.ctx.state === 'closed') {
    stopCrowd();
    stopMusic();
    createContext();
  }
  const ctx = state.ctx;
  if (!ctx) {
    /* まだ一度も音を起こしていない（初回起動） */
    return audioState();
  }
  /* 1. アプリ側の Audio Session */
  activateBridge();
  /* 2. AudioContext（resume が返らない環境向けに、少し後にもう一度呼ぶ） */
  const resume = () => {
    try {
      ctx.resume().catch(() => {});
    } catch {
      /* closed でもゲームは続ける */
    }
  };
  resume();
  setTimeout(resume, 140);
  /* 2b. 無音1サンプル（これがないと iOS で復帰後も無音のままになることがある） */
  silentPoke();
  /* 3. 無音の下支え（消えていたら作り直す） */
  ensureSilentAudio();
  /* 4. BGM・歓声 */
  if (state.settings.bgm) startMusic();
  if (wasBackground && crowd) startCrowd(state.country);
  state.recoveries += 1;
  return audioState();
}

/** テスト用: 内部状態（画面を出さずに確認する） */
export function audioState() {
  return {
    ready: ready(),
    context: state.ctx ? state.ctx.state : 'none',
    settings: { ...state.settings },
    crowd: Boolean(state.crowdSource),
    music: Boolean(state.musicTimer),
    country: state.country ? state.country.code : null,
    backgrounded: Boolean(state.backgrounded),
    voice: state.lastVoice ? { ...state.lastVoice } : null,
    voices: { ...state.voices },
    needsGestureRecovery: Boolean(state.needsGestureRecovery),
    silent: Boolean(state.silent),
    recoveries: state.recoveries,
    /* Build 8: 本物のスタジアム音（MP3）の状態。'ready' だけが再生できる */
    samples: Object.fromEntries(
      Object.keys(SFX_FILES).map((key) => [key, state.samples[key] ? 'ready' : (state.sampleState[key] || 'idle')]),
    ),
    sampleSource: state.lastVoice?.source ?? null,
  };
}
