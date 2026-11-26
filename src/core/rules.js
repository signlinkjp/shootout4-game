/**
 * SHOOTOUT 4 — PK戦のルール（純粋関数だけ・DOMも通信も知らない）
 *
 *  ・4方向（左上 TL / 右上 TR / 左下 BL / 右下 BR）だけを使う。
 *  ・蹴る側が「狙う方向」、止める側が「飛ぶ方向」を同時に選ぶ。
 *      同じ方向 → セーブ（ゴールならず）
 *      違う方向 → ゴール
 *  ・5本ずつ蹴る。5本を終えて同点なら、6本目からサドンデス
 *    （両チームが同じ本数を蹴り、差がついた時点で決着）。
 *  ・早く決着がついた場合（例 3-0）は、残りを蹴らずに終了する（実際のPK戦と同じ）。
 *  ・能力差・課金による確率の差は一切ない（このファイルに乱数すら無い）。
 *
 * キック1本は「1往復」ではなく「1本」= 片方のチームの1回のシュート。
 * 交互に蹴るので、state.turn が蹴る側（shooter）。
 */

export const DIRECTIONS = Object.freeze(['TL', 'TR', 'BL', 'BR']);
/** 時間切れ: ゴールを狙わず枠外へ蹴る（7秒以内に決めなかったとき） */
export const MISS = 'OUT';
export const PICKABLE = Object.freeze([...DIRECTIONS, MISS]);
export const SIDES = Object.freeze(['me', 'opp']);
export const KICKERS = 5;

/** ゴールのどこか（UI・3Dの座標に使う単位ベクトル） */
export const ZONES = Object.freeze({
  TL: { x: -0.62, y: 0.62, label: 'leftTop' },
  TR: { x: 0.62, y: 0.62, label: 'rightTop' },
  BL: { x: -0.62, y: 0.18, label: 'leftBottom' },
  BR: { x: 0.62, y: 0.18, label: 'rightBottom' },
});

export function isDirection(value) {
  return DIRECTIONS.includes(value);
}

/** 送ってよい手（4方向 + 時間切れの枠外） */
export function isPick(value) {
  return PICKABLE.includes(value);
}

export function otherSide(side) {
  return side === 'me' ? 'opp' : 'me';
}

/** 新しいPK戦。first = 先攻の側（'me' か 'opp'） */
export function newMatch({ first = 'me' } = {}) {
  if (!SIDES.includes(first)) throw new TypeError('invalid first side');
  return {
    first,
    turn: first,
    kicks: { me: [], opp: [] },
    score: { me: 0, opp: 0 },
    history: [],
    winner: null,
  };
}

/** いま蹴る側のキッカー番号（1〜5。サドンデスも1番から順に回る） */
export function kickerNumber(state, side = state.turn) {
  const played = state.kicks[side].length;
  return (played % KICKERS) + 1;
}

/** 通常PKかサドンデスか */
export function phase(state) {
  return state.kicks.me.length >= KICKERS && state.kicks.opp.length >= KICKERS ? 'sudden' : 'regular';
}

/** その時点の「先攻 / 後攻」表示用 */
export function orderOf(state, side) {
  return state.first === side ? 'first' : 'second';
}

/**
 * 残りの本数を含めて、もう勝敗が動かないか。
 *  - 通常PK中: 相手があと何本蹴れるかを足しても追いつけないとき
 *  - サドンデス: 両者が同じ本数を蹴ったうえで点差があるとき
 */
export function decidedWinner(state) {
  const played = { me: state.kicks.me.length, opp: state.kicks.opp.length };
  const left = {
    me: Math.max(0, KICKERS - played.me),
    opp: Math.max(0, KICKERS - played.opp),
  };
  const { me, opp } = state.score;

  const regular = played.me < KICKERS || played.opp < KICKERS;
  if (!regular) {
    /* サドンデス: 両者が同じ本数を蹴ったうえで点差があれば決着 */
    if (played.me === played.opp && me !== opp) return me > opp ? 'me' : 'opp';
    return null;
  }
  /* 通常PKの早期決着: 相手があと何本蹴れるかを足しても追いつけない */
  if (me > opp + left.opp) return 'me';
  if (opp > me + left.me) return 'opp';
  return null;
}

/**
 * 1本を解決する。shot = 蹴る側の狙い、save = 止める側の飛ぶ方向。
 * state は変更せず、新しい state を返す（履歴は追記のみ）。
 */
