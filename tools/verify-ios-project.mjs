#!/usr/bin/env node
/**
 * SHOOTOUT 4 — iOS プロジェクトの契約チェック（verify-ios-project 相当）
 *
 *   node tools/verify-ios-project.mjs
 *
 * Xcode の無い環境でも、CI の preflight と同じ観点をここで確かめる:
 *   ・Bundle ID / 表示名 / ビルド番号 / MARKETING_VERSION
 *   ・CFBundleDevelopmentRegion = ja（日本語で起動）
 *   ・縦持ち固定・ITSAppUsesNonExemptEncryption=false
 *   ・StoreKit 2 プラグイン（商品ID）と音のブリッジが AppDelegate に実在
 *   ・AppIcon は 1024x1024 RGB（アルファ無し）
 *   ・配布用 www/ が作れて、必要なファイルが入っている
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const exists = (path) => existsSync(resolve(ROOT, path));

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? 'ok  ' : 'NG  '}${name}${ok ? '' : ` ${JSON.stringify(detail)}`}\n`);
};

/* ---------- 構成 ---------- */
const required = [
  'ios/App/App.xcodeproj/project.pbxproj',
  'ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme',
  'ios/App/App/Info.plist',
  'ios/App/App/AppDelegate.swift',
  'ios/App/App/SceneDelegate.swift',
  'ios/App/App/Base.lproj/Main.storyboard',
  'ios/App/App/Base.lproj/LaunchScreen.storyboard',
  'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
  'ios/App/CapApp-SPM/Package.swift',
  'ios/App/App/capacitor.config.json',
  'capacitor.config.json',
  'package.json',
];
for (const path of required) check(`構成: ${path}`, exists(path));
check('構成: ios/App/App/public を含めない（cap sync が作る）', !exists('ios/App/App/public'));

/* ---------- Bundle ID / バージョン ---------- */
const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
const buildNumbers = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => Number(match[1]));
const marketing = [...pbx.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map((match) => match[1]);
check('pbxproj: Bundle ID は jp.signlink.Shootout4', (pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = jp\.signlink\.Shootout4;/g) || []).length === 2, pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g));
check('pbxproj: ビルド番号が2箇所で同じ正の整数', buildNumbers.length === 2 && new Set(buildNumbers).size === 1 && buildNumbers[0] > 0, buildNumbers);
check('pbxproj: MARKETING_VERSION は 1.0.0', marketing.length === 2 && marketing.every((value) => value === '1.0.0'), marketing);
check('pbxproj: AppIcon の設定', /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/.test(pbx));

/* ---------- Info.plist ---------- */
const plist = read('ios/App/App/Info.plist');
const plistValue = (key) => {
  const match = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match ? match[1] : null;
};
check('Info.plist: CFBundleDevelopmentRegion = ja', plistValue('CFBundleDevelopmentRegion') === 'ja', plistValue('CFBundleDevelopmentRegion'));
check('Info.plist: 表示名は SHOOTOUT 4', plistValue('CFBundleDisplayName') === 'SHOOTOUT 4', plistValue('CFBundleDisplayName'));
check('Info.plist: 縦持ちのみ', /UIInterfaceOrientationPortrait<\/string>/.test(plist) && !/UIInterfaceOrientationLandscape/.test(plist));
check('Info.plist: 輸出暗号の申告（非該当）', /ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(plist));
check('Info.plist: ステータスバー非表示（全画面）', /UIStatusBarHidden<\/key>\s*<true\/>/.test(plist));

