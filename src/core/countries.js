/**
 * SHOOTOUT 4 — 世界大会に参加する32の国（IPKSF オリジナル設定）
 *
 * 無料で選べる16か国と、IPKSF 公式加盟（PRO）で選べる16か国（ワールドカップ風の計32）。
 * どちらの国を選んでも能力差はゼロ（見た目と歓声だけが変わる）。
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

  /* ---- ここから PRO（IPKSF 公式加盟）で選べる16か国 ---- */
  {
    code: 'UY', flag: 'assets/flags/uy-96.png', name: { ja: 'ウルグアイ', en: 'Uruguay' }, pro: true,
    kit: { primary: '#7fb8e6', secondary: '#ffffff', accent: '#f6b40e' },
    crowd: { density: 0.95, bright: 3600, chant: [0, 1, 2, 4], horn: 'drums', drums: 0.85 },
  },
  {
    code: 'BE', flag: 'assets/flags/be-96.png', name: { ja: 'ベルギー', en: 'Belgium' }, pro: true,
    kit: { primary: '#c8102e', secondary: '#111820', accent: '#f2c24b' },
    crowd: { density: 0.9, bright: 3000, chant: [0, 2, 4, 5], horn: 'brass', drums: 0.55 },
  },
  {
    code: 'CO', flag: 'assets/flags/co-96.png', name: { ja: 'コロンビア', en: 'Colombia' }, pro: true,
    kit: { primary: '#f2c24b', secondary: '#1b3fa0', accent: '#c8102e' },
    crowd: { density: 0.97, bright: 4000, chant: [0, 1, 3, 4], horn: 'vuvuzela', drums: 0.9 },
  },
  {
    code: 'SN', flag: 'assets/flags/sn-96.png', name: { ja: 'セネガル', en: 'Senegal' }, pro: true,
    kit: { primary: '#0f7a4a', secondary: '#ffffff', accent: '#f2c24b' },
    crowd: { density: 0.96, bright: 3800, chant: [0, 2, 3, 5], horn: 'drums', drums: 1 },
  },
  {
    code: 'CH', flag: 'assets/flags/ch-96.png', name: { ja: 'スイス', en: 'Switzerland' }, pro: true,
    kit: { primary: '#c8102e', secondary: '#ffffff', accent: '#111820' },
    crowd: { density: 0.82, bright: 2600, chant: [0, 2, 4], horn: 'brass', drums: 0.45 },
  },
  {
    code: 'DK', flag: 'assets/flags/dk-96.png', name: { ja: 'デンマーク', en: 'Denmark' }, pro: true,
    kit: { primary: '#c8102e', secondary: '#ffffff', accent: '#111820' },
    crowd: { density: 0.86, bright: 2800, chant: [0, 1, 3, 5], horn: 'brass', drums: 0.5 },
  },
  {
    code: 'PL', flag: 'assets/flags/pl-96.png', name: { ja: 'ポーランド', en: 'Poland' }, pro: true,
    kit: { primary: '#ffffff', secondary: '#c8102e', accent: '#111820' },
    crowd: { density: 0.9, bright: 3000, chant: [0, 2, 4, 6], horn: 'drums', drums: 0.7 },
  },
  {
    code: 'AU', flag: 'assets/flags/au-96.png', name: { ja: 'オーストラリア', en: 'Australia' }, pro: true,
    kit: { primary: '#f2c24b', secondary: '#0f7a4a', accent: '#111820' },
    crowd: { density: 0.84, bright: 3200, chant: [0, 1, 2, 5], horn: 'airhorn', drums: 0.6 },
  },
  {
    code: 'SE', flag: 'assets/flags/se-96.png', name: { ja: 'スウェーデン', en: 'Sweden' }, pro: true,
    kit: { primary: '#f2c24b', secondary: '#1b3fa0', accent: '#ffffff' },
    crowd: { density: 0.85, bright: 2700, chant: [0, 2, 3, 4], horn: 'brass', drums: 0.45 },
  },
  {
    code: 'EG', flag: 'assets/flags/eg-96.png', name: { ja: 'エジプト', en: 'Egypt' }, pro: true,
    kit: { primary: '#c8102e', secondary: '#ffffff', accent: '#111820' },
    crowd: { density: 0.95, bright: 3600, chant: [0, 1, 3, 5], horn: 'drums', drums: 0.95 },
  },
  {
    code: 'GH', flag: 'assets/flags/gh-96.png', name: { ja: 'ガーナ', en: 'Ghana' }, pro: true,
    kit: { primary: '#ffffff', secondary: '#c8102e', accent: '#f2c24b' },
    crowd: { density: 0.93, bright: 3800, chant: [0, 2, 4, 5], horn: 'drums', drums: 0.9 },
  },
  {
    code: 'CM', flag: 'assets/flags/cm-96.png', name: { ja: 'カメルーン', en: 'Cameroon' }, pro: true,
    kit: { primary: '#0f7a4a', secondary: '#c8102e', accent: '#f2c24b' },
    crowd: { density: 0.94, bright: 3700, chant: [0, 1, 3, 4], horn: 'vuvuzela', drums: 0.95 },
  },
  {
    code: 'EC', flag: 'assets/flags/ec-96.png', name: { ja: 'エクアドル', en: 'Ecuador' }, pro: true,
    kit: { primary: '#f2c24b', secondary: '#1b3fa0', accent: '#c8102e' },
    crowd: { density: 0.92, bright: 3900, chant: [0, 2, 3, 5], horn: 'drums', drums: 0.85 },
  },
  {
    code: 'CA', flag: 'assets/flags/ca-96.png', name: { ja: 'カナダ', en: 'Canada' }, pro: true,
    kit: { primary: '#c8102e', secondary: '#ffffff', accent: '#111820' },
    crowd: { density: 0.8, bright: 2600, chant: [0, 1, 2, 4], horn: 'airhorn', drums: 0.35 },
  },
  {
    code: 'TR', flag: 'assets/flags/tr-96.png', name: { ja: 'トルコ', en: 'Turkey' }, pro: true,
    kit: { primary: '#c8102e', secondary: '#ffffff', accent: '#111820' },
    crowd: { density: 0.94, bright: 3300, chant: [0, 2, 4, 6], horn: 'drums', drums: 0.8 },
  },
  {
    code: 'AT', flag: 'assets/flags/at-96.png', name: { ja: 'オーストリア', en: 'Austria' }, pro: true,
    kit: { primary: '#c8102e', secondary: '#ffffff', accent: '#111820' },
    crowd: { density: 0.83, bright: 2800, chant: [0, 1, 3, 5], horn: 'brass', drums: 0.5 },
  },
]);

