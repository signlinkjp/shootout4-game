/**
 * SHOOTOUT 4 — 4部位の着せ替え（ユニフォーム・パンツ・靴下・スパイク）
 *
 * ここには「強さ」の値を持たせない。どの部位を選んでも選手の能力・ゴール確率・
 * 勝率は1%も変わらない（純粋な実力勝負）。
 *
 * 無料枠は「ホーム用・アウェイ用」の2セット。4部位それぞれに無料の2種類がある。
 * IPKSF 公式加盟（PRO・買い切り）で全種類が解放される（案A: ¥300 一本で全解放）。
 *
 * デザイン名は製品名として英語表記に統一（12言語で同じ名前で探せる）。
 *
 * design:
 *   solid     無地
 *   stripes   ストライプ（縦縞）
 *   hoops     横縞
 *   sash      タスキ
 *   bicolor   バイカラー（左右分割）
 *   gradient  グラデーション
 *   gold      ゴールドアクセント（胸に金の帯）
 *   checker   チェッカー（クロアチア風の市松）
 */

export const SHIRT_DESIGNS = Object.freeze(['solid', 'stripes', 'hoops', 'sash', 'bicolor', 'gradient', 'gold', 'checker']);

/** キャラクターの種類。無料はブロックのみ、PRO は両方から選べる（見た目だけ）。 */
export const CHARACTERS = Object.freeze([
  { id: 'voxel', pro: false, name: 'BLOCK SPORTS', set: 'home' },
  { id: 'stylized', pro: true, name: 'STYLIZED ATHLETE', set: 'pro' },
]);
export const CHARACTER_STYLES = Object.freeze(CHARACTERS.map((item) => item.id));
export const BOOT_SHAPES = Object.freeze(['classic', 'speed', 'high']);

/** 実際のプロサッカーの配色に寄せたパレット（蛍光色は使わない） */
export const PALETTE = Object.freeze([
  '#0f2050', '#1b3fa0', '#2f6fe4', '#7fb8e6',
  '#f2f5fa', '#c9ced8', '#111820',
  '#c8102e', '#e84a3a', '#7a1428',
  '#f2c24b', '#e08b1e', '#8a5a12',
  '#0f7a4a', '#37b07a', '#0b3b30',
  '#7a3fa0', '#e5e9f2',
]);

/** ユニフォーム（上半身）。無料=ホーム/アウェイの2種。 */
export const SHIRTS = Object.freeze([
  {
    id: 'chalk-home', design: 'solid', pro: false,
    name: 'CHALK HOME', set: 'home',
    primary: '#f2f5fa', secondary: '#0f2050', accent: '#c8102e', number: '#0f2050',
  },
  {
    id: 'navy-away', design: 'solid', pro: false,
    name: 'NAVY AWAY', set: 'away',
    primary: '#0f2050', secondary: '#2f6fe4', accent: '#f2c24b', number: '#ffffff',
  },
  {
    id: 'royal-stripe', design: 'stripes', pro: true,
    name: 'ROYAL STRIPE', set: 'pro',
    primary: '#1b3fa0', secondary: '#f2f5fa', accent: '#f2c24b', number: '#ffffff',
  },
  {
    id: 'sash-gold', design: 'sash', pro: true,
    name: 'SASH GOLD', set: 'pro',
    primary: '#7a1428', secondary: '#f2c24b', accent: '#f2f5fa', number: '#f2c24b',
  },
  {
    id: 'bicolor-sky', design: 'bicolor', pro: true,
    name: 'BICOLOR SKY', set: 'pro',
    primary: '#7fb8e6', secondary: '#0f2050', accent: '#f2f5fa', number: '#0f2050',
  },
  {
    id: 'emerald-fade', design: 'gradient', pro: true,
    name: 'EMERALD FADE', set: 'pro',
    primary: '#0f7a4a', secondary: '#37b07a', accent: '#f2f5fa', number: '#ffffff',
  },
  {
    id: 'gold-accent', design: 'gold', pro: true,
    name: 'GOLD ACCENT', set: 'pro',
    primary: '#111820', secondary: '#f2c24b', accent: '#e08b1e', number: '#f2c24b',
  },
  {
    id: 'checker-red', design: 'checker', pro: true,
    name: 'CHECKER RED', set: 'pro',
    primary: '#c8102e', secondary: '#f2f5fa', accent: '#0f2050', number: '#ffffff',
  },
  {
    id: 'royal-hoops', design: 'hoops', pro: true,
    name: 'ROYAL HOOPS', set: 'pro',
    primary: '#f2f5fa', secondary: '#1b3fa0', accent: '#c8102e', number: '#1b3fa0',
  },
  {
    id: 'sunset-away', design: 'gradient', pro: true,
    name: 'SUNSET GRADIENT', set: 'pro',
    primary: '#e84a3a', secondary: '#f2c24b', accent: '#111820', number: '#111820',
  },
  {
    id: 'crimson-sash', design: 'sash', pro: true,
    name: 'CRIMSON SASH', set: 'pro',
    primary: '#c8102e', secondary: '#f2f5fa', accent: '#f2c24b', number: '#ffffff',
  },
  {
    id: 'azure-hoops', design: 'hoops', pro: true,
    name: 'AZURE HOOPS', set: 'pro',
    primary: '#2f6fe4', secondary: '#f2f5fa', accent: '#0f2050', number: '#0f2050',
  },
  {
    id: 'violet-fade', design: 'gradient', pro: true,
    name: 'VIOLET FADE', set: 'pro',
    primary: '#7a3fa0', secondary: '#e5e9f2', accent: '#f2c24b', number: '#ffffff',
  },
  {
    id: 'sand-checker', design: 'checker', pro: true,
    name: 'SAND CHECKER', set: 'pro',
    primary: '#c9ced8', secondary: '#111820', accent: '#f2c24b', number: '#111820',
  },
  {
    id: 'teal-stripe', design: 'stripes', pro: true,
    name: 'TEAL STRIPE', set: 'pro',
    primary: '#0b3b30', secondary: '#37b07a', accent: '#f2f5fa', number: '#ffffff',
  },
  {
    id: 'amber-band', design: 'gold', pro: true,
    name: 'AMBER BAND', set: 'pro',
    primary: '#e08b1e', secondary: '#111820', accent: '#f2c24b', number: '#111820',
  },
]);

