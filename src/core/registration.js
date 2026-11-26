/**
 * SHOOTOUT 4 — IPKSF 公式選手登録（ハイブリッド）
 *
 * ・CPU戦・フリー対戦は登録なしで0秒で遊べる（毎回好きな国を選べる）。
 * ・IPKSF 公式戦（世界ランキング／世界対戦）では、登録した代表国で戦う。
 * ・チームメイト2〜5番の名前・利き足は任意。未登録なら「Player 2」等＋右足。
 * ・CPU の利き足はラウンド／選手ごとに決まる（同じ試合では毎回同じ：通信でも一致）。
 *
 * 保存するのは端末内だけ（サーバーへは送らない）。
 */

import { COUNTRY_CODES } from './countries.js';

export const FOOTS = Object.freeze(['right', 'left']);
export const ROSTER_SIZE = 5;
export const MAX_NAME = 12;
export const MAX_TEAM = 16;

const KEY = 'shootout4.player.v1';

export const DEFAULT_REGISTRATION = Object.freeze({
  language: null,
  country: 'JP',
  teamName: '',
  userName: '',
  foot: 'right',
  teammates: Object.freeze([
    Object.freeze({ name: '', foot: 'right' }),
    Object.freeze({ name: '', foot: 'right' }),
    Object.freeze({ name: '', foot: 'right' }),
    Object.freeze({ name: '', foot: 'right' }),
  ]),
});

export function normalizeFoot(value) {
  return value === 'left' ? 'left' : 'right';
}

function cleanName(value, max = MAX_NAME) {
  if (typeof value !== 'string') return '';
  /* 改行・制御文字は入れない（1行の名前だけ） */
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeRegistration(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const teammates = Array.from({ length: 4 }, (_, index) => {
    const item = Array.isArray(source.teammates) ? source.teammates[index] : null;
    const player = item && typeof item === 'object' ? item : {};
    return { name: cleanName(player.name), foot: normalizeFoot(player.foot) };
  });
  return {
    language: typeof source.language === 'string' ? source.language : null,
    country: COUNTRY_CODES.includes(source.country) ? source.country : 'JP',
    teamName: cleanName(source.teamName, MAX_TEAM),
    userName: cleanName(source.userName),
    foot: normalizeFoot(source.foot),
    teammates,
  };
}

export function readRegistration(backend) {
  if (!backend) return normalizeRegistration(DEFAULT_REGISTRATION);
  try {
    return normalizeRegistration(JSON.parse(backend.getItem(KEY) || '{}'));
  } catch {
    return normalizeRegistration(DEFAULT_REGISTRATION);
  }
}

export function writeRegistration(backend, registration) {
  const clean = normalizeRegistration(registration);
  if (backend) {
    try {
      backend.setItem(KEY, JSON.stringify(clean));
    } catch {
      /* プライベートブラウズでも、その場の登録は使える */
    }
  }
  return clean;
}

/** 公式選手登録が済んでいるか（名前かチーム名が入っていれば「登録済み」） */
export function isRegistered(registration) {
  const clean = normalizeRegistration(registration);
  return Boolean(clean.userName || clean.teamName);
}

/** 表示用の名前（未入力なら既定表記） */
export function playerName(registration, number, { countryLabel = 'PLAYER' } = {}) {
  const clean = normalizeRegistration(registration);
  if (number <= 1) return clean.userName || countryLabel;
  return clean.teammates[number - 2]?.name || `Player ${number}`;
}

/** 表示用の利き足 */
export function playerFoot(registration, number) {
  const clean = normalizeRegistration(registration);
  if (number <= 1) return clean.foot;
  return clean.teammates[number - 2]?.foot || 'right';
}

/** キッカー1〜5（サドンデスは6本目から1に戻る）の並び */
export function roster(registration, { countryLabel = 'PLAYER' } = {}) {
  return Array.from({ length: ROSTER_SIZE }, (_, index) => ({
    number: index + 1,
    name: playerName(registration, index + 1, { countryLabel }),
    foot: playerFoot(registration, index + 1),
  }));
}

export function playerFor(registration, number, options) {
  const index = ((Math.max(1, Number(number) || 1) - 1) % ROSTER_SIZE) + 1;
  return {
    number: index,
    name: playerName(registration, index, options),
    foot: playerFoot(registration, index),
  };
}

/** CPU の利き足（ラウンドと選手番号から決まる。乱数を使わないので通信でも一致） */
export function cpuFoot(round, number, seed = '') {
  const text = `${seed}:${number}:${round}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 2 === 0) ? 'right' : 'left';
}

/** CPU（相手）の選手。名前は国の名前＋番号、利き足はラウンドごとに変わる */
export function cpuPlayer(round, number, { countryLabel = 'CPU', seed = '' } = {}) {
  const index = ((Math.max(1, Number(number) || 1) - 1) % ROSTER_SIZE) + 1;
  return {
    number: index,
    name: `${countryLabel} ${index}`,
    foot: cpuFoot(round, index, seed),
  };
}

/** IPKSF 公式戦で使う代表国（未登録なら普段の国） */
export function officialCountry(registration, fallback = 'JP') {
  const raw = registration && typeof registration === 'object' ? registration.country : null;
  if (COUNTRY_CODES.includes(raw)) return raw;
  return COUNTRY_CODES.includes(fallback) ? fallback : 'JP';
}

export function registrationSummary(registration, { countryLabel = '', languageName = '' } = {}) {
  const clean = normalizeRegistration(registration);
  return {
    registered: isRegistered(clean),
    country: clean.country,
    countryLabel,
    teamName: clean.teamName,
    userName: clean.userName || countryLabel,
    foot: clean.foot,
    language: clean.language,
    languageName,
    teammates: clean.teammates.map((item, index) => ({
      number: index + 2,
      name: item.name || `Player ${index + 2}`,
      foot: item.foot,
    })),
  };
}