export const COUNTRY_CODES = Object.freeze(COUNTRIES.map((country) => country.code));
export const FREE_COUNTRIES = Object.freeze(COUNTRIES.filter((country) => !country.pro));
export const PRO_COUNTRIES = Object.freeze(COUNTRIES.filter((country) => country.pro));

/** その国を選べるか（PRO の16か国は公式加盟のみ） */
export function isCountryUnlocked(code, entitled) {
  const country = COUNTRIES.find((item) => item.code === String(code).toUpperCase());
  return Boolean(country) && (!country.pro || entitled === true);
}

export function getCountry(code) {
  return COUNTRIES.find((country) => country.code === String(code).toUpperCase()) || COUNTRIES[0];
}

export function countryName(code, language) {
  const country = getCountry(code);
  return country.name[language] || country.name.en;
}

/** CPUの国を選ぶ（自分と同じ国は避ける）。未加入なら無料の16か国から。 */
export function pickOpponent(excludeCode, random = Math.random, { entitled = true } = {}) {
  const base = entitled === true ? COUNTRIES : FREE_COUNTRIES;
  const pool = base.filter((country) => country.code !== excludeCode);
  const list = pool.length ? pool : FREE_COUNTRIES;
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/** 3Dのチームカラー（ユニフォーム未装着の相手側に使う） */
export function countryKit(code) {
  return getCountry(code).kit;
}

export const COUNTRY_TOTAL = COUNTRIES.length;
export const FREE_COUNTRY_TOTAL = FREE_COUNTRIES.length;
export const PRO_COUNTRY_TOTAL = PRO_COUNTRIES.length;
