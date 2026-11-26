/**
 * SHOOTOUT 4 — 実ブラウザ E2E（Chromium / Playwright） Build 2
 *
 *   node tools/shots-prod.mjs          … 全チェック＋スクリーンショット
 *   node tools/shots-prod.mjs smoke    … 起動確認だけ
 *
 * 確かめること:
 *   A. 日本語起動・オープニング・ホーム・公式エンブレム（アイコン同一）
 *   B. 32か国（無料16 + PRO16・ロック表示）と3Dスタジアム
 *   C. 7秒＋決定・交代のワンクッション・時間切れ=枠外 MISS KICK
 *   D. PK進行（5本＋サドンデス）・結果の ⚽ vs 🧤 表記
 *   E. PRO: 4部位・2種類のキャラクター（切替可）・32か国解放
 *   F. キーパー視点（引いた斜め後ろ）・左右ドラッグ・ターン表示
 *   G. 選手登録（名前・利き足・代表国）とキッカー表示
 *   H. ナイター・文字特大・12言語・幅320/360・下部の見切れ
 *   I. 通信ロビー・ランキング・音のテスト・コンソールエラー0
 *
 * 保存先: ../../downloads/shootout4-prod-*.png
 */

import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

async function openPage(browser, { url, locale = 'ja-JP', viewport = PHONE, dpr = 2 } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    locale,
    timezoneId: 'Asia/Tokyo',
    colorScheme: 'dark',
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
  skin: window.__SHOOTOUT__.skin,
  registration: window.__SHOOTOUT__.registration,
  stadium: window.__SHOOTOUT__.stadium(),
  audio: window.__SHOOTOUT__.audio,
}));

/** 時計を止めた状態で新しい試合を始める（E2E を決定的にする） */
async function startFresh(page, { force = null } = {}) {
  await page.evaluate((forced) => {
    window.__SHOOTOUT_FORCE_CPU__ = forced;
    window.__SHOOTOUT__.startMatch();
    window.__SHOOTOUT__.handover();
    window.__SHOOTOUT__.hold();
  }, force);
  await page.waitForTimeout(350);
}

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

/** 決着まで進める（CPUの方向は固定して検証を決定的にする） */
async function playToEnd(page, { max = 26 } = {}) {
  let guard = 0;
  while (guard < max) {
    guard += 1;
    const info = await page.evaluate(() => window.__SHOOTOUT__.match);
    if (!info || info.winner) return info;
    const round = info.history;
    const dir = round < 10 ? 'TL' : (info.role === 'shoot' ? 'TR' : 'TL');
    await playKick(page, dir);
    await page.evaluate(() => {
      if (window.__SHOOTOUT__.match?.winner) return;
      window.__SHOOTOUT__.handover();
      window.__SHOOTOUT__.next();
    });
    await page.waitForTimeout(140);
  }
  return page.evaluate(() => window.__SHOOTOUT__.match);
}

/** 全画面を順に開いて、横はみ出し・巨大要素を探す */
async function sweepScreens(page, label, screens = ['home', 'country', 'locker', 'register', 'pro', 'online', 'rank', 'stats', 'settings', 'rules', 'privacy']) {
  const problems = [];
  for (const screen of screens) {
    await page.evaluate((name) => window.__SHOOTOUT__.go(name), screen);
    await sleep(150);
    const result = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;
      const wide = [...document.querySelectorAll('main *')]
        .filter((element) => {
          if (!element.getClientRects().length) return false;
          if (element.closest('.strip')) return false; /* 横スクロールは仕様 */
          if (getComputedStyle(element).pointerEvents === 'none') return false;
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
    const clipped = [...document.querySelectorAll('.btn, .zone, .menu__label, .seg, .strip__item')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1);
      })
      .map((element) => element.className);
    return { where, overflowX, clipped: clipped.slice(0, 4) };
  }, label);
}

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

