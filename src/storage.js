/**
 * SHOOTOUT 4 — 端末内の保存（設定・戦績・PROの控え）
 *
 * localStorage が使えない（プライベートブラウズ等）ときは、その場だけの
 * メモリ保存に切り替えてゲームを止めない。保存できなかったことは画面に出さない
 * （遊べることが優先）。
 */

import { DEFAULT_PREFS } from './config.js';
import { detectLanguage, isLanguage } from './i18n.js';
import { isLevel, normalizeLevel } from './core/cpu.js';
import { COUNTRY_CODES } from './core/countries.js';
import { DIRECTIONS } from './core/rules.js';
import {
  addToTally, emptyStanding, emptyTally, normalizeStanding, pointsFor, rollStanding,
} from './core/ranking.js';

const PREFIX = 'shootout4.';
export const KEYS = Object.freeze({
  prefs: `${PREFIX}settings.v1`,
  record: `${PREFIX}record.v1`,
  pro: `${PREFIX}pro.v1`,
  skin: `${PREFIX}skin.v1`,
  online: `${PREFIX}online.v1`,
  /* Build 4: IPKSF ランキング（勝ち点の累積）と、キック方向の回数 */
  standing: `${PREFIX}standing.v1`,
  shots: `${PREFIX}shots.v1`,
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

export function openStorage() {
  try {
    const storage = window.localStorage;
    storage.setItem(`${PREFIX}check`, '1');
    storage.removeItem(`${PREFIX}check`);
    return storage;
  } catch {
    return memoryStorage();
  }
}

export function readJSON(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writeJSON(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const TEXT_SIZES = Object.freeze(['standard', 'large', 'extra']);
export const SIZE_SCALE = Object.freeze({ standard: 1, large: 1.14, extra: 1.3 });

/** 設定を読み、型・値域を検証してから返す（壊れた保存値でUIが崩れない） */
export function loadPrefs(storage, languages) {
  const saved = readJSON(storage, KEYS.prefs, {}) || {};
  const detected = detectLanguage(languages || []);
  const prefs = {
    ...DEFAULT_PREFS,
    ...saved,
    language: isLanguage(saved.language) ? saved.language : detected,
    size: TEXT_SIZES.includes(saved.size) ? saved.size : 'standard',
    country: COUNTRY_CODES.includes(saved.country) ? saved.country : 'JP',
    level: isLevel(saved.level) ? saved.level : 'normal',
    nickname: typeof saved.nickname === 'string' ? saved.nickname.slice(0, 12) : '',
    sound: saved.sound !== false,
    bgm: saved.bgm !== false,
    vibrate: saved.vibrate !== false,
    night: saved.night === true,
    flash: saved.flash !== false,
    order: saved.order === 'second' ? 'second' : 'first',
  };
  return prefs;
}

export function savePrefs(storage, prefs) {
  const safe = {
    ...prefs,
    level: normalizeLevel(prefs.level),
  };
  return writeJSON(storage, KEYS.prefs, safe);
}

export const EMPTY_RECORD = Object.freeze({
  played: 0,
  wins: 0,
  losses: 0,
  goals: 0,
  conceded: 0,
  saves: 0,
  shots: 0,
  streak: 0,
  bestStreak: 0,
  sudden: 0,
  /* 通信対戦（相手がいる対人戦）の通算。CPU戦績とは別枠で、リセットでも消さない */
  onlinePlayed: 0,
  onlineWins: 0,
  onlineLosses: 0,
  onlineGoals: 0,
  onlineConceded: 0,
  onlineStreak: 0,
  onlineBestStreak: 0,
  points: 0,
});

/** CPU戦績だけを持つキー（画面の「リセット」で消える範囲） */
export const CPU_RECORD_KEYS = Object.freeze([
  'played', 'wins', 'losses', 'goals', 'conceded', 'saves', 'shots', 'streak', 'bestStreak', 'sudden',
]);

/** 通信対戦の通算（PRO）を持つキー。CPUのリセットでは触らない */
export const ONLINE_RECORD_KEYS = Object.freeze([
  'onlinePlayed', 'onlineWins', 'onlineLosses', 'onlineGoals', 'onlineConceded',
  'onlineStreak', 'onlineBestStreak', 'points',
]);

export function loadRecord(storage) {
  const saved = readJSON(storage, KEYS.record, {}) || {};
  const record = { ...EMPTY_RECORD };
  for (const key of Object.keys(EMPTY_RECORD)) {
    const value = Number(saved[key]);
    record[key] = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }
  return record;
}

export function saveRecord(storage, record) {
  return writeJSON(storage, KEYS.record, record);
}

/**
 * 試合結果を戦績へ足す（純粋関数）。
 *  goals … 自分が決めた本数 / conceded … 相手に決められた本数
 *  saves … 自分が止めた本数 / shots … 自分が蹴った本数
 */
export function addResult(record, { winner, goals = 0, conceded = 0, saves = 0, shots = 0, sudden = false }) {
  const win = winner === 'me';
  const streak = win ? record.streak + 1 : 0;
  return {
    ...record,
    played: record.played + 1,
    wins: record.wins + (win ? 1 : 0),
    losses: record.losses + (win ? 0 : 1),
    goals: record.goals + goals,
    conceded: record.conceded + conceded,
    saves: record.saves + saves,
    shots: record.shots + shots,
    streak,
    bestStreak: Math.max(record.bestStreak, streak),
    sudden: record.sudden + (sudden ? 1 : 0),
  };
}

export function resetRecord(storage, current = EMPTY_RECORD) {
  /* CPU戦績だけを消す（通信対戦の通算は残す） */
  const next = { ...EMPTY_RECORD };
  for (const key of ONLINE_RECORD_KEYS) next[key] = Number(current[key]) || 0;
  writeJSON(storage, KEYS.record, next);
  return next;
}

/**
 * 通信対戦（相手がいる対人戦）の通算を足す（純粋関数）。
 * ランキングの勝ち点もここで動かす（IPKSF 公式: 5本以内勝3 / サドンデス勝2 / サドンデス負1 / 5本以内負0）。
 * sudden = サドンデスにもつれた試合か（6本目以降に入ったか）。
 */
export function addOnlineResult(record, { winner, goals = 0, conceded = 0, sudden = false }) {
  const win = winner === 'me';
  const streak = win ? (record.onlineStreak || 0) + 1 : 0;
  const points = (record.points || 0) + pointsFor({ win, sudden });
  return {
    ...record,
    onlinePlayed: (record.onlinePlayed || 0) + 1,
    onlineWins: (record.onlineWins || 0) + (win ? 1 : 0),
    onlineLosses: (record.onlineLosses || 0) + (win ? 0 : 1),
    onlineGoals: (record.onlineGoals || 0) + goals,
    onlineConceded: (record.onlineConceded || 0) + conceded,
    onlineStreak: streak,
    onlineBestStreak: Math.max(record.onlineBestStreak || 0, streak),
    points: Math.max(0, points),
  };
}

/* ------------------------------------------------------------------ *\
 * IPKSF ランキング（Build 4）
 *   総合・勝率は累積、月間は毎月1日、週間は毎週月曜に自動でリセット。
 *   保存値が壊れていても落ちない（期間キーが古ければその期間は0）。
 * ------------------------------------------------------------------ */

export function loadStanding(storage, date = new Date()) {
  const saved = readJSON(storage, KEYS.standing, null);
  const { standing } = rollStanding(saved || emptyStanding(date), date);
  return standing;
}

export function saveStanding(storage, standing) {
  return writeJSON(storage, KEYS.standing, standing);
}

/** 1試合の結果をランキングへ足して保存する（勝敗・得失点・サドンデスか） */
export function recordStanding(storage, standing, { winner, goals = 0, conceded = 0, sudden = false } = {}, date = new Date()) {
  const { standing: rolled } = rollStanding(standing, date);
  const next = {
    ...rolled,
    total: addToTally(rolled.total, { win: winner === 'me', sudden, goals, conceded }),
    month: { key: rolled.month.key, ...addToTally(rolled.month, { win: winner === 'me', sudden, goals, conceded }) },
    week: { key: rolled.week.key, ...addToTally(rolled.week, { win: winner === 'me', sudden, goals, conceded }) },
  };
  saveStanding(storage, next);
  return next;
}

/* ------------------------------------------------------------------ *\
 * キック傾向（自分が蹴った方向の回数）
 * ------------------------------------------------------------------ */

export const EMPTY_SHOTS = Object.freeze({ TL: 0, TR: 0, BL: 0, BR: 0 });

export function loadShots(storage) {
  const saved = readJSON(storage, KEYS.shots, {}) || {};
  const shots = { ...EMPTY_SHOTS };
  for (const dir of DIRECTIONS) {
    const value = Number(saved[dir]);
    shots[dir] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  return shots;
}

export function saveShots(storage, shots) {
  return writeJSON(storage, KEYS.shots, shots);
}

/** 1本ぶん数える（純粋関数）。4択のどれでもない（枠外）は数えない。 */
export function addShotDirection(shots, dir) {
  if (!DIRECTIONS.includes(dir)) return { ...EMPTY_SHOTS, ...shots };
  const next = { ...EMPTY_SHOTS, ...shots };
  next[dir] = (Number(next[dir]) || 0) + 1;
  return next;
}

/** 合計と割合（%）。合計0なら割合は0。 */
export function shotSummary(shots) {
  const safe = { ...EMPTY_SHOTS, ...shots };
  const total = DIRECTIONS.reduce((sum, dir) => sum + (Number(safe[dir]) || 0), 0);
  const rows = DIRECTIONS.map((dir) => {
    const count = Number(safe[dir]) || 0;
    return { dir, count, rate: total ? Math.round((count / total) * 100) : 0 };
  });
  return { total, rows };
}

export { emptyTally, normalizeStanding };
