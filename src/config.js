/**
 * SHOOTOUT 4 — 設定の一元管理（ここだけ書き換えれば名前・ID・通信先が変わる）
 *
 * Bundle ID `jp.signlink.Shootout4` と IAP ID は仮確定値。App Store Connect に
 * 登録する商品 ID と必ず同じ文字列にすること（プロダクトは非消費型）。
 */
export const CONFIG = Object.freeze({
  title: 'SHOOTOUT 4',
  brand: 'IPKSF',
  federation: 'INTERNATIONAL PENALTY KICK SHOOTOUT FEDERATION',
  version: '1.0.0',
  build: 11,
  bundleId: 'jp.signlink.Shootout4',

  iap: {
    pro: 'jp.signlink.Shootout4.pro',
    skinPrefix: 'jp.signlink.Shootout4.skin.',
    proPrice: '¥300',
  },

  /* Supabase `games-realtime`（Realtime 専用・テーブルなし）。JANKeN PoN と同じ公開キー。 */
  supabase: {
    url: 'https://siivncidktbuyqwsjeqd.supabase.co',
    anonKey: 'sb_publishable_lrs0ilfAGmibFiiP4DHYaA_Bk7lgzuZ',
    channel: 'games-realtime',
  },

  /* ルール */
  roundSeconds: 8,
  kickers: 5,
  matchTimeoutMs: 30000,

  /* 演出 */
  revealMs: 1800,
  openingMs: 3000,
  cameraMs: 900,
  /* キッカー↔キーパーの交代ワンクッション（1.2〜1.5秒） */
  handoverMs: 1300,

  /* 画像 */
  icon: 'assets/icon-1024.png',
  emblem: 'assets/emblem-512.png',

  /* Web プレビューでのテスト購入（ネイティブでは StoreKit 2 のみ） */
  mockPurchases: true,
});

export const DEFAULT_PREFS = Object.freeze({
  sound: true,
  bgm: true,
  vibrate: true,
  size: 'standard',
  night: false,
  flash: true,
  /* 初回起動の言語は端末言語（i18n.js が決める） */
  language: null,
  nickname: '',
  country: 'JP',
  /* 攻撃順: first = 先攻 / second = 後攻（PKの1本目をどちらが蹴るか） */
  order: 'first',
});
