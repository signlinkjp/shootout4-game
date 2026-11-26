/**
 * SHOOTOUT 4 — IPKSF 公式ランキング（勝ち点・期間・並び順）
 *
 * ここは純粋関数だけ（DOMも通信も知らない）。画面・保存・通信が同じ計算を使う。
 *
 * ■ IPKSF 公式の勝ち点（Build 4）
 *     5本以内の勝利   +3pt   （通常PKの5本ずつで決着）
 *     サドンデス勝利  +2pt   （6本目以降までもつれて勝った）
 *     サドンデス敗北  +1pt   （6本目以降までもつれて負けた）
 *     5本以内の敗北    0pt
 *   勝ち点は累積で、負けてもマイナスにはならない（下限0）。
 *
 * ■ 順位の決め方
 *   勝ち点 → 得失点差（総得点 − 総失点） → 総ゴール数 → 勝率
 *
 * ■ 集計の軸（タブ）
 *   総合 … ずっと累積（リセットなし）
 *   月間 … 毎月1日から（月が変わると自動で0から）
 *   週間 … 毎週月曜から（週が変わると自動で0から）
 *   勝率 … 通算の勝率で並べる（総合と同じ累積データ）
 *
 * 保存・通信の形（行）:
 *   { id, nickname, countryCode, total: tally, month: { key, ...tally }, week: { key, ...tally }, updatedAt }
 * tally = { points, wins, losses, goals, conceded, played }
 */

import { formatNumber, languageTag } from '../i18n.js';

/** 集計の軸。UI のタブと同じ順番。 */
export const TABS = Object.freeze(['total', 'month', 'week', 'rate']);

/** IPKSF 公式の勝ち点 */
export const PTS = Object.freeze({
  regularWin: 3,
  suddenWin: 2,
  suddenLoss: 1,
  regularLoss: 0,
});

/** 1試合ぶんの勝ち点。win = 勝ったか、sudden = サドンデスにもつれたか */
export function pointsFor({ win = false, sudden = false } = {}) {
  if (win) return sudden ? PTS.suddenWin : PTS.regularWin;
  return sudden ? PTS.suddenLoss : PTS.regularLoss;
}

const DAY = 24 * 60 * 60 * 1000;
const pad2 = (value) => String(value).padStart(2, '0');

/** 週の始まり（月曜）の 0 時 */
export function startOfWeek(date = new Date()) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const shift = (day.getDay() + 6) % 7; /* 日=0 → 6（前の月曜まで戻す） */
  day.setDate(day.getDate() - shift);
  return day;
}

/** 月のキー 'YYYY-MM'（毎月1日で切り替わる） */
export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/** 週のキー 'YYYY-MM-DD'（その週の月曜。毎週月曜で切り替わる） */
export function weekKey(date = new Date()) {
  const monday = startOfWeek(date);
  return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
}

/** 期間の残り日数（切り替わるまで）。月間は翌月1日、週間は次の月曜まで。 */
export function daysLeftInMonth(date = new Date()) {
  const next = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
  return Math.max(0, Math.ceil((next - date.getTime()) / DAY));
}

export function daysLeftInWeek(date = new Date()) {
  const monday = startOfWeek(date);
  const next = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7).getTime();
  return Math.max(0, Math.ceil((next - date.getTime()) / DAY));
}

/** タブ → 期間キー（総合・勝率は期間で切らない） */
export function periodOf(tab) {
  if (tab === 'month') return 'month';
  if (tab === 'week') return 'week';
  return 'total';
}

/**
 * 画面上部のシーズン表記。
 * label はそのまま出せる文字列（例 '2026年11月シーズン · 残り4日'）。
 */
export function seasonInfo(tab = 'total', { date = new Date(), language = 'ja', t = null } = {}) {
  const say = typeof t === 'function' ? t : (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
  if (tab === 'month') {
    const days = daysLeftInMonth(date);
    const label = say('rankSeasonMonth', { month: monthLabel(date, language), days });
    return { tab, period: 'month', key: monthKey(date), daysLeft: days, label };
  }
  if (tab === 'week') {
    const days = daysLeftInWeek(date);
    const label = say('rankSeasonWeek', { range: weekRangeLabel(date), days });
    return { tab, period: 'week', key: weekKey(date), daysLeft: days, label };
  }
  if (tab === 'rate') {
    return { tab, period: 'total', key: null, daysLeft: null, label: say('rankSeasonRate') };
  }
  return { tab: 'total', period: 'total', key: null, daysLeft: null, label: say('rankSeasonTotal') };
}

/** '2026年11月'（言語ごとのロケールで） */
export function monthLabel(date = new Date(), language = 'ja') {
  try {
    return new Intl.DateTimeFormat(languageTag(language), { year: 'numeric', month: 'long' }).format(date);
  } catch {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }
}

/** '11/23–11/29'（週の月曜〜日曜） */
export function weekRangeLabel(date = new Date()) {
  const monday = startOfWeek(date);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return `${monday.getMonth() + 1}/${monday.getDate()}–${sunday.getMonth() + 1}/${sunday.getDate()}`;
}

/* ------------------------------------------------------------------ *\
 * 集計（tally）
 * ------------------------------------------------------------------ */

export function emptyTally() {
  return { points: 0, wins: 0, losses: 0, goals: 0, conceded: 0, played: 0 };
}

const count = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

export function normalizeTally(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    points: count(source.points ?? source.p),
    wins: count(source.wins ?? source.w),
    losses: count(source.losses ?? source.l),
    goals: count(source.goals ?? source.g),
    conceded: count(source.conceded ?? source.c),
    played: count(source.played ?? (count(source.wins ?? source.w) + count(source.losses ?? source.l))),
  };
}

