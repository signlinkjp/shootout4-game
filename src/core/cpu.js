/**
 * SHOOTOUT 4 — CPUの心理戦AI
 *
 * CPUの強さは「読みの鋭さ」だけで変える。選手の能力やゴール確率は変えない
 * （どのレベルでも、CPUが選んだ方向と人間が選んだ方向だけで結果が決まる）。
 *
 * CPUは人間が決める前に自分の方向を確定させる（後出ししない）。
 * 材料にできるのは「終わった本の履歴」だけ。
 */

import { DIRECTIONS, randomDirection } from './rules.js';

export const LEVELS = Object.freeze(['rookie', 'normal', 'elite', 'legend']);

/**
 * memory    … 相手の癖をどれだけ覚えているか（0=覚えない）
 * noise     … 完全ランダムに逃げる割合
 * repeat    … 直前に自分が選んだ方向を避ける強さ
 * adapt     … 試合中に読みを変える速さ（履歴の重み）
 */
export const LEVEL_PARAMS = Object.freeze({
  rookie: { memory: 0.15, noise: 0.55, repeat: 0.1, adapt: 0.2 },
  normal: { memory: 0.45, noise: 0.35, repeat: 0.25, adapt: 0.45 },
  elite: { memory: 0.75, noise: 0.2, repeat: 0.4, adapt: 0.7 },
  legend: { memory: 0.92, noise: 0.1, repeat: 0.55, adapt: 0.9 },
});

export function isLevel(value) {
  return LEVELS.includes(value);
}

export function normalizeLevel(value) {
  return isLevel(value) ? value : 'normal';
}

/** その側の「相手が選んだ方向」の履歴（古い順・最大12本） */
function observations(state, side, limit = 12) {
  const keeper = side === 'me' ? 'opp' : 'me';
  return state.history
    .filter((event) => event.side === keeper)
    .slice(-limit);
}

/**
 * CPUが選ぶ方向。
 *   state.turn === 'opp' → CPUが蹴る。読むのは人間がキーパーとして飛んだ方向。
 *   state.turn === 'me'  → CPUがキーパー。読むのは人間が蹴った方向。
 */
export function chooseCPU(state, { level = 'normal', random = Math.random } = {}) {
  const params = LEVEL_PARAMS[normalizeLevel(level)];
  const cpuShooting = state.turn === 'opp';
  const history = observations(state, 'opp');

  if (random() < params.noise || history.length === 0) return randomDirection(random);

  /* 重み付きカウント（新しい本ほど重い） */
  const weights = Object.fromEntries(DIRECTIONS.map((dir) => [dir, 1]));
  history.forEach((event, index) => {
    const dir = cpuShooting ? event.save : event.shot;
    if (!DIRECTIONS.includes(dir)) return;
    const recency = 1 + (index / history.length) * params.adapt * 2;
    weights[dir] += recency;
  });

  const scored = DIRECTIONS.map((dir) => {
    const count = weights[dir] - 1;
    /* 蹴る側は相手が飛ばない方向を狙い、キーパーは相手が蹴る方向へ飛ぶ */
    const base = cpuShooting ? 1 / (1 + count * params.memory * 2) : 1 + count * params.memory * 2;
    return base * (0.85 + random() * 0.3);
  });

  /* 直前に自分が選んだ方向を避ける（同じ手の繰り返しを減らす） */
  const lastOwn = state.history.filter((event) => event.side === 'opp').at(-1);
  if (lastOwn && !cpuShooting && random() < params.repeat) {
    const same = lastOwn.shot;
    const index = DIRECTIONS.indexOf(same);
    if (index >= 0) scored[index] *= 0.35;
  }

  let pick = random() * scored.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < scored.length; i += 1) {
    pick -= scored[i];
    if (pick < 0) return DIRECTIONS[i];
  }
  return DIRECTIONS[DIRECTIONS.length - 1];
}

/** 表示用: レベルの星（1〜4） */
export function levelStars(level) {
  return ['rookie', 'normal', 'elite', 'legend'].indexOf(normalizeLevel(level)) + 1;
}
