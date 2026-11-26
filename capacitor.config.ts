import type { CapacitorConfig } from '@capacitor/cli';
import { CONFIG } from './src/config.js';

/**
 * Capacitor 8 の設定。
 *  - webDir は tools/make-www.mjs が作る www/
 *  - 画面は縦固定・スクロールはアプリ側で管理（body は overflow: hidden）
 */
const config: CapacitorConfig = {
  appId: CONFIG.bundleId,
  appName: CONFIG.title,
  webDir: 'www',
  ios: {
    contentInset: 'never',
    backgroundColor: '#071226',
    scrollEnabled: false,
  },
  android: {
    backgroundColor: '#071226',
  },
};

export default config;