/** 1試合ぶんを足す（純粋関数） */
export function addToTally(tally, { win = false, sudden = false, goals = 0, conceded = 0 } = {}) {
  const start = normalizeTally(tally);
  return {
    points: start.points + pointsFor({ win, sudden }),
    wins: start.wins + (win ? 1 : 0),
    losses: start.losses + (win ? 0 : 1),
    goals: start.goals + count(goals),
    conceded: start.conceded + count(conceded),
    played: start.played + 1,
  };
}

export function diffOf(tally) {
  const value = normalizeTally(tally);
  return value.goals - value.conceded;
}

export function rateOf(tally) {
  const value = normalizeTally(tally);
  const total = value.wins + value.losses;
  return total ? Math.round((value.wins / total) * 100) : 0;
}

/* ------------------------------------------------------------------ *\
 * ランキング（保存する形）
 * ------------------------------------------------------------------ */

export function emptyStanding(date = new Date()) {
  return {
    total: emptyTally(),
    month: { key: monthKey(date), ...emptyTally() },
    week: { key: weekKey(date), ...emptyTally() },
  };
}

/**
 * 保存値の検証。壊れた値・古い形でも落ちない（期間キーが古ければその期間は0）。
 */
export function normalizeStanding(raw, date = new Date()) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const total = normalizeTally(source.total);
  const readPeriod = (value, key) => {
    const period = value && typeof value === 'object' ? value : {};
    const tally = normalizeTally(period);
    return { key: typeof period.key === 'string' ? period.key : key, ...tally };
  };
  return {
    total,
    month: readPeriod(source.month, monthKey(date)),
    week: readPeriod(source.week, weekKey(date)),
  };
}

/**
 * 期間が変わっていれば月間・週間を0に戻す。
 * 総合と勝率（＝total）は残る。
 */
export function rollStanding(standing, date = new Date()) {
  const next = normalizeStanding(standing, date);
  let changed = false;
  const month = monthKey(date);
  const week = weekKey(date);
  if (next.month.key !== month) {
    next.month = { key: month, ...emptyTally() };
    changed = true;
  }
  if (next.week.key !== week) {
    next.week = { key: week, ...emptyTally() };
    changed = true;
  }
  return { standing: next, changed };
}

/**
 * 1試合の結果をランキングへ足す（期間の切り替えも同時に行う）。
 * result = { win, sudden, goals, conceded }
 */
export function addStandingResult(standing, result = {}, date = new Date()) {
  const rolled = rollStanding(standing, date);
  const next = rolled.standing;
  const total = addToTally(next.total, result);
  const month = { key: next.month.key, ...addToTally(next.month, result) };
  const week = { key: next.week.key, ...addToTally(next.week, result) };
  return { standing: { total, month, week }, rolled: rolled.changed };
}

/** タブに対応する集計を取り出す（月間・週間は期間キーが合わなければ0） */
export function tallyFor(standing, tab = 'total', date = new Date()) {
  const data = normalizeStanding(standing, date);
  if (tab === 'month') return data.month.key === monthKey(date) ? data.month : emptyTally();
  if (tab === 'week') return data.week.key === weekKey(date) ? data.week : emptyTally();
  return data.total;
}

/* ------------------------------------------------------------------ *\
 * ランキングの行（自分・相手・通信で届いた行）
 * ------------------------------------------------------------------ */

/** 行を検証して、表示と並べ替えに使う形へそろえる */
export function normalizeRow(raw, { now = Date.now(), date = new Date() } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 24) : '';
  if (!id) return null;
  const total = raw.total ? normalizeTally(raw.total) : normalizeTally(raw);
  const readPeriod = (value, key) => {
    const period = value && typeof value === 'object' ? value : {};
    return { key: typeof period.key === 'string' ? period.key : key, ...normalizeTally(period) };
  };
  return {
    id,
    nickname: String(raw.nickname || raw.n || 'PLAYER').slice(0, 16),
    countryCode: String(raw.countryCode || raw.c || 'JP').toUpperCase().slice(0, 2),
    total,
    month: readPeriod(raw.month, monthKey(date)),
    week: readPeriod(raw.week, weekKey(date)),
    updatedAt: Number(raw.updatedAt || raw.u || now) || now,
  };
}

export function emptyRow({ id, nickname = 'PLAYER', countryCode = 'JP' }, date = new Date(), now = Date.now()) {
  return normalizeRow({ id, nickname, countryCode, total: emptyTally(), updatedAt: now }, { now, date });
}