async function main() {
  const mode = process.argv[2] || 'full';
  const chromium = loadChromium();
  const server = await startServer();
  await mkdir(OUT, { recursive: true });

  /* ---------------- アイコン（ファイルとして同一か） ---------------- */
  check(
    'Z1 iOS の AppIcon が公式エンブレム（assets/icon-1024.png と同一）',
    sha(resolve(ROOT, 'assets/icon-1024.png')) === sha(resolve(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')),
  );

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--enable-unsafe-swiftshader'],
    env: { ...process.env, LD_LIBRARY_PATH: `${LIBS}:${process.env.LD_LIBRARY_PATH ?? ''}` },
  });

  try {
    /* ============================================================== *\
     * A. 日本語端末・オープニング・ホーム
     * ============================================================== */
    const probe = await openPage(browser, { url: server.url, dpr: 1, viewport: { width: 360, height: 640 } });
    await probe.page.evaluate(() => { window.__SHOOTOUT__.skipOpening(); window.__SHOOTOUT__.startMatch(); });
    await probe.page.evaluate(() => window.__SHOOTOUT__.handover());
    const probeStart = await probe.page.evaluate(() => window.__SHOOTOUT__.match?.remainingMs ?? 0);
    const probeTick = await probe.page.evaluate(() => window.__SHOOTOUT__.match?.remainingMs ?? 0);
    await probe.page.waitForTimeout(420);
    const probeTick2 = await probe.page.evaluate(() => window.__SHOOTOUT__.match?.remainingMs ?? 0);
    await probe.context.close();
    check('C0 ラウンドは7秒から始まる（交代の後）', probeStart > 5500 && probeStart <= 7000, { probeStart });
    check('C2 7秒のカウントダウンが動く', probeTick > 0 && probeTick2 < probeTick, { probeTick, probeTick2 });

    const { context, page } = await openPage(browser, { url: server.url });
    const opening = await page.evaluate(() => ({
      present: Boolean(document.querySelector('.opening')),
      lang: document.documentElement.lang,
      title: document.querySelector('.opening__sub')?.textContent ?? '',
    }));
    check('A1 日本語端末は日本語で起動', opening.lang === 'ja', opening);
    check('A2 オープニングが出る（3秒・スキップ可）', opening.present && /世界PK選手権/.test(opening.title), opening);
    await page.evaluate(() => window.__SHOOTOUT__.skipOpening());
    await sleep(420);
    const home = await page.evaluate(() => {
      const children = [...document.querySelector('.home').children].map((element) => element.className || element.tagName);
      return {
        gone: !document.querySelector('.opening'),
        tag: document.querySelector('.hero__tag')?.textContent ?? '',
        emblem: document.querySelector('.hero__img')?.complete ?? false,
        children,
        proIndex: children.findIndex((name) => String(name).includes('procard')),
        menuIndex: children.findIndex((name) => String(name).includes('menu-grid')),
        proText: document.querySelector('.procard__body')?.innerText ?? '',
      };
    });
    check('A3 スキップでホームへ・日本語の文言', home.gone && /4択/.test(home.tag), home);
    check('A4 公式エンブレムを読み込み', home.emblem === true);
    check('A5 PRO ボタンは下部（戦績・遊び方・設定の下）', home.proIndex > home.menuIndex && home.menuIndex >= 0, home);
    check('A6 PRO の説明に4部位と世界ランキング', /ユニフォーム・パンツ・靴下・スパイク/.test(home.proText) && /世界ランキング/.test(home.proText), home.proText);
    await shot(page, 'home');

    /* ============================================================== *\
     * G. 選手登録（先に登録して、試合のキッカー表示に反映）
     * ============================================================== */
    await page.evaluate(() => window.__SHOOTOUT__.go('settings'));
    await sleep(250);
    await page.click('[data-testid="settings-register"]');
    await sleep(300);
    const registerScreen = await page.evaluate(() => ({
      screen: window.__SHOOTOUT__.screen,
      inputs: document.querySelectorAll('.screen--register input').length,
      countries: document.querySelectorAll('[data-reg="country"] option').length,
      languages: document.querySelectorAll('[data-reg="language"] option').length,
    }));
    check('G1 設定から公式選手登録を開ける（32か国・12言語）', registerScreen.screen === 'register' && registerScreen.countries === 32 && registerScreen.languages === 12, registerScreen);
    await page.fill('[data-testid="register-user"]', 'トモアキ');
    await page.fill('[data-testid="register-team"]', 'OKINAWA FC');
    await page.selectOption('[data-reg="country"]', 'SN');
    await page.click('[data-foot="left"][data-reg-player="1"]');
    await page.fill('[data-testid="teammate-2"] input', 'タカシ');
    await page.waitForTimeout(150);
    await shot(page, 'register');
    await page.click('[data-testid="save-registration"]');
    await page.waitForTimeout(400);
    const registered = await page.evaluate(() => window.__SHOOTOUT__.registration);
    check('G2 登録が保存される（名前・代表国・利き足・チームメイト）',
      registered.registered && registered.userName === 'トモアキ' && registered.country === 'SN' && registered.foot === 'left'
      && registered.teammates[0].name === 'タカシ', registered);
    await page.evaluate(() => window.__SHOOTOUT__.go('home'));
    await sleep(200);

    /* ============================================================== *\
     * B. 国えらび（32か国・無料16 + PRO16）
     * ============================================================== */
    await page.click('button[data-action="country"]');
    await sleep(320);
    const countries = await page.evaluate(() => ({
      total: document.querySelectorAll('[data-mycountry]').length,
      locked: document.querySelectorAll('.strip__item.is-locked').length,
      free: window.__SHOOTOUT__.freeCountries.length,
      pro: window.__SHOOTOUT__.proCountries.length,
      extra: document.querySelector('.country__note')?.innerText ?? '',
    }));
    check('B1 32か国（無料16 + 16はPROロック）', countries.total === 32 && countries.locked === 32 && countries.free === 16 && countries.pro === 16, countries);
    /* PRO の16か国（ロック表示）が見える位置までスクロールして撮る */
    await page.evaluate(() => {
      document.querySelectorAll('.strip').forEach((strip) => { strip.scrollLeft = strip.scrollWidth; });
    });
    await page.waitForTimeout(2200); /* 登録トーストが消えてから撮る */
    await shot(page, 'country');

    /* 下部の注記が見切れない（特大文字） */
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ size: 'extra' }));
    await page.evaluate(() => window.__SHOOTOUT__.go('country'));
    await sleep(300);
    const note = await page.evaluate(() => {
      const body = document.querySelector('.screen__body');
      body.scrollTop = body.scrollHeight;
      const noteElement = document.querySelector('.country__note');
      const last = noteElement?.querySelector('.mini:last-child');
      const noteRect = noteElement?.getBoundingClientRect();
      const bodyRect = body?.getBoundingClientRect();
      return {
        bottom: noteRect ? Math.round(noteRect.bottom) : null,
        bodyBottom: bodyRect ? Math.round(bodyRect.bottom) : null,
        clipped: last ? last.scrollHeight > last.clientHeight + 1 : true,
        text: last?.textContent?.slice(-30) ?? '',
      };
    });
    check('B2 国えらび下部の注記が特大文字でも見切れない', note.bottom != null && note.bottom <= note.bodyBottom + 2 && note.clipped === false, note);
    await page.waitForTimeout(2200); /* トーストが消えてから撮る */
    await shot(page, 'country-extra');
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ size: 'standard' }));
    await page.evaluate(() => window.__SHOOTOUT__.go('country'));
    await sleep(200);
    await page.click('button[data-opponent="BR"]');
    await page.click('button[data-level="elite"]');
    await sleep(200);
    /* 交代のワンクッションは一瞬で消えることがあるので、出た瞬間を記録しておく */
    await page.evaluate(() => {
      window.__HANDOVERS__ = [];
      new MutationObserver(() => {
        const overlay = document.querySelector('#handover');
        if (overlay && !overlay.hidden) {
          window.__HANDOVERS__.push({
            title: overlay.querySelector('#handover-title')?.textContent ?? '',
            hint: overlay.querySelector('#handover-hint')?.textContent ?? '',
          });
        }
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    await page.click('[data-testid="kickoff"]');
    await page.waitForSelector('#scene', { timeout: 8000 });
    await page.waitForFunction(() => window.__SHOOTOUT__.match?.handover === false, null, { timeout: 8000 }).catch(() => {});
    const handovers = await page.evaluate(() => window.__HANDOVERS__);
    const firstHandover = handovers[0] || {};
    check('C1 開始時に説明付きのワンクッション', /あなたの番/.test(firstHandover.title || '') && (firstHandover.hint || '').length > 0, handovers.slice(0, 2));
    await page.evaluate(() => { window.__SHOOTOUT__.handover(); window.__SHOOTOUT__.hold(); window.__SHOOTOUT__.previewHandover('keep'); });
    await sleep(150);
    await shot(page, 'handover');
    await page.evaluate(() => window.__SHOOTOUT__.handover());

    /* 時計が止まる前に時間切れしていたら、やり直して蹴る番から検証する */
    let firstMatch = await state(page);
    if (firstMatch.match?.role !== 'shoot') {
      await startFresh(page, { force: null });
      firstMatch = await state(page);
    }
    check('B3 3Dスタジアムが描画される（観客2600人・キッカー5人）',
      firstMatch.stadium.available === true && firstMatch.stadium.crowd > 2000 && firstMatch.stadium.kickers === 5, firstMatch.stadium);
    check('B4 無料はブロック型キャラクター', firstMatch.stadium.style === 'voxel', firstMatch.stadium);
    const turn = await page.evaluate(() => ({
      text: document.querySelector('[data-testid="role"] .turn__text')?.textContent ?? '',
      role: document.querySelector('[data-testid="role"]')?.dataset.role ?? '',
      size: parseFloat(getComputedStyle(document.querySelector('[data-testid="role"] .turn__text')).fontSize),
    }));
    check('C3 ターン表示が大きく「あなたの番：シュート」', turn.role === 'shoot' && /あなたの番：シュート/.test(turn.text) && turn.size >= 13, turn);
    const chip = await page.evaluate(() => document.querySelector('#kicker-chip')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    check('G3 キッカー表示に選手名と利き足（左）', /トモアキ/.test(chip) && /左足/.test(chip), chip);
    check('B5 試合画面に4択と決定ボタン', await page.evaluate(() => document.querySelectorAll('.zone').length === 4 && Boolean(document.querySelector('#confirm'))));
    check('B6 決定は未選択では押せない', await page.evaluate(() => document.querySelector('#confirm').disabled === true));
    await page.evaluate(() => window.__SHOOTOUT__.hold());
    await sleep(120);
    await shot(page, 'match-day');

    /* ============================================================== *\
     * C. 決定 → 即結果 / 時間切れ=MISS KICK
     * ============================================================== */
    await page.click('[data-testid="zone-TL"]');
    check('C4 方向を選ぶと決定が押せる', await page.evaluate(() => document.querySelector('#confirm').disabled === false));
    await page.evaluate(() => window.__SHOOTOUT__.confirmKick());
    await page.waitForFunction(() => window.__SHOOTOUT__.match?.history >= 1, null, { timeout: 10000 });
    await page.evaluate(() => window.__SHOOTOUT__.hold());
    await page.waitForSelector('#banner:not([hidden])', { timeout: 6000 }).catch(() => {});
    await sleep(200);
    const afterKick = await page.evaluate(() => ({
      banner: document.querySelector('#banner')?.textContent ?? '',
      cells: document.querySelectorAll('[data-testid="pk-me"] .pkcell.is-goal, [data-testid="pk-me"] .pkcell.is-miss').length,
    }));
    check('C5 決定した瞬間に結果が出る', afterKick.cells === 1 && ['ゴール！', 'セーブ！'].includes(afterKick.banner), afterKick);
    await shot(page, 'result-anim');

    /* 交代（キーパーへ） */
    await page.evaluate(() => { window.__HANDOVERS__ = []; window.__SHOOTOUT__.next(); });
    await page.waitForFunction(() => window.__SHOOTOUT__.match?.role === 'keep', null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(160);
    const swap = await page.evaluate(() => ({
      last: window.__SHOOTOUT__.match?.lastHandover,
      seen: window.__HANDOVERS__,
    }));
    check('C6 キッカー→キーパーの交代を説明する',
      /交代/.test(swap.last?.title || '') && swap.last?.role === 'keep', swap);
    await page.evaluate(() => { window.__SHOOTOUT__.handover(); window.__SHOOTOUT__.hold(); });
    await page.waitForTimeout(150);

    /* キーパーの駆け引き（左右ドラッグ） */
    const keeperInfo = await state(page);
    check('F1 キーパー視点はゴール全体が見える引いた斜め後ろ', keeperInfo.match.role === 'keep'
      && keeperInfo.stadium.role === 'keep' && keeperInfo.stadium.keeperDistance > 8 && keeperInfo.stadium.camera[2] < -18, keeperInfo.stadium);
    const zoneBox = await page.locator('[data-testid="keeper-zone"]').boundingBox();
    const hintVisible = await page.evaluate(() => {
      const hint = document.querySelector('.keeper-zone__hint');
      return Boolean(hint && hint.getClientRects().length);
    });
    if (zoneBox) {
      await page.mouse.move(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(zoneBox.x + zoneBox.width * 0.85, zoneBox.y + zoneBox.height / 2, { steps: 4 });
      await page.mouse.up();
    }
    const dragged = await page.evaluate(() => window.__SHOOTOUT__.stadium());
    check('F2 キーパーを左右にドラッグできる（駆け引き）', hintVisible && Math.abs(dragged.keeperOffset) > 0.05 && Math.abs(dragged.keeper[0]) > 0.3, { hintVisible, keeper: dragged.keeper, offset: dragged.keeperOffset });
    await shot(page, 'keeper');
    await playKick(page, 'BR'); /* キーパーとして飛ぶ */
    /* 蹴る番で時間切れ → 枠外 MISS KICK（蹴る番になるまで進める） */
    for (let guard = 0; guard < 3; guard += 1) {
      await page.evaluate(() => { window.__SHOOTOUT__.handover(); window.__SHOOTOUT__.next(); });
      await page.waitForTimeout(180);
      await page.evaluate(() => { window.__SHOOTOUT__.handover(); window.__SHOOTOUT__.hold(); });
      const info = await page.evaluate(() => window.__SHOOTOUT__.match);
      if (!info || info.role === 'shoot') break;
      await playKick(page, 'TL');
    }
    const timeoutNow = await page.evaluate(() => {
      window.__SHOOTOUT__.timeoutNow();
      return {
        event: window.__SHOOTOUT__.match?.lastEvent,
        status: document.querySelector('#kick-status')?.textContent ?? '',
      };
    });
    await page.waitForTimeout(1000);
    const timeoutResult = await page.evaluate(() => ({
      event: window.__SHOOTOUT__.match?.lastEvent,
      banner: document.querySelector('#banner')?.textContent ?? '',
    }));
    check('C7 時間切れは枠外（MISS KICK 😭💦）',
      timeoutNow.event?.miss === true && /時間切れ/.test(timeoutNow.status) && /MISS KICK/.test(timeoutResult.banner),
      { ...timeoutNow, banner: timeoutResult.banner });
    await shot(page, 'miss-kick');

    /* ============================================================== *\
     * D. PK進行（5本＋サドンデス）と結果表記
     * ============================================================== */
    await page.evaluate(() => {
      window.__SHOOTOUT_FORCE_CPU__ = ['TL'];
      window.__SHOOTOUT__.startMatch();
      window.__SHOOTOUT__.handover();
    });
    await sleep(500);
    const result = await playToEnd(page, { max: 30 });
    check('D1 決着まで進む（5本＋サドンデス）', Boolean(result && result.winner), result && { winner: result.winner, kicks: result.kicks });
    check('D2 6本目以降のサドンデスに到達', (result?.kicks?.me?.length ?? 0) >= 6 || (result?.kicks?.opp?.length ?? 0) >= 6, result?.kicks);
    await page.waitForFunction(() => window.__SHOOTOUT__.screen === 'result', null, { timeout: 10000 }).catch(() => {});
    await sleep(320);
    const resultView = await page.evaluate(() => ({
      screen: window.__SHOOTOUT__.screen,
      title: document.querySelector('[data-testid="result-title"]')?.textContent ?? '',
      score: document.querySelector('[data-testid="result-score"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      cells: document.querySelectorAll('.pkcell').length,
      logRows: document.querySelectorAll('.kicklog__row').length,
      shot: document.querySelector('[data-testid="kicklog-shot-0"]')?.textContent?.trim() ?? '',
      save: document.querySelector('[data-testid="kicklog-save-0"]')?.textContent?.trim() ?? '',
      who: document.querySelector('.kicklog__who')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    }));
    check('D3 結果画面（勝敗・最終スコア・PK表）', resultView.screen === 'result' && /勝利|敗北/.test(resultView.title) && resultView.cells >= 12, resultView);
    check('D4 結果の展開表記が ⚽ vs 🧤 で分かる', /⚽/.test(resultView.shot) && /🧤/.test(resultView.save) && resultView.logRows >= 10, resultView);
    check('D5 結果にキッカー名と利き足が出る', /トモアキ|タカシ|Player/.test(resultView.who) && /足/.test(resultView.who), resultView.who);
    await shot(page, 'result');
    const record = await page.evaluate(() => window.__SHOOTOUT__.record);
    check('D6 戦績が保存される', record.played >= 1 && record.wins + record.losses === record.played, record);

    /* ============================================================== *\
     * E. PRO: 4部位・2種キャラ・32か国
     * ============================================================== */
    await page.evaluate(() => window.__SHOOTOUT__.go('home'));
    await sleep(250);
    const beforePro = await page.evaluate(() => window.__SHOOTOUT__.entitled);
    await page.click('button[data-action="locker"]');
    await sleep(300);
    const lockerMeta = await page.evaluate(() => ({
      parts: ['shirt', 'shorts', 'socks', 'boots'].filter((part) => document.querySelector(`[data-testid="locker-${part}"]`)),
      characters: document.querySelectorAll('[data-character]').length,
      stylizedLocked: document.querySelector('[data-character="stylized"]')?.classList.contains('is-locked') ?? null,
    }));
    check('E1 ロッカーに4部位とキャラクター2種（1️⃣はPROロック）', lockerMeta.parts.length === 4 && lockerMeta.characters === 2 && lockerMeta.stylizedLocked === true, lockerMeta);
    await shot(page, 'locker-locked');
    await page.click('[data-action="pro"]');
    await sleep(300);
    await shot(page, 'pro');
    await page.click('[data-testid="pro-buy"]');
    await sleep(700);
    const afterPro = await page.evaluate(() => window.__SHOOTOUT__.entitled);
    check('E2 PRO（プレビューのテスト解錠）が入る', beforePro === false && afterPro === true, { beforePro, afterPro });

    await page.evaluate(() => window.__SHOOTOUT__.go('locker'));
    await sleep(280);
    const unlockedMeta = await page.evaluate(() => ({
      lockedTiles: document.querySelectorAll('.tile.is-locked').length,
      stylizedLocked: document.querySelector('[data-character="stylized"]')?.classList.contains('is-locked') ?? null,
    }));
    check('E3 PRO で4部位すべてと1️⃣が解放', unlockedMeta.lockedTiles === 0 && unlockedMeta.stylizedLocked === false, unlockedMeta);
    await page.click('[data-character="stylized"]');
    await sleep(180);
    await page.click('[data-testid="shirt-royal-stripe"]');
    await sleep(120);
    await page.click('[data-testid="shorts-red-shorts"]');
    await sleep(120);
    await page.click('[data-testid="socks-gold-socks"]');
    await sleep(120);
    await page.click('[data-testid="boots-speed-gold"]');
    await sleep(200);
    await shot(page, 'locker');
    await page.click('[data-testid="save-skin"]');
    await sleep(320);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('shootout4.skin.v2') || '{}'));
    check('E4 キャラクターと4部位を保存', saved.character === 'stylized' && saved.shirt === 'royal-stripe'
      && saved.shorts === 'red-shorts' && saved.socks === 'gold-socks' && saved.boots === 'speed-gold', saved);
    await page.evaluate(() => {
      window.__SHOOTOUT_FORCE_CPU__ = ['BR'];
      window.__SHOOTOUT__.startMatch();
      window.__SHOOTOUT__.handover();
    });
    await sleep(900);
    const staged = await state(page);
    check('E5 選んだ4部位と1️⃣が3Dの試合に反映', staged.stadium.style === 'stylized'
      && staged.stadium.skin.shirt === 'royal-stripe' && staged.stadium.skin.shorts === 'red-shorts'
      && staged.stadium.skin.socks === 'gold-socks' && staged.stadium.skin.boots === 'speed-gold', staged.stadium);
    await shot(page, 'match-kit');

    /* 1️⃣ ⇄ 3️⃣ をいつでも切り替えられる */
    await page.evaluate(() => { window.__SHOOTOUT__.go('locker'); });
    await sleep(250);
    await page.click('[data-character="voxel"]');
    await sleep(150);
    await page.click('[data-testid="save-skin"]');
    await sleep(250);
    await page.evaluate(() => {
      window.__SHOOTOUT_FORCE_CPU__ = ['BR'];
      window.__SHOOTOUT__.startMatch();
      window.__SHOOTOUT__.handover();
    });
    await sleep(700);
    const backToVoxel = await state(page);
    check('E6 PRO でも3️⃣ブロック型へいつでも戻せる', backToVoxel.stadium.style === 'voxel', backToVoxel.stadium);

    /* ゴール演出（CPUの方向を固定して必ずゴールにする） */
    await startFresh(page, { force: ['BR'] });
    await page.evaluate(() => {
      window.__SHOOTOUT__.selectDirection('TL');
      window.__SHOOTOUT__.confirmKick();
    });
    await page.waitForFunction(() => (window.__SHOOTOUT__.match?.history ?? 0) >= 1, null, { timeout: 12000 });
    await page.waitForTimeout(420);
    const anim = await page.evaluate(() => ({
      confetti: window.__SHOOTOUT__.stadium().confetti,
      net: window.__SHOOTOUT__.stadium().netEnergy,
    }));
    check('E7 ゴール時にネットが揺れ紙吹雪が出る', anim.confetti === true || anim.net > 0, anim);
    await shot(page, 'goal');

    /* 32か国すべて選べる */
    await page.evaluate(() => window.__SHOOTOUT__.go('country'));
    await sleep(300);
    const allCountries = await page.evaluate(() => ({
      total: document.querySelectorAll('[data-mycountry]').length,
      locked: document.querySelectorAll('.strip__item.is-locked').length,
    }));
    check('E8 PRO で32か国すべて選べる（ロック0）', allCountries.total === 32 && allCountries.locked === 0, allCountries);

    /* ============================================================== *\
     * F. ナイター・文字特大・12言語・狭い幅
     * ============================================================== */
    await page.evaluate(() => { window.__SHOOTOUT_FORCE_CPU__ = null; });
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ night: true, size: 'extra' }));
    await page.evaluate(() => {
      window.__SHOOTOUT__.startMatch();
      window.__SHOOTOUT__.handover();
    });
    await sleep(900);
    const night = await state(page);
    check('F3 ナイターに切り替わる', night.stadium.night === true, night.stadium);
    check('F4 文字特大でも横にはみ出さない（試合）', (await layoutCheck(page, 'match-extra')).overflowX <= 0, await layoutCheck(page, 'match-extra'));
    await shot(page, 'match-night-extra');
    await page.evaluate(() => window.__SHOOTOUT__.go('home'));
    await sleep(300);
    const extraHome = await layoutCheck(page, 'home-extra');
    check('F5 文字特大でも横にはみ出さない（ホーム）', extraHome.overflowX <= 0 && extraHome.clipped.length === 0, extraHome);
    await shot(page, 'home-extra');
    const sweepExtra = await sweepScreens(page, 'extra');
    check('F5b 全画面（特大）ではみ出し・巨大アイコンなし', sweepExtra.problems.length === 0, sweepExtra.problems);
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ size: 'standard' }));
    await sleep(200);
    const sweepStandard = await sweepScreens(page, 'standard');
    check('F5c 全画面（標準）ではみ出し・巨大アイコンなし', sweepStandard.problems.length === 0, sweepStandard.problems);

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
        return {
          sample: document.querySelector('[data-action="country"]')?.textContent ?? '',
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          undefinedText: /undefined|\b[a-z]+\.[a-z]+Key\b/.test(text),
        };
      });
      if (!probe.sample.trim() || probe.overflow > 0 || probe.undefinedText) languageProblems.push({ language, ...probe });
    }
    check('F6 12言語すべて表示できる（横はみ出しなし）', languageProblems.length === 0, languageProblems);
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ language: 'en' }));
    await sleep(200);
    const english = await page.evaluate(() => ({ lang: document.documentElement.lang, tag: document.querySelector('.hero__tag')?.textContent ?? '' }));
    check('F7 英語に切り替わる（英語フォールバック）', english.lang === 'en' && /Four choices/.test(english.tag), english);
    await shot(page, 'home-english');
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ language: 'ja', size: 'standard', night: false }));
    await sleep(200);

    for (const width of [320, 360]) {
      const narrow = await openPage(browser, { url: server.url, viewport: { width, height: 700 }, dpr: 1 });
      await narrow.page.evaluate(() => { window.__SHOOTOUT__.skipOpening(); window.__SHOOTOUT__.setPrefs({ size: 'extra' }); });
      await sleep(250);
      const homeLayout = await layoutCheck(narrow.page, `home-${width}`);
      await narrow.page.evaluate(() => { window.__SHOOTOUT__.startMatch(); window.__SHOOTOUT__.handover(); });
      await sleep(900);
      const matchLayout = await layoutCheck(narrow.page, `match-${width}`);
      check(`F8 ${width}px・文字特大でも崩れない`, homeLayout.overflowX <= 0 && matchLayout.overflowX <= 0 && homeLayout.clipped.length === 0, { homeLayout, matchLayout });
      if (width === 320) await shot(narrow.page, 'match-320');
      await narrow.context.close();
    }

    /* ============================================================== *\
     * H. 音のテスト・通信ロビー・ランキング
     * ============================================================== */
    await page.evaluate(() => window.__SHOOTOUT__.go('settings'));
    await sleep(250);
    const soundButton = await page.locator('[data-testid="sound-test"]').count();
    if (soundButton) {
      await page.click('[data-testid="sound-test"]');
      await page.waitForTimeout(350);
    }
    const audio = await page.evaluate(() => ({ audio: window.__SHOOTOUT__.audio, toast: document.querySelector('#toast')?.textContent ?? '' }));
    check('H1 設定に「音をテスト」があり、AudioContext が起きる', soundButton === 1 && audio.audio.context !== 'none' && /音/.test(audio.toast), audio);

    /* 世界戦は登録した代表国（セネガル） */
    await page.evaluate(() => { window.SHOOTOUT_ONLINE = { off: true }; window.__SHOOTOUT__.go('online'); });
    await sleep(350);
    const lobby = await page.evaluate(() => ({
      screen: window.__SHOOTOUT__.screen,
      quick: Boolean(document.querySelector('[data-testid="quick-match"]')),
      codeInput: Boolean(document.querySelector('#room-code')),
      scopes: document.querySelectorAll('[data-scope]').length,
      nation: document.querySelector('.online__nation')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    }));
    check('H2 通信ロビー（クイック・フレンド・国内/世界）', lobby.screen === 'online' && lobby.quick && lobby.codeInput && lobby.scopes === 2, lobby);
    check('H3 公式戦は登録した代表国（セネガル）', /セネガル/.test(lobby.nation), lobby.nation);
    await page.evaluate(() => {
      const input = document.querySelector('#room-code');
      input.value = 'ABC12';
      document.querySelector('[data-action="join-room"]').click();
    });
    await sleep(300);
    const joinStatus = await page.evaluate(() => document.querySelector('.status')?.textContent ?? '');
    check('H4 通信が未設定なら理由を出して止まる（落ちない）', /通信の設定がありません|not configured/i.test(joinStatus), joinStatus);
    await page.evaluate(() => window.__SHOOTOUT__.go('rank'));
    await sleep(300);
    const rank = await page.evaluate(() => ({
      locked: Boolean(document.querySelector('.locked')) || Boolean(document.querySelector('[data-testid="rank-table"]')),
      screen: window.__SHOOTOUT__.screen,
    }));
    check('H5 世界ランキング画面（PRO連動）', rank.screen === 'rank' && rank.locked, rank);

    /* ============================================================== *\
     * I. コンソールエラー 0
     * ============================================================== */
    check('I1 コンソールエラー 0（全画面通し）', errors.length === 0, errors.slice(0, 5));
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