export function resolveKick(state, { shot, save, timeout = false, stuck = false } = {}) {
  if (state.winner) throw new Error('match finished');
  if (!isPick(shot)) throw new TypeError('invalid shot');
  if (!stuck && !isDirection(save)) throw new TypeError('invalid save');

  const side = state.turn;
  const keeper = otherSide(side);
  /* 枠外（時間切れ）は必ず外れる。キーパーが動けなかった場合（stuck）は必ず入る。 */
  const miss = shot === MISS;
  const goal = !miss && (stuck ? true : shot !== save);
  const event = {
    index: state.history.length,
    side,
    keeper,
    shot,
    save: miss ? null : save,
    goal,
    miss,
    stuck: Boolean(stuck) && !miss,
    timeout: Boolean(timeout),
    kicker: kickerNumber(state, side),
    round: state.kicks[side].length + 1,
    phase: phase(state),
    score: { me: state.score.me, opp: state.score.opp },
  };
  const kicks = { ...state.kicks, [side]: [...state.kicks[side], goal] };
  const score = { ...state.score, [side]: state.score[side] + Number(goal) };
  const next = {
    ...state,
    kicks,
    score,
    history: [...state.history, event],
    winner: null,
    turn: keeper,
  };
  event.score = { ...score };
  next.winner = decidedWinner(next);
  return next;
}

/** PKスコアボード（UIがそのまま描ける形） */
export function pkBoard(state) {
  const total = Math.max(KICKERS, state.kicks.me.length, state.kicks.opp.length);
  const cells = (side) => {
    const list = state.kicks[side];
    const out = [];
    for (let i = 0; i < total; i += 1) {
      out.push({
        index: i + 1,
        sudden: i >= KICKERS,
        kicked: i < list.length,
        goal: i < list.length ? list[i] : null,
        current: i === list.length && state.turn === side && !state.winner,
      });
    }
    return out;
  };
  return {
    me: cells('me'),
    opp: cells('opp'),
    score: { ...state.score },
    sudden: total > KICKERS,
    decided: Boolean(state.winner),
  };
}

/** 進み具合（%）。試合中のテンポ表示に使う */
export function progress(state) {
  const totalPlayed = state.kicks.me.length + state.kicks.opp.length;
  const expected = KICKERS * 2;
  if (state.winner) return 100;
  return Math.min(96, Math.round((totalPlayed / expected) * 100));
}

/** 交代の案内文（次はどちらが蹴るか） */
export function nextTurn(state) {
  if (state.winner) return null;
  return { side: state.turn, role: state.turn === 'me' ? 'shoot' : 'keep' };
}

/* ------------------------------------------------------------------ *\
 * 通信の検証（online.js とテストが使う）
 * ------------------------------------------------------------------ */

const MAX_PAYLOAD = 512;

export function payloadTooLarge(payload) {
  try {
    return JSON.stringify(payload).length > MAX_PAYLOAD;
  } catch {
    return true;
  }
}

/**
 * 相手から来た1本を検証して、採用してよい形に整える。
 *  - 自分の送信でないこと
 *  - そのラウンドをまだ受け取っていないこと
 *  - 方向が4択のどれかであること
 */
export function validateOnlineKick(payload, { self, seen = new Set(), maxRounds = 40 } = {}) {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'shape' };
  if (payloadTooLarge(payload)) return { ok: false, reason: 'size' };
  const from = typeof payload.from === 'string' ? payload.from.slice(0, 40) : '';
  if (!from || from === self) return { ok: false, reason: 'self' };
  const round = Number(payload.round);
  if (!Number.isInteger(round) || round < 0 || round >= maxRounds) return { ok: false, reason: 'round' };
  if (!isPick(payload.dir)) return { ok: false, reason: 'dir' };
  if (seen.has(`${from}:${round}`)) return { ok: false, reason: 'dup' };
  return { ok: true, from, round, dir: payload.dir };
}

export function validateStamp(payload, { self, allowed, lastAt = 0, now = Date.now(), gapMs = 4000 } = {}) {
  if (!payload || typeof payload !== 'object') return { ok: false };
  if (payloadTooLarge(payload)) return { ok: false };
  const from = typeof payload.from === 'string' ? payload.from.slice(0, 40) : '';
  if (!from || from === self) return { ok: false };
  if (!Array.isArray(allowed) || !allowed.includes(payload.id)) return { ok: false };
  if (now - lastAt < gapMs) return { ok: false };
  return { ok: true, from, id: payload.id };
}

/** タイムアップ時の自動選択（暗号学的でなくてよい。公平な一様分布） */
export function randomDirection(random = Math.random) {
  return DIRECTIONS[Math.min(3, Math.max(0, Math.floor(random() * 4)))];
}

/** 表示用: 記録から勝率を出す（戦績画面） */
export function winRate({ wins = 0, losses = 0 } = {}) {
  const total = wins + losses;
  return total ? Math.round((wins / total) * 100) : 0;
}

/** サドンデスの最大本数（無限ループ防止。9本ずつまで=18本） */
export const MAX_TOTAL_KICKS = 40;