/** パンツ（ショーツ）。 */
export const SHORTS = Object.freeze([
  { id: 'navy-shorts', pro: false, name: 'NAVY SHORTS', set: 'home', color: '#0f2050', trim: '#f2f5fa' },
  { id: 'white-shorts', pro: false, name: 'WHITE SHORTS', set: 'away', color: '#f2f5fa', trim: '#0f2050' },
  { id: 'red-shorts', pro: true, name: 'CRIMSON SHORTS', set: 'pro', color: '#c8102e', trim: '#f2c24b' },
  { id: 'black-shorts', pro: true, name: 'BLACK SHORTS', set: 'pro', color: '#111820', trim: '#f2c24b' },
  { id: 'sky-shorts', pro: true, name: 'SKY SHORTS', set: 'pro', color: '#7fb8e6', trim: '#0f2050' },
  { id: 'emerald-shorts', pro: true, name: 'EMERALD SHORTS', set: 'pro', color: '#0b3b30', trim: '#37b07a' },
  { id: 'gold-shorts', pro: true, name: 'GOLD SHORTS', set: 'pro', color: '#f2c24b', trim: '#7a1428' },
  { id: 'violet-shorts', pro: true, name: 'VIOLET SHORTS', set: 'pro', color: '#7a3fa0', trim: '#e5e9f2' },
  { id: 'teal-shorts', pro: true, name: 'TEAL SHORTS', set: 'pro', color: '#0b3b30', trim: '#37b07a' },
  { id: 'sand-shorts', pro: true, name: 'SAND SHORTS', set: 'pro', color: '#c9ced8', trim: '#111820' },
]);

/** 靴下。 */
export const SOCKS = Object.freeze([
  { id: 'white-socks', pro: false, name: 'WHITE SOCKS', set: 'home', color: '#f2f5fa', band: '#0f2050' },
  { id: 'navy-socks', pro: false, name: 'NAVY SOCKS', set: 'away', color: '#0f2050', band: '#f2f5fa' },
  { id: 'red-socks', pro: true, name: 'CRIMSON SOCKS', set: 'pro', color: '#c8102e', band: '#ffffff' },
  { id: 'gold-socks', pro: true, name: 'GOLD SOCKS', set: 'pro', color: '#f2c24b', band: '#7a1428' },
  { id: 'sky-socks', pro: true, name: 'SKY SOCKS', set: 'pro', color: '#7fb8e6', band: '#0f2050' },
  { id: 'black-socks', pro: true, name: 'BLACK SOCKS', set: 'pro', color: '#111820', band: '#f2c24b' },
  { id: 'emerald-socks', pro: true, name: 'EMERALD SOCKS', set: 'pro', color: '#37b07a', band: '#0b3b30' },
  { id: 'violet-socks', pro: true, name: 'VIOLET SOCKS', set: 'pro', color: '#7a3fa0', band: '#e5e9f2' },
  { id: 'orange-socks', pro: true, name: 'ORANGE SOCKS', set: 'pro', color: '#e08b1e', band: '#111820' },
  { id: 'sand-socks', pro: true, name: 'SAND SOCKS', set: 'pro', color: '#c9ced8', band: '#0f2050' },
]);

