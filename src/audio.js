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

export function unlockAudio() {
  try {
    if (!state.ctx) {
      const Ctor = AC();
      if (!Ctor) return false;
      state.ctx = new Ctor({ latencyHint: 'interactive' });
      state.master = state.ctx.createGain();
      state.master.gain.value = 0.9;
      state.master.connect(state.ctx.destination);
      bus('sfxBus', 0.9);
      bus('musicBus', 0.5);
      bus('crowdBus', 0.75);
      state.noise = null;
    }
    /* resume() は環境によっては返ってこない。await せずに走らせる
       （音が鳴らなくてもゲームは止めない） */
    if (state.ctx.state === 'suspended') {
      state.ctx.resume().catch(() => {});
    }
    /* iOS: アプリ側の Audio Session を playback にする（AppDelegate のブリッジ） */
    if (typeof navigator !== 'undefined' && navigator.audioSession) {
      try {
        navigator.audioSession.type = 'playback';
      } catch {
        /* 未対応 */
      }
    }
    if (!state.unlocked) {
      state.unlocked = true;
      try {
        const audio = new Audio(SILENT_WAV);
        audio.loop = true;
        audio.volume = 0.001;
        audio.play().catch(() => {});
        state.silent = audio;
      } catch {
        /* 下支えが無くても鳴る */
      }
    }
    const cap = typeof window !== 'undefined' ? window.Capacitor : null;
    const bridge = cap && cap.Plugins && cap.Plugins.ShootoutAudio;
    if (bridge && typeof bridge.activate === 'function') bridge.activate().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export function configureAudio(settings) {
  state.settings = { ...state.settings, ...settings };
  if (!state.ctx) return;
  const now = state.ctx.currentTime;
  state.sfxBus?.gain.setTargetAtTime(state.settings.sound ? 0.9 : 0.0001, now, 0.05);
  state.musicBus?.gain.setTargetAtTime(state.settings.bgm ? 0.38 : 0.0001, now, 0.08);
  state.crowdBus?.gain.setTargetAtTime(state.settings.sound ? 0.7 : 0.0001, now, 0.08);
  if (state.settings.bgm) startMusic();
  else stopMusic();
}

export function ready() {
  return Boolean(state.ctx && state.ctx.state === 'running');
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
  noise({ dur: d, gain: 0.22, low: 220, high: 4200, q: 0.5, bus: 'crowdBus' });
  noise({ dur: d * 0.8, gain: 0.12, low: 900, high: 6200, q: 0.4, bus: 'crowdBus' });
  /* スタジアムホーン */
  tone({ freq: 233, end: 233, dur: 0.5, gain: 0.05, type: 'sawtooth', bus: 'sfxBus' });
  tone({ freq: 349, end: 349, dur: 0.5, gain: 0.035, type: 'sawtooth', bus: 'sfxBus' });
  /* ファンファーレ */
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
    tone({ freq, end: freq, dur: 0.32, gain: 0.035, type: 'triangle', delay: 0.1 + index * 0.11 });
  });
  vibrate([40, 40, 70]);
}

export function saveGroan() {
  if (!state.settings.sound) return;
  noise({ dur: 0.85, gain: 0.16, low: 180, high: 1300, q: 0.6, bus: 'crowdBus' });
  tone({ freq: 320, end: 190, dur: 0.5, gain: 0.045, type: 'sine', delay: 0.05 });
  vibrate(50);
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
  gain.gain.setTargetAtTime(0.16 * crowd.density, ctx.currentTime, 0.6);
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
  const target = Math.min(0.4, 0.16 + amount * 0.16);
  state.crowdGain.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
  setTimeout(() => {
    if (!state.crowdGain) return;
    state.crowdGain.gain.setTargetAtTime(0.18, ctx.currentTime, 1.1);
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

/** テスト用: 内部状態（画面を出さずに確認する） */
export function audioState() {
  return {
    ready: ready(),
    settings: { ...state.settings },
    crowd: Boolean(state.crowdSource),
    music: Boolean(state.musicTimer),
    country: state.country ? state.country.code : null,
  };
}
