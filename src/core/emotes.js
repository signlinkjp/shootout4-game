/**
 * SHOOTOUT 4 — スタンプ・定型文（Build 7）
 *
 * 送るのは「id」だけ。本文（文言）は送らないので、
 *  ・自由入力が無い（荒らし・個人情報の持ち出しができない）
 *  ・受け取った側は自分の言語で表示できる（12言語）
 *  ・電文が小さい（レート制限・サイズ検査と相性が良い）
 *
 * id はネットの許可リスト（net/online.js）とそのまま一致させる。
 */

/**
 * kind:
 *   stamp … 絵文字のスタンプ（短いラベル付き）
 *   taunt … 駆け引きの定型文（蹴る前の心理戦）
 *   react … リアクションの定型文（結果への反応）
 */
export const EMOTES = Object.freeze([
  /* スタンプ */
  { id: 'hello', kind: 'stamp', face: '👋', key: 'stamp_hello' },
  { id: 'nice', kind: 'stamp', face: '🔥', key: 'stamp_nice' },
  { id: 'ball', kind: 'stamp', face: '⚽', key: 'emote_ball' },
  { id: 'glove', kind: 'stamp', face: '🧤', key: 'emote_glove' },
  { id: 'cool', kind: 'stamp', face: '😎', key: 'emote_cool' },
  { id: 'oops', kind: 'stamp', face: '💦', key: 'stamp_oops' },
  { id: 'gg', kind: 'stamp', face: '🤝', key: 'stamp_gg' },
  { id: 'thanks', kind: 'stamp', face: '🙏', key: 'stamp_thanks' },

  /* 駆け引きの定型文 */
  { id: 'taunt_left', kind: 'taunt', face: '👈', key: 'emote_taunt_left' },
  { id: 'taunt_right', kind: 'taunt', face: '👉', key: 'emote_taunt_right' },
  { id: 'taunt_center', kind: 'taunt', face: '😏', key: 'emote_taunt_center' },
  { id: 'taunt_read', kind: 'taunt', face: '🧠', key: 'emote_taunt_read' },

  /* リアクションの定型文 */
  { id: 'nice_goal', kind: 'react', face: '👍', key: 'emote_nice_goal' },
  { id: 'conceded', kind: 'react', face: '😣', key: 'emote_conceded' },
  { id: 'nice_save', kind: 'react', face: '🧤', key: 'emote_nice_save' },
  { id: 'no_problem', kind: 'react', face: '🤗', key: 'emote_no_problem' },
]);

/** トレイに並べる順番と見出し */
export const EMOTE_SECTIONS = Object.freeze([
  { kind: 'stamp', label: 'emoteStamps' },
  { kind: 'taunt', label: 'emoteTaunts' },
  { kind: 'react', label: 'emoteReacts' },
]);

/** id → 絵文字・言語キー（旧 Build 6 の wow も受信だけは受け付ける） */
const ALL = Object.freeze([
  ...EMOTES,
  { id: 'wow', kind: 'stamp', face: '😮', key: 'stamp_wow' },
]);

export const EMOTE_IDS = Object.freeze(EMOTES.map((emote) => emote.id));

/** ネットで受け付けてよい id（旧 Build 6 の id も含める） */
export const EMOTE_WIRE_IDS = Object.freeze([...new Set(ALL.map((emote) => emote.id))]);

const BY_ID = new Map(ALL.map((emote) => [emote.id, emote]));

/** id から絵文字と言語キーを引く（知らない id は null） */
export function emoteById(id) {
  return BY_ID.get(String(id || '')) || null;
}

export function isEmoteId(id) {
  return BY_ID.has(String(id || ''));
}

/**
 * CPU 戦のときに、CPU から返ってくる軽いリアクション（Build 7）。
 * 返さないこともある（毎ラウンド返すと鬱陶しいので確率で間引く）。
 *
 * kind は「CPU から見た出来事」:
 *   conceded … 点を取られた / cpuSave … 止めた / cpuGoal … 決めた / iSaved … 止められた / iMiss … 相手が外した
 */
const CPU_REACTIONS = Object.freeze({
  conceded: ['conceded', 'oops', 'thanks'],
  cpuSave: ['glove', 'nice_save', 'taunt_read'],
  cpuGoal: ['cool', 'nice', 'taunt_center'],
  iSaved: ['oops', 'conceded'],
  iMiss: ['thanks', 'nice'],
});

export function cpuEmoteFor(kind, { random = Math.random, chance = 0.45 } = {}) {
  const pool = CPU_REACTIONS[kind];
  if (!pool || typeof random !== 'function') return null;
  if (random() > chance) return null;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index];
}

/** スタンプを受け取ってよいかの確認（型・許可リスト・間隔）は rules.js の validateStamp */
