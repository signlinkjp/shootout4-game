/**
 * SHOOTOUT 4 — 実ブラウザ E2E（Chromium / Playwright）
 *
 *   node tools/shots-prod.mjs          … 全チェック＋スクリーンショット
 *   node tools/shots-prod.mjs smoke    … 起動確認だけ
 *
 * 確かめること:
 *   A. 日本語端末で日本語起動・オープニング（3秒・スキップ可）
 *   B. 3Dスタジアムが実際に描画される（WebGL・観客・キッカー・ゴール）
 *   C. 7秒＋決定: 4択→決定→即結果、タイムアップの自動選択
 *   D. PK進行: 5本ずつ→サドンデス→決着、スコアボードの○×
 *   E. ロッカー: 選んだユニフォーム＆スパイクが試合の3Dに反映
 *   F. 文字サイズ 特大・12言語・幅320/360/393で崩れない
 *   G. デイ/ナイター、PRO購入（プレビュー）、コンソールエラー0
 *
 * 保存先: ../../downloads/shootout4-prod-*.png
 */

import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = resolve(ROOT, '../..');
const OUT = resolve(WORKSPACE, 'downloads');
const LIBS = process.env.PLAYWRIGHT_LIBS ?? '/workspace/work/dorokei-game/.browser-libs/usr/lib/x86_64-linux-gnu';
const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_PATH,
  '/workspace/work/dcd-b17/node_modules/playwright/index.js',
  'playwright',
].filter(Boolean);

function loadChromium() {
  const require = createRequire(import.meta.url);
  for (const specifier of PLAYWRIGHT_CANDIDATES) {
    try {
      const mod = require(specifier);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
    } catch {
      /* 次の候補 */
    }
  }
  throw new Error('playwright が見つかりません');
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? 'ok  ' : 'NG  '}${name}${ok ? '' : ` ${JSON.stringify(detail)}`}\n`);
}

const PHONE = { width: 393, height: 852 };
const errors = [];

async function openPage(browser, { url, locale = 'ja-JP', viewport = PHONE, dpr = 2, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    locale,
    timezoneId: 'Asia/Tokyo',
    colorScheme: 'dark',
    reducedMotion,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const target = request.url();
    if (!target.includes('favicon') && !target.includes('supabase.co')) errors.push(`requestfailed: ${target}`);
  });
  await page.goto(`${url}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__SHOOTOUT_READY__ === true, null, { timeout: 20000 });
  return { context, page };
}

async function shot(page, name) {
  await page.screenshot({ path: resolve(OUT, `shootout4-prod-${name}.png`) });
  process.stdout.write(`    → downloads/shootout4-prod-${name}.png\n`);
}

const state = (page) => page.evaluate(() => ({
  screen: window.__SHOOTOUT__.screen,
  prefs: window.__SHOOTOUT__.prefs,
  match: window.__SHOOTOUT__.match,
  record: window.__SHOOTOUT__.record,
  entitled: window.__SHOOTOUT__.entitled,
  stadium: window.__SHOOTOUT__.stadium(),
  audio: window.__SHOOTOUT__.audio,
}));

/** 1本蹴る（自分の手を選び、決定）。結果が出るまで待つ */
async function playKick(page, dir) {
  const before = await page.evaluate(() => window.__SHOOTOUT__.match?.history ?? 0);
  await page.evaluate((direction) => {
    window.__SHOOTOUT__.selectDirection(direction);
    window.__SHOOTOUT__.confirmKick();
  }, dir);
  await page.waitForFunction((history) => {
    const match = window.__SHOOTOUT__.match;
    return match && match.history > history;
  }, before, { timeout: 12000 });
  await page.waitForTimeout(260);
}

/**
 * 決着まで進める（CPUの方向は固定して検証を決定的にする）。
 * 最初の10本は全部セーブ（0-0）でサドンデスへ入り、
 * 11本目で自分だけ決めて 1-0 で勝つ。
 */
async function playToEnd(page, { max = 26 } = {}) {
  let guard = 0;
  while (guard < max) {
    guard += 1;
    const info = await page.evaluate(() => window.__SHOOTOUT__.match);
    if (!info || info.winner) return info;
    const round = info.history;
    const dir = round < 10 ? 'TL' : (info.role === 'shoot' ? 'TR' : 'TL');
    await playKick(page, dir);
    await page.evaluate(() => { if (window.__SHOOTOUT__.match?.winner) return; window.__SHOOTOUT__.next(); });
    await page.waitForTimeout(120);
  }
  return page.evaluate(() => window.__SHOOTOUT__.match);
}

