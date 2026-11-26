/**
 * SHOOTOUT 4 — 世界大会に参加する16の国（IPKSF オリジナル設定）
 *
 * 実在の連盟・大会・選手名は使わない。国旗は flagcdn の汎用画像を同梱。
 * 国名は 日本語 / English を持ち、ほかの10言語は英語で表示する（英語フォールバック）。
 *
 * crowd は国別の「歓声の性格」。audio.js がこの値から歓声・太鼓・ホーンを作る
 * （音源ファイルを持たないので、オフラインでも必ず鳴る）。
 */

export const COUNTRIES = Object.freeze([
  {
    code: 'JP', flag: 'assets/flags/jp-96.png', name: { ja: '日本', en: 'Japan' },
    kit: { primary: '#1b2f6b', secondary: '#ffffff', accent: '#d81f3c' },
    crowd: { density: 0.9, bright: 3000, chant: [0, 2, 4, 6], horn: 'airhorn', drums: 0.35 },
  },
  {
    code: 'BR', flag: 'assets/flags/br-96.png', name: { ja: 'ブラジル', en: 'Brazil' },
    kit: { primary: '#f7d117', secondary: '#009c3b', accent: '#1b2f6b' },
    crowd: { density: 1, bright: 4200, chant: [0, 1, 2, 3, 4], horn: 'vuvuzela', drums: 0.8 },
  },
  {
    code: 'GB', flag: 'assets/flags/gb-96.png', name: { ja: 'イングランド', en: 'England' },
    kit: { primary: '#ffffff', secondary: '#c8102e', accent: '#1b2f6b' },
    crowd: { density: 0.95, bright: 2600, chant: [0, 2, 3, 5], horn: 'brass', drums: 0.5 },
  },
  {
    code: 'ES', flag: 'assets/flags/es-96.png', name: { ja: 'スペイン', en: 'Spain' },
    kit: { primary: '#c60b1e', secondary: '#ffc400', accent: '#1b2f6b' },
    crowd: { density: 0.9, bright: 3200, chant: [0, 1, 3, 5], horn: 'brass', drums: 0.45 },
  },
  {
    code: 'DE', flag: 'assets/flags/de-96.png', name: { ja: 'ドイツ', en: 'Germany' },
    kit: { primary: '#111111', secondary: '#dd0000', accent: '#ffce00' },
    crowd: { density: 0.92, bright: 2400, chant: [0, 2, 4], horn: 'drums', drums: 0.9 },
  },
  {
    code: 'IT', flag: 'assets/flags/it-96.png', name: { ja: 'イタリア', en: 'Italy' },
    kit: { primary: '#0066a1', secondary: '#ffffff', accent: '#009246' },
    crowd: { density: 0.85, bright: 2800, chant: [0, 2, 5], horn: 'brass', drums: 0.4 },
  },
  {
    code: 'FR', flag: 'assets/flags/fr-96.png', name: { ja: 'フランス', en: 'France' },
    kit: { primary: '#1f3a93', secondary: '#ffffff', accent: '#e1000f' },
    crowd: { density: 0.88, bright: 2600, chant: [0, 1, 3, 4], horn: 'airhorn', drums: 0.5 },
  },
  {
    code: 'AR', flag: 'assets/flags/ar-96.png', name: { ja: 'アルゼンチン', en: 'Argentina' },
    kit: { primary: '#7fb8e6', secondary: '#ffffff', accent: '#f6b40e' },
    crowd: { density: 1, bright: 4400, chant: [0, 1, 2, 4, 6], horn: 'drums', drums: 1 },
  },
  {
    code: 'PT', flag: 'assets/flags/pt-96.png', name: { ja: 'ポルトガル', en: 'Portugal' },
    kit: { primary: '#c8102e', secondary: '#046a38', accent: '#ffd100' },
    crowd: { density: 0.86, bright: 3000, chant: [0, 2, 3, 5], horn: 'airhorn', drums: 0.55 },
  },
  {
    code: 'NL', flag: 'assets/flags/nl-96.png', name: { ja: 'オランダ', en: 'Netherlands' },
    kit: { primary: '#ff6a13', secondary: '#ffffff', accent: '#21468b' },
    crowd: { density: 0.9, bright: 3400, chant: [0, 1, 2, 3], horn: 'brass', drums: 0.7 },
  },
  {
    code: 'HR', flag: 'assets/flags/hr-96.png', name: { ja: 'クロアチア', en: 'Croatia' },
    kit: { primary: '#ff0000', secondary: '#ffffff', accent: '#171796' },
    crowd: { density: 0.82, bright: 2800, chant: [0, 3, 5], horn: 'drums', drums: 0.65 },
  },
  {
    code: 'MA', flag: 'assets/flags/ma-96.png', name: { ja: 'モロッコ', en: 'Morocco' },
    kit: { primary: '#c1272d', secondary: '#006233', accent: '#ffffff' },
    crowd: { density: 0.95, bright: 3600, chant: [0, 1, 2, 5], horn: 'vuvuzela', drums: 0.85 },
  },
  {
    code: 'KR', flag: 'assets/flags/kr-96.png', name: { ja: '韓国', en: 'Korea' },
    kit: { primary: '#cd2e3a', secondary: '#0047a0', accent: '#ffffff' },
    crowd: { density: 0.93, bright: 3400, chant: [0, 2, 3, 4, 6], horn: 'drums', drums: 0.9 },
  },
  {
    code: 'US', flag: 'assets/flags/us-96.png', name: { ja: 'アメリカ', en: 'United States' },
    kit: { primary: '#1f2f6b', secondary: '#c8102e', accent: '#ffffff' },
    crowd: { density: 0.8, bright: 2600, chant: [0, 2, 4], horn: 'airhorn', drums: 0.3 },
  },
  {
    code: 'MX', flag: 'assets/flags/mx-96.png', name: { ja: 'メキシコ', en: 'Mexico' },
    kit: { primary: '#006847', secondary: '#ce1126', accent: '#ffffff' },
    crowd: { density: 0.96, bright: 4000, chant: [0, 1, 3, 5], horn: 'vuvuzela', drums: 0.75 },
  },
  {
    code: 'NG', flag: 'assets/flags/ng-96.png', name: { ja: 'ナイジェリア', en: 'Nigeria' },
    kit: { primary: '#008751', secondary: '#ffffff', accent: '#ffd100' },
    crowd: { density: 0.94, bright: 3800, chant: [0, 2, 3, 4], horn: 'drums', drums: 1 },
  },
]);

export const COUNTRY_CODES = Object.freeze(COUNTRIES.map((country) => country.code));

export function getCountry(code) {
  return COUNTRIES.find((country) => country.code === String(code).toUpperCase()) || COUNTRIES[0];
}

export function countryName(code, language) {
  const country = getCountry(code);
  return country.name[language] || country.name.en;
}

/** CPUの国を選ぶ（自分と同じ国は避ける） */
export function pickOpponent(excludeCode, random = Math.random) {
  const pool = COUNTRIES.filter((country) => country.code !== excludeCode);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** 3Dのチームカラー（ユニフォーム未装着の相手側に使う） */
export function countryKit(code) {
  return getCountry(code).kit;
}

export const COUNTRY_TOTAL = COUNTRIES.length;
