/**
 * SHOOTOUT 4 — 指の位置とキーパーの左右（Build 7）
 *
 * キーパー視点のカメラは、ゴールの真後ろ（x = 0, z = -20.5）からキッカー方向（+Z）を見ている。
 * この向きでは、画面の右がワールドの -X、画面の左がワールドの +X になる
 * （キッカー視点は +Z から -Z を見るので、画面の右が +X。二人は向かい合っている）。
 * Build 9 でカメラを斜め後ろ（x = 5.2）から真後ろ（x = 0）へ移したが、見ている向きは
 * 変わらない（+Z 方向）ので、符号の反転はそのまま必要で、そのまま正しい。
 *
 * そのため、指を右へ動かしたときにキーパーも「画面の右」へ動くようにするには、
 * 指の位置（-1〜+1）をそのままワールドの X に渡してはいけない。符号を反転する。
 *
 * 反転しても、通信で送る値は「ワールド座標のオフセット」のままなので、
 * キッカー側の画面では同じゴールポスト側に相手キーパーが見える（物理的に正しい）。
 */

/** 指の位置（画面の左端 0 〜 右端 1）を -1〜+1 に直す */
export function ratioFromClientX(clientX, rect, fallbackWidth = 1) {
  const left = Number(rect && rect.left) || 0;
  const width = Math.max(1, Number(rect && rect.width) || fallbackWidth);
  const ratio = ((Number(clientX) - left) / width) * 2 - 1;
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(-1, Math.min(1, ratio));
}

/**
 * 指の位置（-1〜+1, 画面の右が +1）→ キーパーの左右オフセット（ワールド +X が +1）。
 * キーパー視点はゴール裏から見ているので符号を反転する。
 */
export function keeperOffsetFromRatio(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return 0;
  const flipped = -Math.max(-1, Math.min(1, value));
  return flipped === 0 ? 0 : flipped;
}

/** キッカー視点の相手キーパーは、ワールド座標のオフセットをそのまま使う */
export function remoteKeeperOffset(offset) {
  const value = Number(offset);
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}