/** スパイク。 */
export const BOOTS = Object.freeze([
  { id: 'classic-black', shape: 'classic', pro: false, name: 'CLASSIC BLACK', set: 'home', color: '#14181f', sole: '#c9ced8' },
  { id: 'classic-white', shape: 'classic', pro: false, name: 'CLASSIC WHITE', set: 'away', color: '#f2f5fa', sole: '#c8102e' },
  { id: 'speed-cyan', shape: 'speed', pro: true, name: 'VELOCITY CYAN', set: 'pro', color: '#2fd6f0', sole: '#0f2050' },
  { id: 'speed-gold', shape: 'speed', pro: true, name: 'VELOCITY GOLD', set: 'pro', color: '#f2c24b', sole: '#7a5a12' },
  { id: 'high-white', shape: 'high', pro: true, name: 'HIGH TOP WHITE', set: 'pro', color: '#f2f5fa', sole: '#c8102e' },
  { id: 'classic-crimson', shape: 'classic', pro: true, name: 'CLASSIC CRIMSON', set: 'pro', color: '#c8102e', sole: '#111820' },
  { id: 'high-navy', shape: 'high', pro: true, name: 'HIGH TOP NAVY', set: 'pro', color: '#1b3fa0', sole: '#f2c24b' },
  { id: 'speed-emerald', shape: 'speed', pro: true, name: 'VELOCITY EMERALD', set: 'pro', color: '#37b07a', sole: '#0b3b30' },
  { id: 'speed-violet', shape: 'speed', pro: true, name: 'VELOCITY VIOLET', set: 'pro', color: '#7a3fa0', sole: '#e5e9f2' },
  { id: 'classic-gold', shape: 'classic', pro: true, name: 'CLASSIC GOLD', set: 'pro', color: '#f2c24b', sole: '#111820' },
  { id: 'high-emerald', shape: 'high', pro: true, name: 'HIGH TOP EMERALD', set: 'pro', color: '#0f7a4a', sole: '#37b07a' },
  { id: 'speed-white', shape: 'speed', pro: true, name: 'VELOCITY WHITE', set: 'pro', color: '#f2f5fa', sole: '#2f6fe4' },
]);

export const PARTS = Object.freeze(['shirt', 'shorts', 'socks', 'boots']);

export const DEFAULT_SKIN = Object.freeze({
  character: 'voxel',
  shirt: 'chalk-home',
  shorts: 'navy-shorts',
  socks: 'white-socks',
  boots: 'classic-black',
});

export const PRO_SKIN = Object.freeze({
  character: 'stylized',
  shirt: 'royal-stripe',
  shorts: 'red-shorts',
  socks: 'sky-socks',
  boots: 'speed-gold',
});

/** 旧バージョン（kit/boot の2部位）の保存値を新しい4部位へ移す */
const LEGACY_KITS = Object.freeze({
  chalk: { shirt: 'chalk-home', shorts: 'navy-shorts', socks: 'white-socks' },
  midnight: { shirt: 'navy-away', shorts: 'navy-shorts', socks: 'navy-socks' },
  'royal-stripe': { shirt: 'royal-stripe', shorts: 'black-shorts', socks: 'sky-socks' },
  'sash-gold': { shirt: 'sash-gold', shorts: 'red-shorts', socks: 'gold-socks' },
  'bicolor-sky': { shirt: 'bicolor-sky', shorts: 'sky-shorts', socks: 'sky-socks' },
  'gradient-emerald': { shirt: 'emerald-fade', shorts: 'emerald-shorts', socks: 'sky-socks' },
  'gold-accent': { shirt: 'gold-accent', shorts: 'black-shorts', socks: 'gold-socks' },
  'checker-red': { shirt: 'checker-red', shorts: 'red-shorts', socks: 'red-socks' },
  'hoops-royal': { shirt: 'royal-hoops', shorts: 'navy-shorts', socks: 'white-socks' },
  'sunset-away': { shirt: 'sunset-away', shorts: 'black-shorts', socks: 'red-socks' },
});

export function getShirt(id) {
  return SHIRTS.find((item) => item.id === id) || SHIRTS[0];
}

export function getShorts(id) {
  return SHORTS.find((item) => item.id === id) || SHORTS[0];
}

export function getSocks(id) {
  return SOCKS.find((item) => item.id === id) || SOCKS[0];
}

export function getBoot(id) {
  return BOOTS.find((item) => item.id === id) || BOOTS[0];
}

