/**
 * SHOOTOUT 4 — PRO（IPKSF 公式加盟・買い切り ¥300・非消費型）の課金ブリッジ
 *
 * 3つの状態:
 *   store        iOS の StoreKit 2 プラグインがある（本物の価格・本物の購入）
 *   unavailable  プラグインの無いネイティブビルド（PRO は閉じたまま）
 *   preview      Web プレビュー（テスト用の解錠だけ。課金は起きない）
 *
 * 購入の正解は Apple の返事だけ。端末には「最後に分かった答え」を控えて、
 * オフライン起動でも PRO を保つ。失敗は必ず短い理由（SK: …）を残す。
 */

import { CONFIG } from '../config.js';
import { readJSON, writeJSON, KEYS } from '../storage.js';

export const PRODUCT_ID = CONFIG.iap.pro;
export const PLUGIN_NAME = 'StoreKit';
export const STORE_KEY = KEYS.pro;

export function fallbackPrice(language) {
  const table = {
    ja: '¥300', en: '$1.99', 'zh-Hans': '¥15', 'zh-Hant': 'NT$60', ko: '₩2,900',
    es: '1,99 €', pt: '1,99 €', fr: '1,99 €', de: '1,99 €', it: '1,99 €',
    th: '฿69', id: 'Rp32.000',
  };
  return table[language] || table.en;
}

let lastDiagnostic = '';

export function diagnostic() {
  return lastDiagnostic;
}

function note(text) {
  const value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!value) return '';
  lastDiagnostic = value.startsWith('SK:') ? value : `SK: ${value}`.slice(0, 96);
  return lastDiagnostic;
}

function clearNote() {
  lastDiagnostic = '';
}

export function capacitor() {
  if (typeof window === 'undefined') return null;
  return window.Capacitor || null;
}

export function plugin() {
  const cap = capacitor();
  const store = cap && cap.Plugins && cap.Plugins[PLUGIN_NAME];
  return store && typeof store.purchase === 'function' ? store : null;
}

export function nativePlatform() {
  const cap = capacitor();
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') return Boolean(cap.isNativePlatform());
  return typeof cap.platform === 'string' && cap.platform !== 'web';
}

export function mode() {
  if (plugin()) return 'store';
  if (nativePlatform() && !CONFIG.mockPurchases) return 'unavailable';
  return 'preview';
}

export function previewAllowed() {
  return mode() === 'preview' && CONFIG.mockPurchases;
}

function storage() {
  const cap = capacitor();
  if (cap && cap.Plugins && cap.Plugins.CapacitorPreferences) return null; /* 使わない: localStorage で足りる */
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function cachedEntitlement() {
  const saved = readJSON(storage(), STORE_KEY, null);
  return Boolean(saved && saved.entitled === true && saved.productId === PRODUCT_ID);
}

function remember(entitled) {
  writeJSON(storage(), STORE_KEY, {
    entitled: Boolean(entitled),
    productId: PRODUCT_ID,
    savedAt: Date.now(),
  });
}

export function initialEntitlement() {
  return cachedEntitlement();
}

/** 価格表示（StoreKit が答えたらそれを優先） */
export async function loadPrice() {
  const store = plugin();
  if (!store) return null;
  try {
    const answer = await store.getProducts({ ids: [PRODUCT_ID] });
    const product = answer && Array.isArray(answer.products) ? answer.products[0] : null;
    if (!product) {
      note((answer && answer.diag) || 'SK: empty');
      return null;
    }
    clearNote();
    return { id: product.id, price: product.displayPrice || '', name: product.displayName || '' };
  } catch (error) {
    note((error && (error.message || error.code)) || 'SK: getProducts failed');
    return null;
  }
}

/** null = 答えなし（持っていた値を保つ） */
export async function refreshEntitlement() {
  const store = plugin();
  if (!store) {
    if (nativePlatform()) note('SK: no plugin');
    return null;
  }
  try {
    const answer = await store.entitlement({ id: PRODUCT_ID });
    const entitled = Boolean(answer && answer.entitled);
    remember(entitled);
    return entitled;
  } catch (error) {
    note((error && (error.message || error.code)) || 'SK: entitlement failed');
    return null;
  }
}

export async function purchase() {
  const store = plugin();
  if (!store) {
    if (previewAllowed()) {
      /* プレビュー: 端末内のテスト解錠だけ。請求は起きない */
      remember(true);
      return { status: 'success', mock: true };
    }
    note('SK: no plugin');
    return { status: mode() === 'unavailable' ? 'unavailable' : 'preview' };
  }
  try {
    const answer = await store.purchase({ id: PRODUCT_ID });
    if (answer && answer.entitled === true) {
      clearNote();
      remember(true);
      return { status: 'success', transactionId: answer.transactionId || null };
    }
    const status = (answer && answer.status) || 'failed';
    if (status === 'cancelled') {
      clearNote();
      return { status };
    }
    if (answer && answer.diag) note(answer.diag);
    else if (status === 'failed') note('SK: purchase not finished');
    return { status };
  } catch (error) {
    const message = (error && (error.message || error.code)) || 'SK: purchase failed';
    note(message);
    return { status: 'failed', error: String(message) };
  }
}

export async function restore() {
  const store = plugin();
  if (!store) {
    if (previewAllowed()) {
      const entitled = cachedEntitlement();
      return { status: entitled ? 'restored' : 'nothing' };
    }
    note('SK: no plugin');
    return { status: mode() === 'unavailable' ? 'unavailable' : 'preview' };
  }
  try {
    const answer = await store.restore({ id: PRODUCT_ID });
    const entitled = Boolean(answer && answer.entitled);
    remember(entitled);
    if (answer && answer.diag && !entitled) note(answer.diag);
    return { status: entitled ? 'restored' : 'nothing' };
  } catch (error) {
    note((error && (error.message || error.code)) || 'SK: restore failed');
    return { status: 'failed' };
  }
}

/** テスト用: プレビューの解錠を消す（設定の「データをリセット」から） */
export function clearEntitlement() {
  remember(false);
}
