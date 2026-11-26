/**
 * SHOOTOUT 4 — こだわりユニフォーム＆スパイク（見た目だけ・能力差ゼロ）
 *
 * ここには「強さ」の値を持たせない。どのキット・どのスパイクを選んでも
 * 選手の能力・ゴール確率・勝率は1%も変わらない（純粋な実力勝負）。
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

export const KIT_DESIGNS = Object.freeze(['solid', 'stripes', 'hoops', 'sash', 'bicolor', 'gradient', 'gold', 'checker']);
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

export const KITS = Object.freeze([
  {
    id: 'chalk', design: 'solid', pro: false,
    name: 'CHALK WHITE',
    primary: '#f2f5fa', secondary: '#0f2050', accent: '#c8102e',
    shorts: '#0f2050', socks: '#f2f5fa', number: '#0f2050',
  },
  {
    id: 'midnight', design: 'solid', pro: false,
    name: 'MIDNIGHT NAVY',
    primary: '#0f2050', secondary: '#2f6fe4', accent: '#f2c24b',
    shorts: '#0f2050', socks: '#0f2050', number: '#ffffff',
  },
  {
    id: 'royal-stripe', design: 'stripes', pro: true,
    name: 'ROYAL STRIPE',
    primary: '#1b3fa0', secondary: '#f2f5fa', accent: '#f2c24b',
    shorts: '#f2f5fa', socks: '#1b3fa0', number: '#ffffff',
  },
  {
    id: 'sash-gold', design: 'sash', pro: true,
    name: 'SASH GOLD',
    primary: '#7a1428', secondary: '#f2c24b', accent: '#f2f5fa',
    shorts: '#7a1428', socks: '#f2c24b', number: '#f2c24b',
  },
  {
    id: 'bicolor-sky', design: 'bicolor', pro: true,
    name: 'BICOLOR SKY',
    primary: '#7fb8e6', secondary: '#0f2050', accent: '#f2f5fa',
    shorts: '#0f2050', socks: '#7fb8e6', number: '#0f2050',
  },
  {
    id: 'gradient-emerald', design: 'gradient', pro: true,
    name: 'EMERALD FADE',
    primary: '#0f7a4a', secondary: '#37b07a', accent: '#f2f5fa',
    shorts: '#0b3b30', socks: '#37b07a', number: '#ffffff',
  },
  {
    id: 'gold-accent', design: 'gold', pro: true,
    name: 'GOLD ACCENT',
    primary: '#111820', secondary: '#f2c24b', accent: '#e08b1e',
    shorts: '#111820', socks: '#f2c24b', number: '#f2c24b',
  },
  {
    id: 'checker-red', design: 'checker', pro: true,
    name: 'CHECKER RED',
    primary: '#c8102e', secondary: '#f2f5fa', accent: '#0f2050',
    shorts: '#f2f5fa', socks: '#c8102e', number: '#ffffff',
  },
  {
    id: 'hoops-royal', design: 'hoops', pro: true,
    name: 'ROYAL HOOPS',
    primary: '#f2f5fa', secondary: '#1b3fa0', accent: '#c8102e',
    shorts: '#1b3fa0', socks: '#f2f5fa', number: '#1b3fa0',
  },
  {
    id: 'sunset-away', design: 'gradient', pro: true,
    name: 'SUNSET AWAY',
    primary: '#e84a3a', secondary: '#f2c24b', accent: '#111820',
    shorts: '#111820', socks: '#e84a3a', number: '#111820',
  },
]);

export const BOOTS = Object.freeze([
  { id: 'speed-cyan', shape: 'speed', pro: true, name: 'VELOCITY CYAN', color: '#2fd6f0', sole: '#0f2050' },
  { id: 'classic-black', shape: 'classic', pro: false, name: 'CLASSIC BLACK', color: '#14181f', sole: '#c9ced8' },
  { id: 'speed-gold', shape: 'speed', pro: true, name: 'VELOCITY GOLD', color: '#f2c24b', sole: '#7a5a12' },
  { id: 'high-white', shape: 'high', pro: true, name: 'HIGH TOP WHITE', color: '#f2f5fa', sole: '#c8102e' },
  { id: 'classic-red', shape: 'classic', pro: true, name: 'CLASSIC CRIMSON', color: '#c8102e', sole: '#111820' },
  { id: 'high-navy', shape: 'high', pro: true, name: 'HIGH TOP NAVY', color: '#1b3fa0', sole: '#f2c24b' },
]);

export const DEFAULT_SKIN = Object.freeze({ kit: 'chalk', boot: 'classic-black' });
export const PRO_SKIN = Object.freeze({ kit: 'royal-stripe', boot: 'speed-gold' });

export function getKit(id) {
  return KITS.find((kit) => kit.id === id) || KITS[0];
}

export function getBoot(id) {
  return BOOTS.find((boot) => boot.id === id) || BOOTS[1];
}

export function isKitUnlocked(id, entitled) {
  const kit = getKit(id);
  return !kit.pro || entitled === true;
}

export function isBootUnlocked(id, entitled) {
  const boot = getBoot(id);
  return !boot.pro || entitled === true;
}

export function normalizeSkin(input = {}) {
  const kit = KITS.some((item) => item.id === input.kit) ? input.kit : DEFAULT_SKIN.kit;
  const boot = BOOTS.some((item) => item.id === input.boot) ? input.boot : DEFAULT_SKIN.boot;
  return { kit, boot };
}

const KEY = 'shootout4.skin.v1';

export function readSkin(backend) {
  if (!backend) return { ...DEFAULT_SKIN };
  try {
    return normalizeSkin(JSON.parse(backend.getItem(KEY) || '{}'));
  } catch {
    return { ...DEFAULT_SKIN };
  }
}

export function saveSkin(backend, entitled, skin) {
  const clean = normalizeSkin(skin);
  /* 未購入のPROキットは保存させない（UIを通り抜けても見た目が変わらない） */
  if (!isKitUnlocked(clean.kit, entitled) || !isBootUnlocked(clean.boot, entitled)) {
    throw new Error('PRO required');
  }
  if (backend) {
    try {
      backend.setItem(KEY, JSON.stringify(clean));
    } catch {
      /* プライベートブラウズでも、その場の見た目は変わる */
    }
  }
  return clean;
}

/** 3Dのテクスチャ生成に渡す仕様（純粋データ） */
export function kitSpec(id) {
  const kit = getKit(id);
  return {
    design: kit.design,
    primary: kit.primary,
    secondary: kit.secondary,
    accent: kit.accent,
    shorts: kit.shorts,
    socks: kit.socks,
    number: kit.number,
  };
}

export function bootSpec(id) {
  const boot = getBoot(id);
  return { shape: boot.shape, color: boot.color, sole: boot.sole };
}

/**
 * 相手（CPU）のキット: 国の色から生成する。PROキットは使わない
 * （対戦相手の見た目で「課金したか」が分かると公平に見えないため）。
 */
export function opponentKit(countryCode, countryKitColors) {
  return {
    design: 'solid',
    primary: countryKitColors.primary,
    secondary: countryKitColors.secondary,
    accent: countryKitColors.accent,
    shorts: countryKitColors.primary,
    socks: countryKitColors.secondary,
    number: countryKitColors.primary,
  };
}