export function partList(part) {
  if (part === 'shirt') return SHIRTS;
  if (part === 'shorts') return SHORTS;
  if (part === 'socks') return SOCKS;
  if (part === 'boots') return BOOTS;
  return [];
}

export function getPart(part, id) {
  if (part === 'shirt') return getShirt(id);
  if (part === 'shorts') return getShorts(id);
  if (part === 'socks') return getSocks(id);
  if (part === 'boots') return getBoot(id);
  return null;
}

export function isPartUnlocked(part, id, entitled) {
  const item = getPart(part, id);
  return Boolean(item) && (!item.pro || entitled === true);
}

export function isKitUnlocked(id, entitled) {
  return isPartUnlocked('shirt', id, entitled);
}

export function isBootUnlocked(id, entitled) {
  return isPartUnlocked('boots', id, entitled);
}

export function getCharacter(id) {
  return CHARACTERS.find((item) => item.id === id) || CHARACTERS[0];
}

export function isCharacterUnlocked(id, entitled) {
  const character = getCharacter(id);
  return !character.pro || entitled === true;
}

/** 4部位ぶんの完全な見た目。壊れた値・旧形式は既定へ戻す。 */
export function normalizeSkin(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const legacy = LEGACY_KITS[source.kit];
  const shirt = SHIRTS.some((item) => item.id === source.shirt)
    ? source.shirt
    : (legacy ? legacy.shirt : DEFAULT_SKIN.shirt);
  const shorts = SHORTS.some((item) => item.id === source.shorts)
    ? source.shorts
    : (legacy ? legacy.shorts : DEFAULT_SKIN.shorts);
  const socks = SOCKS.some((item) => item.id === source.socks)
    ? source.socks
    : (legacy ? legacy.socks : DEFAULT_SKIN.socks);
  const boots = BOOTS.some((item) => item.id === source.boots)
    ? source.boots
    : (BOOTS.some((item) => item.id === source.boot) ? source.boot : DEFAULT_SKIN.boots);
  const character = CHARACTER_STYLES.includes(source.character) ? source.character : DEFAULT_SKIN.character;
  return { character, shirt, shorts, socks, boots };
}

const KEY = 'shootout4.skin.v2';
const LEGACY_KEY = 'shootout4.skin.v1';

export function readSkin(backend) {
  if (!backend) return { ...DEFAULT_SKIN };
  try {
    const raw = backend.getItem(KEY) || backend.getItem(LEGACY_KEY);
    return normalizeSkin(JSON.parse(raw || '{}'));
  } catch {
    return { ...DEFAULT_SKIN };
  }
}

export function saveSkin(backend, entitled, skin) {
  const clean = normalizeSkin(skin);
  /* 未加入のPRO部位は保存させない（UIを通り抜けても見た目が変わらない） */
  const locked = PARTS.filter((part) => !isPartUnlocked(part, clean[part], entitled));
  if (locked.length || !isCharacterUnlocked(clean.character, entitled)) throw new Error('PRO required');
  if (backend) {
    try {
      backend.setItem(KEY, JSON.stringify(clean));
    } catch {
      /* プライベートブラウズでも、その場の見た目は変わる */
    }
  }
  return clean;
}

/**
 * 実際に表示する見た目。PRO のキャラクターを選んだまま未加入に戻った場合は
 * ブロック型で表示する（UI と3Dが食い違わない）。
 */
export function effectiveSkin(skin, entitled) {
  const clean = normalizeSkin(skin);
  if (clean.character === 'stylized' && entitled !== true) clean.character = 'voxel';
  return clean;
}

/** 3Dのテクスチャ生成に渡す仕様（純粋データ） */
export function shirtSpec(id) {
  const shirt = getShirt(id);
  return {
    design: shirt.design,
    primary: shirt.primary,
    secondary: shirt.secondary,
    accent: shirt.accent,
    number: shirt.number,
  };
}

export function shortsSpec(id) {
  const shorts = getShorts(id);
  return { color: shorts.color, trim: shorts.trim };
}

export function socksSpec(id) {
  const socks = getSocks(id);
  return { color: socks.color, band: socks.band };
}

export function bootSpec(id) {
  const boot = getBoot(id);
  return { shape: boot.shape, color: boot.color, sole: boot.sole };
}

/** 相手（CPU）のキット: 国の色から生成する。PROの見た目は使わない */
export function opponentKit(countryKitColors) {
  const colors = countryKitColors || { primary: '#1b2f6b', secondary: '#ffffff', accent: '#c8102e' };
  return {
    design: 'solid',
    primary: colors.primary,
    secondary: colors.secondary,
    accent: colors.accent,
    number: colors.primary,
    shorts: colors.primary,
    socks: colors.secondary,
    trim: colors.secondary,
    band: colors.secondary,
  };
}