/** 通信で送る形（小さい配列。512文字の上限に収める） */
export function toWire(row) {
  const normal = normalizeRow(row, { now: row && row.updatedAt ? row.updatedAt : Date.now() });
  if (!normal) return null;
  const tally = (value) => {
    const t = normalizeTally(value);
    return [t.points, t.wins, t.losses, t.goals, t.conceded];
  };
  return {
    id: normal.id,
    n: normal.nickname,
    c: normal.countryCode,
    t: tally(normal.total),
    m: [normal.month.key, ...tally(normal.month)],
    w: [normal.week.key, ...tally(normal.week)],
    u: normal.updatedAt,
  };
}

/** 通信で届いた形を読む（配列の形・旧来の {points,wins,losses} の両方を受ける） */
export function fromWire(payload, options = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const readTally = (value) => {
    if (Array.isArray(value)) {
      /* 期間の配列は [key, p, w, l, g, c]、総合は [p, w, l, g, c] */
      const start = value.length >= 6 ? 1 : 0;
      const [p, w, l, g, c] = value.slice(start);
      return normalizeTally({ points: p, wins: w, losses: l, goals: g, conceded: c });
    }
    return normalizeTally(value);
  };
  const period = (value, fallbackKey) => {
    if (Array.isArray(value)) {
      const [key, ...rest] = value;
      const tally = readTally(rest);
      return { key: typeof key === 'string' ? key : fallbackKey, ...tally };
    }
    if (value && typeof value === 'object') {
      return { key: typeof value.key === 'string' ? value.key : fallbackKey, ...normalizeTally(value) };
    }
    return { key: fallbackKey, ...emptyTally() };
  };
  return normalizeRow({
    id: payload.id,
    nickname: payload.n ?? payload.nickname,
    countryCode: payload.c ?? payload.countryCode,
    total: readTally(payload.t ?? payload.total ?? payload),
    month: period(payload.m ?? payload.month, monthKey(new Date())),
    week: period(payload.w ?? payload.week, weekKey(new Date())),
    updatedAt: payload.u ?? payload.updatedAt,
  }, options);
}

/** そのタブでの集計（行の期間キーが合わないときは0） */
export function rowTally(row, tab = 'total', date = new Date()) {
  const normal = normalizeRow(row, { date });
  if (!normal) return emptyTally();
  if (tab === 'month') return normal.month.key === monthKey(date) ? normal.month : emptyTally();
  if (tab === 'week') return normal.week.key === weekKey(date) ? normal.week : emptyTally();
  return normal.total;
}

/** 勝ち点 → 得失点差 → 総ゴール数 → 勝率（IPKSF 公式の順） */
export function compareTally(a, b) {
  const left = normalizeTally(a);
  const right = normalizeTally(b);
  if (right.points !== left.points) return right.points - left.points;
  if (diffOf(right) !== diffOf(left)) return diffOf(right) - diffOf(left);
  if (right.goals !== left.goals) return right.goals - left.goals;
  return rateOf(right) - rateOf(left);
}

export function compareRows(a, b, { tab = 'total', date = new Date() } = {}) {
  const left = rowTally(a, tab, date);
  const right = rowTally(b, tab, date);
  if (tab === 'rate') {
    const diff = rateOf(right) - rateOf(left);
    if (diff !== 0) return diff;
  }
  return compareTally(left, right);
}

/**
 * 画面に出す表。place（1〜）と isMe を付ける。
 * 月間・週間はその期間に1本も蹴っていない行を出さない（自分は常に出す）。
 */
export function rankTable(rows = [], me = null, { tab = 'total', date = new Date() } = {}) {
  const list = [...rows];
  if (me && !list.some((row) => row && row.id === me.id)) list.push(me);
  const decorated = list
    .map((row) => {
      const normal = normalizeRow(row, { date });
      if (!normal) return null;
      const tally = rowTally(normal, tab, date);
      return {
        ...normal,
        tally,
        diff: diffOf(tally),
        rate: rateOf(tally),
        periodPlayed: tally.played,
        isMe: Boolean(me && normal.id === me.id),
      };
    })
    .filter(Boolean);
  const periodTab = tab === 'month' || tab === 'week';
  const visible = decorated.filter((row) => {
    if (row.isMe) return true;
    const played = periodTab ? row.periodPlayed : row.total.played;
    /* 旧形式（勝敗の内訳がない）行でも、勝ち点があれば出す */
    return played > 0 || row.tally.points > 0;
  });
  return visible
    .sort((a, b) => compareRows(a, b, { tab, date }) || String(a.nickname).localeCompare(String(b.nickname)))
    .map((row, index) => ({ ...row, place: index + 1 }));
}

/** 順位のメダル（1〜3位） */
export function medalFor(place) {
  return ['🥇', '🥈', '🥉'][place - 1] || `#${place}`;
}

/** 数字の表示（言語ごとの区切り） */
export function numberText(value, language) {
  return formatNumber(Number(value) || 0, language);
}