/** 全画面を順に開いて、横はみ出し・巨大要素・文字の切れを探す */
async function sweepScreens(page, label, screens = ['home', 'country', 'locker', 'pro', 'online', 'rank', 'stats', 'settings', 'rules', 'privacy']) {
  const problems = [];
  for (const screen of screens) {
    await page.evaluate((name) => window.__SHOOTOUT__.go(name), screen);
    await sleep(140);
    const result = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;
      const wide = [...document.querySelectorAll('main *')]
        .filter((element) => {
          if (!element.getClientRects().length) return false;
          if (element.closest('.strip')) return false; /* 横スクロールは仕様 */
          if (getComputedStyle(element).pointerEvents === 'none') return false; /* 装飾 */
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0) return false;
          return rect.right > window.innerWidth + 2 || rect.left < -2;
        })
        .slice(0, 3)
        .map((element) => `${element.tagName}.${String(element.className).slice(0, 40)}`);
      const tall = [...document.querySelectorAll('svg')]
        .filter((svg) => {
          const rect = svg.getBoundingClientRect();
          return rect.height > 64 || rect.width > 64;
        })
        .slice(0, 3)
        .map((svg) => `${String(svg.getAttribute('class') || '').slice(0, 30)}:${Math.round(svg.getBoundingClientRect().width)}`);
      return { overflow, wide, tall };
    });
    if (result.overflow > 0 || result.wide.length || result.tall.length) problems.push({ screen, ...result });
  }
  return { label, problems };
}

async function layoutCheck(page, label) {
  return page.evaluate((where) => {
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth - doc.clientWidth;
    const zones = [...document.querySelectorAll('.zone')].map((zone) => zone.getBoundingClientRect());
    const controls = document.querySelector('.controls')?.getBoundingClientRect();
    const clipped = [...document.querySelectorAll('.btn, .zone, .menu__label, .segment, .seg')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1);
      })
      .map((element) => element.className);
    return { where, overflowX, clipped: clipped.slice(0, 4), zones: zones.length, controls: controls ? Math.round(controls.bottom) : null, height: window.innerHeight };
  }, label);
}