/* ---------- AppDelegate ---------- */
const appDelegate = read('ios/App/App/AppDelegate.swift');
const sceneDelegate = read('ios/App/App/SceneDelegate.swift');
check('AppDelegate: StoreKit を import', /import StoreKit/.test(appDelegate));
check('AppDelegate: StoreKit プラグイン（jsName = StoreKit）', /jsName = "StoreKit"/.test(appDelegate));
check('AppDelegate: PRO の商品IDが入っている', appDelegate.includes("jp.signlink.Shootout4.pro"));
check('AppDelegate: 音のブリッジ（ShootoutAudio）', /jsName = "ShootoutAudio"/.test(appDelegate) && /registerPluginInstance\(ShootoutAudioPlugin\(\)\)/.test(appDelegate));
check('AppDelegate: AVAudioSession を playback に', /AVAudioSession/.test(appDelegate) && /setCategory\(\.playback/.test(appDelegate));
check('AppDelegate: プラグインを明示登録（NSClassFromString に頼らない）', /registerPluginInstance\(StoreKitPlugin\(\)\)/.test(appDelegate));
check('SceneDelegate: ShootoutBridgeViewController を root に', /ShootoutBridgeViewController\(\)/.test(sceneDelegate));

/* ---------- capacitor ---------- */
let cap = {};
try {
  cap = JSON.parse(read('ios/App/App/capacitor.config.json'));
} catch {
  cap = {};
}
check('Capacitor: appId が一致', cap.appId === 'jp.signlink.Shootout4', cap.appId);
check('Capacitor: appName は SHOOTOUT 4', cap.appName === 'SHOOTOUT 4', cap.appName);
check('Capacitor: webDir = www', cap.webDir === 'www', cap.webDir);
check('Capacitor: スクロール無効・背景色', cap.ios && cap.ios.scrollEnabled === false && cap.ios.backgroundColor === '#071226', cap.ios);
check('Capacitor: Swift Package は 8.6.2', /exact: "8\.6\.2"/.test(read('ios/App/CapApp-SPM/Package.swift')));

/* ---------- アイコン ---------- */
function pngHeader(path) {
  const bytes = readFileSync(resolve(ROOT, path));
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}
for (const path of ['assets/icon-1024.png', 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png']) {
  const header = pngHeader(path);
  check(`アイコン: ${path} は 1024x1024 / RGB / アルファ無し`, header && header.width === 1024 && header.height === 1024 && header.bitDepth === 8 && header.colorType === 2, header);
}

/* ---------- 表示用の全サイズ ---------- */
const iconDir = resolve(ROOT, 'assets/icons');
const sizes = existsSync(iconDir) ? readdirSync(iconDir).filter((name) => name.endsWith('.png')) : [];
check('アイコン: iOS 全サイズ（11種）がそろう', sizes.length >= 11, sizes);

/* ---------- Web の配布物 ---------- */
try {
  execFileSync(process.execPath, [resolve(ROOT, 'tools/make-www.mjs')], { cwd: ROOT, stdio: 'pipe' });
  const www = [
    'www/index.html', 'www/styles.css', 'www/src/main.js', 'www/src/i18n.js',
    'www/src/core/rules.js', 'www/src/net/online.js', 'www/src/platform/iap.js',
    'www/vendor/three.module.min.js', 'www/assets/icon-1024.png', 'www/assets/emblem-512.png',
    'www/assets/flags/jp-96.png',
    /* Build 8: 効果音ラボの MP3（iOS のバンドルにも入る） */
    'www/assets/sfx/people-stadium-cheer1.mp3', 'www/assets/sfx/air-horn1.mp3',
    'www/assets/sfx/trumpet1.mp3', 'www/assets/sfx/mens-yeah1.mp3',
    'www/assets/sfx/people-shout-oo1.mp3', 'www/assets/sfx/people-performance-uwaa1.mp3',
  ];
  check('www: 配布用ファイルが作れる', www.every((path) => exists(path)), www.filter((path) => !exists(path)));
  const index = read('www/index.html');
  check('www: viewport-fit=cover（セーフエリア）', /viewport-fit=cover/.test(index));
  check('www: タイトル SHOOTOUT 4', /<title>SHOOTOUT 4<\/title>/.test(index));
} catch (error) {
  check('www: 配布用ファイルが作れる', false, String(error && error.message));
}

/* ---------- 設定の一致（config.js と pbxproj / IAP） ---------- */
const config = read('src/config.js');
check('設定: config.js の bundleId が一致', /bundleId: 'jp\.signlink\.Shootout4'/.test(config));
check('設定: PRO 商品IDが一致', /pro: 'jp\.signlink\.Shootout4\.pro'/.test(config));
check('設定: ラウンドは7秒', /roundSeconds: 7/.test(config));
check('設定: 開発地域は ja（index.html）', /<html lang="ja"/.test(read('index.html')));

const failed = checks.filter((item) => !item.ok);
process.stdout.write(`\n${checks.length - failed.length}/${checks.length} iOS project checks passed\n`);
if (failed.length) {
  process.stdout.write(`failed: ${failed.map((item) => item.name).join(' / ')}\n`);
  process.exitCode = 1;
}
