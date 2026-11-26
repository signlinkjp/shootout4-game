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

const PREFIX = 'shootout4.';
export const KEYS = Object.freeze({
  prefs: `${PREFIX}settings.v1`,
  record: `${PREFIX}record.v1`,
  pro: `${PREFIX}pro.v1`,
  skin: `${PREFIX}skin.v1`,
  online: `${PREFIX}online.v1`,
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
});

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

export function resetRecord(storage) {
  writeJSON(storage, KEYS.record, EMPTY_RECORD);
  return { ...EMPTY_RECORD };
}