async function main() {
  const mode = process.argv[2] || 'full';
  const chromium = loadChromium();
  const server = await startServer();
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--enable-unsafe-swiftshader'],
    env: { ...process.env, LD_LIBRARY_PATH: `${LIBS}:${process.env.LD_LIBRARY_PATH ?? ''}` },
  });

  try {
    /* ============================================================== *\
     * A. 日本語端末・オープニング・ホーム
     * ============================================================== */
    /* 7秒の初期値は、描画の軽い小さめの画面で測る（スクショの待ちに邪魔されない） */
    const probe = await openPage(browser, { url: server.url, dpr: 1, viewport: { width: 360, height: 640 } });
    await probe.page.evaluate(() => { window.__SHOOTOUT__.skipOpening(); window.__SHOOTOUT__.startMatch(); });
    const probeStart = await probe.page.evaluate(() => window.__SHOOTOUT__.match?.remainingMs ?? 0);
    await probe.context.close();
    check('C0 ラウンドは7秒から始まる', probeStart > 5500 && probeStart <= 7000, { probeStart });

    const { context, page } = await openPage(browser, { url: server.url });
    const opening = await page.evaluate(() => ({
      present: Boolean(document.querySelector('.opening')),
      lang: document.documentElement.lang,
      title: document.querySelector('.opening__sub')?.textContent ?? '',
      skip: document.querySelector('.opening__skip')?.textContent ?? '',
    }));
    check('A1 日本語端末は日本語で起動', opening.lang === 'ja', opening);
    check('A2 オープニングが出る（3秒・スキップ可）', opening.present && /世界PK選手権/.test(opening.title), opening);
    await page.evaluate(() => window.__SHOOTOUT__.skipOpening());
    await sleep(420);
    const home = await page.evaluate(() => ({
      gone: !document.querySelector('.opening'),
      tag: document.querySelector('.hero__tag')?.textContent ?? '',
      play: document.querySelector('[data-action="country"]')?.textContent?.trim() ?? '',
      emblem: document.querySelector('.hero__img')?.complete ?? false,
    }));
    check('A3 スキップでホームへ・日本語の文言', home.gone && /4択/.test(home.tag) && /CPU/.test(home.play), home);
    check('A4 公式エンブレムを読み込み', home.emblem === true);
    await shot(page, 'home');

    /* ============================================================== *\
     * B. 国えらび → 3D試合
     * ============================================================== */
    await page.click('button[data-action="country"]');
    await sleep(300);
    check('B1 国えらび画面（16か国）', await page.evaluate(() => document.querySelectorAll('[data-mycountry]').length === 16));
    await page.click('button[data-opponent="BR"]');
    await page.click('button[data-level="elite"]');
    await sleep(250);
    await shot(page, 'country');
    await page.click('[data-testid="kickoff"]');
    await page.waitForSelector('#scene', { timeout: 8000 });
    await sleep(500);
    const tick0 = await page.evaluate(() => ({
      text: document.querySelector('#timer-text')?.textContent ?? '',
      remaining: window.__SHOOTOUT__.match?.remainingMs ?? 0,
      roundSeconds: window.__SHOOTOUT__.roundSeconds,
    }));
    await sleep(700);
    const tick1 = await page.evaluate(() => ({
      text: document.querySelector('#timer-text')?.textContent ?? '',
      remaining: window.__SHOOTOUT__.match?.remainingMs ?? 0,
    }));
    check('C1 7秒のカウントダウンが動く', tick0.roundSeconds === 7 && tick1.remaining > 0 && tick1.remaining < tick0.remaining, { tick0, tick1 });
    await page.evaluate(() => window.__SHOOTOUT__.hold());
    await sleep(150);
    await shot(page, 'match-day');
    const match = await state(page);
    check('B2 3Dスタジアムが描画される', match.stadium.available === true && match.stadium.crowd > 2000 && match.stadium.kickers === 5, match.stadium);
    check('B3 試合画面に4択と決定ボタン', await page.evaluate(() => document.querySelectorAll('.zone').length === 4 && Boolean(document.querySelector('#confirm'))));
    check('B4 決定は未選択では押せない', await page.evaluate(() => document.querySelector('#confirm').disabled === true));

    /* ============================================================== *\
     * C. 7秒＋決定
     * ============================================================== */
    await page.click('[data-testid="zone-TL"]');
    check('C2 方向を選ぶと決定が押せる', await page.evaluate(() => document.querySelector('#confirm').disabled === false));
    await shot(page, 'aim');
    await page.evaluate(() => window.__SHOOTOUT__.confirmKick());
    await page.waitForFunction(() => window.__SHOOTOUT__.match?.history >= 1, null, { timeout: 10000 });
    await page.waitForSelector('#banner:not([hidden])', { timeout: 6000 }).catch(() => {});
    await sleep(200);
    const afterKick = await page.evaluate(() => ({
      banner: document.querySelector('#banner')?.textContent ?? '',
      bannerShown: !document.querySelector('#banner')?.hidden,
      cells: document.querySelectorAll('[data-testid="pk-me"] .pkcell.is-goal, [data-testid="pk-me"] .pkcell.is-miss').length,
    }));
    check('C3 決定した瞬間に結果が出る', afterKick.cells === 1 && ['ゴール！', 'セーブ！'].includes(afterKick.banner), afterKick);
    await shot(page, 'result-anim');

    /* タイムアップの自動選択（1回だけ7秒待つ） */
    await page.evaluate(() => window.__SHOOTOUT__.next());
    await sleep(500);
    const beforeTimeout = await page.evaluate(() => window.__SHOOTOUT__.match?.history ?? 0);
    await page.waitForFunction((history) => (window.__SHOOTOUT__.match?.history ?? 0) > history, beforeTimeout, { timeout: 15000 });
    const auto = await page.evaluate(() => ({
      status: document.querySelector('#kick-status')?.textContent ?? '',
      history: window.__SHOOTOUT__.match?.history ?? 0,
    }));
    check('C4 時間切れは自動で選択されて進む', auto.history > beforeTimeout, auto);

    /* ============================================================== *\
     * D. PK進行（5本ずつ → 0-0 でサドンデス → 6本目で決着）
     * ============================================================== */
    await page.evaluate(() => {
      window.__SHOOTOUT_FORCE_CPU__ = ['TL'];
      window.__SHOOTOUT__.startMatch();
    });
    await sleep(700);
    const result = await playToEnd(page, { max: 26 });
    check('D1 決着まで進む（5本＋サドンデス）', Boolean(result && result.winner), result);
    check('D2 6本目以降のサドンデスに到達', (result?.kicks?.me?.length ?? 0) >= 6 || (result?.kicks?.opp?.length ?? 0) >= 6, result?.kicks);
    await page.waitForFunction(() => window.__SHOOTOUT__.screen === 'result', null, { timeout: 10000 }).catch(() => {});
    await sleep(300);
    const resultView = await page.evaluate(() => ({
      screen: window.__SHOOTOUT__.screen,
      title: document.querySelector('[data-testid="result-title"]')?.textContent ?? '',
      score: document.querySelector('[data-testid="result-score"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      cells: document.querySelectorAll('.pkcell').length,
    }));
    check('D3 結果画面（勝敗・最終スコア・PK表）', resultView.screen === 'result' && /勝利|敗北/.test(resultView.title) && resultView.cells >= 12, resultView);
    await shot(page, 'result');
    const record = await page.evaluate(() => window.__SHOOTOUT__.record);
    check('D4 戦績が保存される', record.played >= 1 && record.wins + record.losses === record.played, record);

    /* ============================================================== *\
     * E. ロッカー（PRO・ユニフォーム・スパイク）
     * ============================================================== */
    await page.evaluate(() => window.__SHOOTOUT__.go('home'));
    await sleep(300);
    const beforePro = await page.evaluate(() => window.__SHOOTOUT__.entitled);
    await page.click('button[data-action="locker"]');
    await sleep(300);
    await shot(page, 'locker-locked');
    await page.click('[data-action="pro"]');
    await sleep(300);
    await shot(page, 'pro');
    await page.click('[data-testid="pro-buy"]');
    await sleep(600);
    const afterPro = await page.evaluate(() => window.__SHOOTOUT__.entitled);
    check('E1 PRO（プレビューのテスト解錠）が入る', beforePro === false && afterPro === true, { beforePro, afterPro });
    await page.evaluate(() => window.__SHOOTOUT__.go('locker'));
    await sleep(300);
    await page.click('[data-testid="kit-royal-stripe"]');
    await sleep(200);
    await page.click('[data-testid="boot-speed-gold"]');
    await sleep(250);
    await shot(page, 'locker');
    await page.click('[data-testid="save-skin"]');
    await sleep(300);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('shootout4.skin.v1') || '{}'));
    check('E2 ユニフォームとスパイクを保存', saved.kit === 'royal-stripe' && saved.boot === 'speed-gold', saved);
    await page.evaluate(() => {
      window.__SHOOTOUT_FORCE_CPU__ = ['BR'];
      window.__SHOOTOUT__.startMatch();
    });
    await sleep(1200);
    const staged = await state(page);
    check('E3 選んだキットが3Dに反映', staged.stadium.kit === 'royal-stripe' && staged.stadium.boot === 'speed-gold', staged.stadium);
    await shot(page, 'match-kit');

    /* ゴール演出（カメラ・紙吹雪・ネット） */
    await page.evaluate(() => {
      window.__SHOOTOUT__.selectDirection('TL');
      window.__SHOOTOUT__.confirmKick();
    });
    await page.waitForFunction(() => (window.__SHOOTOUT__.match?.history ?? 0) >= 1, null, { timeout: 12000 });
    await page.waitForTimeout(420);
    const anim = await page.evaluate(() => ({
      match: window.__SHOOTOUT__.match,
      confetti: window.__SHOOTOUT__.stadium().confetti,
      net: window.__SHOOTOUT__.stadium().netEnergy,
    }));
    check('E4 ゴール時にネットが揺れ紙吹雪が出る', anim.confetti === true || anim.net > 0, anim);
    await shot(page, 'goal');

    /* ============================================================== *\
     * F. ナイター・文字特大・12言語・狭い幅
     * ============================================================== */
    await page.evaluate(() => { window.__SHOOTOUT_FORCE_CPU__ = null; });
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ night: true, size: 'extra' }));
    await sleep(900);
    const nightShotState = await state(page);
    check('F1 ナイターに切り替わる', nightShotState.stadium.night === true, nightShotState.stadium);
    check('F2 文字特大でも横にはみ出さない（試合）', (await layoutCheck(page, 'match-extra')).overflowX <= 0, await layoutCheck(page, 'match-extra'));
    await shot(page, 'match-night-extra');
    await page.evaluate(() => window.__SHOOTOUT__.go('home'));
    await sleep(300);
    const extraHome = await layoutCheck(page, 'home-extra');
    check('F3 文字特大でも横にはみ出さない（ホーム）', extraHome.overflowX <= 0 && extraHome.clipped.length === 0, extraHome);
    await shot(page, 'home-extra');
    const sweepExtra = await sweepScreens(page, 'extra');
    check('F3b 全画面（特大）で、はみ出し・巨大アイコン・文字切れなし', sweepExtra.problems.length === 0, sweepExtra.problems);
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ size: 'standard' }));
    await sleep(200);
    const sweepStandard = await sweepScreens(page, 'standard');
    check('F3c 全画面（標準）で、はみ出し・巨大アイコン・文字切れなし', sweepStandard.problems.length === 0, sweepStandard.problems);

    await page.evaluate(() => window.__SHOOTOUT__.go('home'));
    await sleep(200);
    const languages = await page.evaluate(() => window.__SHOOTOUT__.languages);
    let languageProblems = [];
    for (const language of languages) {
      await page.evaluate((tag) => {
        if (window.__SHOOTOUT__.screen !== 'home') window.__SHOOTOUT__.go('home');
        window.__SHOOTOUT__.setPrefs({ language: tag });
      }, language);
      await sleep(120);
      const probe = await page.evaluate(() => {
        const text = document.body.innerText;
        const sample = document.querySelector('[data-action="country"]')?.textContent ?? '';
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        return { sample, overflow, undefinedText: /undefined|\b[a-z]+\.[a-z]+Key\b/.test(text) };
      });
      if (!probe.sample.trim() || probe.overflow > 0 || probe.undefinedText) languageProblems.push({ language, ...probe });
    }
    check('F4 12言語すべて表示できる（横はみ出しなし）', languageProblems.length === 0, languageProblems);
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ language: 'en' }));
    await sleep(200);
    const english = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      tag: document.querySelector('.hero__tag')?.textContent ?? '',
    }));
    check('F5 英語に切り替わる（英語フォールバック）', english.lang === 'en' && /Four choices/.test(english.tag), english);
    await shot(page, 'home-english');
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ language: 'ja', size: 'standard', night: false }));
    await sleep(200);

    /* 狭い画面（320/360）で試合と設定 */
    for (const width of [320, 360]) {
      const narrow = await openPage(browser, { url: server.url, viewport: { width, height: 700 }, dpr: 1 });
      await narrow.page.evaluate(() => { window.__SHOOTOUT__.skipOpening(); window.__SHOOTOUT__.setPrefs({ size: 'extra' }); });
      await sleep(250);
      const homeLayout = await layoutCheck(narrow.page, `home-${width}`);
      await narrow.page.evaluate(() => window.__SHOOTOUT__.startMatch());
      await sleep(900);
      const matchLayout = await layoutCheck(narrow.page, `match-${width}`);
      check(`F6 ${width}px・文字特大でも崩れない`, homeLayout.overflowX <= 0 && matchLayout.overflowX <= 0 && homeLayout.clipped.length === 0, { homeLayout, matchLayout });
      if (width === 320) await shot(narrow.page, 'match-320');
      await narrow.context.close();
    }

    /* ============================================================== *\
     * H. 通信対戦のロビー・ランキング（設定OFFで安全に確認）
     * ============================================================== */
    await page.evaluate(() => { window.SHOOTOUT_ONLINE = { off: true }; window.__SHOOTOUT__.go('online'); });
    await sleep(350);
    const lobby = await page.evaluate(() => ({
      screen: window.__SHOOTOUT__.screen,
      quick: Boolean(document.querySelector('[data-testid="quick-match"]')),
      codeInput: Boolean(document.querySelector('#room-code')),
      scopes: document.querySelectorAll('[data-scope]').length,
      room: window.__SHOOTOUT__.online,
    }));
    check('H1 通信ロビー（クイック・フレンド・国内/世界）', lobby.screen === 'online' && lobby.quick && lobby.codeInput && lobby.scopes === 2, lobby);
    await page.evaluate(() => {
      const input = document.querySelector('#room-code');
      input.value = 'ABC12';
      document.querySelector('[data-action="join-room"]').click();
    });
    await sleep(300);
    const joinStatus = await page.evaluate(() => document.querySelector('.status')?.textContent ?? '');
    check('H2 通信が未設定なら理由を出して止まる（落ちない）', /通信の設定がありません|not configured/i.test(joinStatus), joinStatus);
    await page.evaluate(() => window.__SHOOTOUT__.go('rank'));
    await sleep(300);
    const rank = await page.evaluate(() => ({
      locked: Boolean(document.querySelector('.locked')) || Boolean(document.querySelector('[data-testid="rank-table"]')),
      screen: window.__SHOOTOUT__.screen,
    }));
    check('H3 世界ランキング画面（PRO連動）', rank.screen === 'rank' && rank.locked, rank);

    /* ============================================================== *\
     * G. コンソールエラー 0
     * ============================================================== */
    check('G1 コンソールエラー 0（全画面通し）', errors.length === 0, errors.slice(0, 5));
    await context.close();

    if (mode === 'smoke') return;
  } finally {
    await browser.close();
    await server.close();
  }

  const failed = checks.filter((item) => !item.ok);
  process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
  if (failed.length) {
    process.stdout.write(`failed: ${failed.map((item) => item.name).join(' / ')}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
