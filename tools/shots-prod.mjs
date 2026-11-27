/**
 * SHOOTOUT 4 — 実ブラウザ E2E（Chromium / Playwright） Build 6
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
    /* 画面遷移や再読み込みで打ち切られた要求はエラー扱いにしない */
    const reason = request.failure()?.errorText ?? '';
    if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(reason)) return;
    if (!target.includes('favicon') && !target.includes('supabase.co')) errors.push(`requestfailed: ${target} ${reason}`);
  });
  await page.goto(`${url}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__SHOOTOUT_READY__ === true, null, { timeout: 20000 });
  return { context, page };
}

/* スクショは検証の合否に使わない（SHOOTOUT_E2E_NO_SHOTS=1 で省いて時間を短くできる） */
const CAPTURE = process.env.SHOOTOUT_E2E_NO_SHOTS !== '1';

async function shot(page, name) {
  if (!CAPTURE) return;
  await page.screenshot({ path: resolve(OUT, `shootout4-prod-${name}.png`) });
  process.stdout.write(`    → downloads/shootout4-prod-${name}.png\n`);
}

/** Build 3 の代表スクショ（downloads/shootout4-b3-*.png） */
async function b3shot(page, name) {
  if (!CAPTURE) return;
  await page.screenshot({ path: resolve(OUT, `shootout4-b3-${name}.png`) });
  process.stdout.write(`    → downloads/shootout4-b3-${name}.png\n`);
}

/** Build 4 の代表スクショ（downloads/shootout4-b4-*.png） */
async function b4shot(page, name) {
  if (!CAPTURE) return;
  await page.screenshot({ path: resolve(OUT, `shootout4-b4-${name}.png`) });
  process.stdout.write(`    → downloads/shootout4-b4-${name}.png\n`);
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
    let dir;
    if (info.role === 'shoot') {
      dir = round < 10 ? 'TL' : 'TR';
    } else {
      /* キーパーはキッカーと向かい合う（画面の左右が反対）。CPU のコース（TL）へ
         飛ぶには、画面では右上（TR）を押す。 */
      dir = 'TR';
    }
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

/** Build 7 の確認（キーパーの左右・スタンプ／定型文・時間切れ）。`node tools/shots-prod.mjs build7` でも単体で走る。 */
async function buildSeven(page) {

    /* ============================================================== *\
     * M. Build 7（キーパーの左右の向き・スタンプ／定型文・時間切れの扱い）
     * ============================================================== */
    await page.evaluate(() => {
      window.__SHOOTOUT__.setPrefs({ language: 'ja', size: 'standard', night: false });
      window.__SHOOTOUT_FORCE_CPU__ = ['TL'];
      window.__SHOOTOUT__.startMatch();
      window.__SHOOTOUT__.handover();
      window.__SHOOTOUT__.hold();
    });
    await sleep(900);

    /* M1 スタンプボタンの場所（PK表の右・上部・押しやすい） */
    const emoteSlot = await page.evaluate(() => {
      const button = document.querySelector('[data-testid="emote-toggle"]');
      const board = document.querySelector('.pkboard');
      const row = document.querySelector('[data-testid="pk-row-me"]');
      const hud = document.querySelector('.hud');
      const stage = document.querySelector('#stage');
      if (!button || !board || !row) return { found: false };
      const b = button.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const s = board.getBoundingClientRect();
      const h = hud?.getBoundingClientRect();
      const st = stage?.getBoundingClientRect();
      return {
        found: true,
        width: Math.round(b.width),
        height: Math.round(b.height),
        rightOfCells: b.left >= r.right - 1,
        insideBoard: b.right <= s.right + 1 && b.top >= s.top - 1 && b.bottom <= s.bottom + 1,
        belowHud: !h || b.top >= h.bottom - 2,
        aboveStage: !st || b.bottom <= st.top + 2,
        inViewport: b.right <= window.innerWidth + 1 && b.left >= -1,
        noOverlapWithCells: !(b.left < r.right - 1 && b.top < r.bottom - 1 && b.bottom > r.top + 1),
      };
    });
    check('M1 プレイ中画面のPK表の右（上部）にスタンプボタン（40px・表と重ならない）',
      emoteSlot.found && emoteSlot.width >= 36 && emoteSlot.height >= 36 && emoteSlot.rightOfCells
      && emoteSlot.insideBoard && emoteSlot.belowHud && emoteSlot.aboveStage && emoteSlot.inViewport
      && emoteSlot.noOverlapWithCells, emoteSlot);
    await shot(page, 'b7-emote-button');

    /* M2 トレイ（スタンプ8・駆け引き4・リアクション4） */
    await page.click('[data-testid="emote-toggle"]');
    await sleep(220);
    const trayInfo = await page.evaluate(() => {
      const tray = document.querySelector('[data-testid="emote-tray"]');
      const button = document.querySelector('[data-testid="emote-toggle"]');
      if (!tray) return { open: false };
      const box = tray.getBoundingClientRect();
      return {
        open: !tray.hidden,
        expanded: button?.getAttribute('aria-expanded') === 'true',
        pills: tray.querySelectorAll('.emotepill').length,
        stamps: tray.querySelectorAll('[data-kind="stamp"] .emotepill').length,
        taunts: tray.querySelectorAll('[data-kind="taunt"] .emotepill').length,
        reacts: tray.querySelectorAll('[data-kind="react"] .emotepill').length,
        ids: [...tray.querySelectorAll('.emotepill')].map((pill) => pill.dataset.emote),
        inside: box.left >= -1 && box.right <= window.innerWidth + 1 && box.top >= -1 && box.bottom <= window.innerHeight + 1,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        texts: [...tray.querySelectorAll('.emotepill__text')].map((element) => element.textContent.trim()),
      };
    });
    check('M2 トレイが開き、スタンプ8・駆け引き4・リアクション4（12言語の文言・画面内）',
      trayInfo.open && trayInfo.expanded && trayInfo.pills === 16 && trayInfo.stamps === 8
      && trayInfo.taunts === 4 && trayInfo.reacts === 4 && trayInfo.inside && trayInfo.overflow <= 0
      && trayInfo.texts.every((text) => text.length > 0 && !text.startsWith('emote_')), trayInfo);
    check('M2b 駆け引きとリアクションの定型文（トモアキさん指定の文言）',
      ['左に蹴るよ？', '右に蹴るかも…', '真ん中はないよ', '読めてるよ！', 'ナイスゴール👍', 'やられた⚽️💦', 'ナイスセーブ🧤', 'ドンマイ！']
        .every((text) => trayInfo.texts.includes(text)), trayInfo.texts);
    await shot(page, 'b7-emote-tray');

    /* M3 押すと吹き出しが出て、トレイが閉じる */
    await page.click('[data-testid="emote-taunt_left"]');
    await sleep(260);
    const ownBubble = await page.evaluate(() => {
      const bubble = document.querySelector('[data-testid="emote-bubble"]');
      const box = bubble?.getBoundingClientRect();
      const stage = document.querySelector('#stage')?.getBoundingClientRect();
      return {
        visible: Boolean(bubble && !bubble.hidden && bubble.getClientRects().length),
        text: bubble?.querySelector('.emotebubble__text')?.textContent?.trim() ?? '',
        face: bubble?.querySelector('.emotebubble__face')?.textContent?.trim() ?? '',
        who: bubble?.querySelector('.emotebubble__who')?.textContent?.trim() ?? '',
        mine: bubble?.dataset.mine ?? '',
        trayClosed: document.querySelector('[data-testid="emote-tray"]')?.hidden === true,
        insideStage: Boolean(box && stage && box.left >= stage.left - 1 && box.right <= stage.right + 1
          && box.top >= stage.top - 1 && box.bottom <= stage.bottom + 1),
        upperArea: Boolean(box && stage && box.top < stage.top + stage.height * 0.45),
        opacity: Number(getComputedStyle(bubble).opacity),
        last: window.__SHOOTOUT__.lastEmote,
      };
    });
    check('M3 スタンプを押すと自分の吹き出しが試合画面の上部に出る（トレイは閉じる・相手の邪魔をしない位置）',
      ownBubble.visible && ownBubble.text === '左に蹴るよ？' && ownBubble.face === '👈' && ownBubble.mine === 'true'
      && ownBubble.trayClosed && ownBubble.insideStage && ownBubble.upperArea && ownBubble.opacity > 0.3
      && ownBubble.last?.id === 'taunt_left', ownBubble);
    /* スクショ用に吹き出しを出したまま撮る（自動で消えるのは次の M3b で確認） */
    await page.evaluate(() => window.__SHOOTOUT__.emote('taunt_left', true));
    await shot(page, 'b7-emote-bubble');
    /* M3b 数秒で消える */
    const bubbleGone = await (async () => {
      await page.evaluate(() => window.__SHOOTOUT__.emote('nice'));
      await sleep(3200);
      return page.evaluate(() => {
        const bubble = document.querySelector('[data-testid="emote-bubble"]');
        return { hidden: bubble?.hidden === true, visible: Boolean(bubble?.getClientRects().length) };
      });
    })();
    check('M3b 吹き出しは数秒（2.6秒）で消える', bubbleGone.hidden && !bubbleGone.visible, bubbleGone);

    /* M4 新しいものが来たら差し替わる（受信も同じ吹き出し） */
    const replaced = await page.evaluate(() => {
      const before = window.__SHOOTOUT__.lastEmote?.text ?? '';
      const shown = window.__SHOOTOUT__.emote('nice_save');
      const bubble = document.querySelector('[data-testid="emote-bubble"]');
      return {
        before,
        shown,
        text: bubble?.querySelector('.emotebubble__text')?.textContent?.trim() ?? '',
        face: bubble?.querySelector('.emotebubble__face')?.textContent?.trim() ?? '',
        visible: Boolean(bubble && !bubble.hidden),
      };
    });
    check('M4 次のスタンプで差し替わる（新しいものが優先）',
      replaced.visible && replaced.text === 'ナイスセーブ🧤' && replaced.face === '🧤'
      && replaced.before !== replaced.text, replaced);

    /* M5 CPU からのリアクション（CPU 戦でも押せて、返ってくる） */
    const cpuEmotes = await page.evaluate(() => ({
      conceded: window.__SHOOTOUT__.cpuEmote('conceded'),
      cpuGoal: window.__SHOOTOUT__.cpuEmote('cpuGoal'),
      ids: window.__SHOOTOUT__.emoteIds(),
      sections: window.__SHOOTOUT__.emoteSections(),
      shown: (() => {
        window.__SHOOTOUT__.emote('no_problem');
        const bubble = document.querySelector('[data-testid="emote-bubble"]');
        return {
          text: bubble?.textContent ?? '',
          who: bubble?.querySelector('.emotebubble__who')?.textContent?.trim() ?? '',
        };
      })(),
    }));
    check('M5 CPU 戦でも押せて、CPU からもリアクションが返る（16種・3区分）',
      cpuEmotes.ids.length === 16 && cpuEmotes.sections.length === 3
      && cpuEmotes.ids.includes(cpuEmotes.conceded) && cpuEmotes.ids.includes(cpuEmotes.cpuGoal)
      && /ドンマイ！/.test(cpuEmotes.shown.text) && cpuEmotes.shown.who.length > 0, cpuEmotes);

    /* M6 文字特大でもトレイが崩れない（長い言語・文字特大を実際に描く） */
    const emoteLanguageProblems = [];
    for (const [language, size] of [['ja', 'extra'], ['th', 'standard']]) {
      await page.evaluate(({ tag, scale }) => {
        window.__SHOOTOUT__.setPrefs({ language: tag, size: scale });
      }, { tag: language, scale: size });
      await sleep(140);
      await page.evaluate(() => { window.__SHOOTOUT__.handover(); window.__SHOOTOUT__.hold(); });
      await page.click('[data-testid="emote-toggle"]');
      await sleep(180);
      const info = await page.evaluate(() => {
        const tray = document.querySelector('[data-testid="emote-tray"]');
        const box = tray?.getBoundingClientRect();
        const texts = [...(tray?.querySelectorAll('.emotepill__text') ?? [])].map((element) => element.textContent.trim());
        return {
          pills: texts.length,
          empty: texts.filter((text) => !text || /^emote_|^stamp_/.test(text)).length,
          clipped: [...(tray?.querySelectorAll('.emotepill') ?? [])].filter((pill) => {
            const rect = pill.getBoundingClientRect();
            return rect.width > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1);
          }).length,
          insideX: Boolean(box && box.left >= -1 && box.right <= window.innerWidth + 1),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          size: document.documentElement.dataset.size,
          sample: texts[0] ?? '',
        };
      });
      if (info.pills !== 16 || info.empty || info.clipped || !info.insideX || info.overflow > 0) {
        emoteLanguageProblems.push({ language, ...info });
      }
      await page.click('[data-testid="emote-toggle"]');
      await sleep(90);
    }
    /* 12言語すべてに文言がある（キー名が出ない。画面は描き直さずに辞書だけ引く） */
    const emoteLanguageTexts = await page.evaluate(() => {
      const languages = window.__SHOOTOUT__.languages;
      const table = {};
      for (const language of languages) {
        table[language] = window.__SHOOTOUT__.emoteTexts(language).map((item) => item.text);
      }
      return table;
    });
    const emoteTextProblems = Object.entries(emoteLanguageTexts)
      .filter(([, texts]) => texts.length !== 16 || texts.some((text) => !text || /^emote_|^stamp_/.test(text)));
    check('M6 12言語すべてにスタンプ・定型文の文言があり、文字特大でもトレイが崩れない',
      emoteLanguageProblems.length === 0 && emoteTextProblems.length === 0,
      { layout: emoteLanguageProblems, texts: emoteTextProblems.map(([language]) => language) });
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ language: 'ja', size: 'standard' }));
    await sleep(160);

    /* M7 キーパーの左右: 指を右へ → キーパーも画面の右へ */
    await page.evaluate(() => { window.__SHOOTOUT__.handover(); window.__SHOOTOUT__.hold(); });
    let keeperReady = await page.evaluate(() => window.__SHOOTOUT__.match);
    for (let guard = 0; guard < 4 && keeperReady && keeperReady.role !== 'keep' && !keeperReady.winner; guard += 1) {
      await playKick(page, 'TL');
      await page.evaluate(() => {
        window.__SHOOTOUT__.handover();
        window.__SHOOTOUT__.next();
        window.__SHOOTOUT__.handover();
        window.__SHOOTOUT__.hold();
      });
      await sleep(420);
      keeperReady = await page.evaluate(() => window.__SHOOTOUT__.match);
    }
    const dragKeeper = async (fraction) => {
      const box = await page.locator('[data-testid="keeper-zone"]').boundingBox();
      if (!box) return null;
      await page.evaluate(() => window.__SHOOTOUT__.keeperOffset(0));
      await sleep(60);
      const base = await page.evaluate(() => window.__SHOOTOUT__.stadium());
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * fraction, box.y + box.height * 0.6, { steps: 5 });
      await page.mouse.up();
      await sleep(140);
      const after = await page.evaluate(() => window.__SHOOTOUT__.stadium());
      return {
        baseScreenX: base.keeperScreenX,
        screenX: after.keeperScreenX,
        worldX: after.keeper[0],
        offset: after.keeperOffset,
        keeperX: (await page.evaluate(() => window.__SHOOTOUT__.match))?.keeperX,
        role: after.role,
      };
    };
    const dragRight = await dragKeeper(0.9);
    const dragLeft = await dragKeeper(0.1);
    check('M7 キーパーを右へドラッグすると画面の右へ、左へドラッグすると画面の左へ動く',
      Boolean(dragRight && dragLeft) && keeperReady?.role === 'keep'
      && dragRight.worldX < -0.2 && dragRight.screenX > dragRight.baseScreenX + 0.02
      && dragLeft.worldX > 0.2 && dragLeft.screenX < dragLeft.baseScreenX - 0.02
      && dragRight.offset < 0 && dragLeft.offset > 0, { dragRight, dragLeft, role: keeperReady?.role });
    await shot(page, 'b7-keeper-drag');

    /* M8 時間切れ: 方向を選んでいれば、決定を押し忘れてもその方向で普通に飛ぶ */
    const timeoutKeeper = await page.evaluate(() => {
      window.__SHOOTOUT__.hold();
      if (window.__SHOOTOUT__.match?.role !== 'keep') return { skipped: 'not-keeper' };
      window.__SHOOTOUT__.selectDirection('BL'); /* キーパー視点の左下 → ゴール基準では BR */
      window.__SHOOTOUT__.timeoutNow();
      return window.__SHOOTOUT__.match?.lastEvent ?? null;
    });
    await sleep(700);
    check('M8 時間切れ（キーパーが方向を選んでいた）は棒立ちにせず、その方向へ飛ぶ',
      timeoutKeeper.skipped === 'not-keeper'
      || (timeoutKeeper.stuck === false && timeoutKeeper.timeout === false
        && timeoutKeeper.save === 'BR' && timeoutKeeper.shot === 'TL'), timeoutKeeper);

    /* M8b 蹴る番でも、方向を選んでいれば時間切れで枠外にしない */
    const timeoutShooter = await page.evaluate(() => {
      if (window.__SHOOTOUT__.match?.winner) return { skipped: 'finished' };
      window.__SHOOTOUT__.handover();
      window.__SHOOTOUT__.next();
      window.__SHOOTOUT__.handover();
      window.__SHOOTOUT__.hold();
      if (window.__SHOOTOUT__.match?.role !== 'shoot') return { skipped: 'not-shooter' };
      window.__SHOOTOUT__.selectDirection('TR');
      window.__SHOOTOUT__.timeoutNow();
      return window.__SHOOTOUT__.match?.lastEvent ?? null;
    });
    await sleep(700);
    check('M8b 時間切れ（キッカーが方向を選んでいた）は枠外にせず、その方向へ蹴る',
      timeoutShooter.skipped === 'finished' || timeoutShooter.skipped === 'not-shooter'
      || (timeoutShooter.miss === false && timeoutShooter.timeout === false && timeoutShooter.shot === 'TR'), timeoutShooter);

    /* M9 時間切れ（何も選んでいない）: キーパーは動けない／キッカーは枠外 */
    const timeoutStuck = await page.evaluate(() => {
      if (window.__SHOOTOUT__.match?.winner) return { skipped: 'finished' };
      window.__SHOOTOUT__.handover();
      window.__SHOOTOUT__.next();
      window.__SHOOTOUT__.handover();
      window.__SHOOTOUT__.hold();
      const role = window.__SHOOTOUT__.match?.role;
      window.__SHOOTOUT__.timeoutNow();
      return { role, event: window.__SHOOTOUT__.match?.lastEvent ?? null };
    });
    await sleep(600);
    check('M9 何も選ばずに時間切れ: キーパーは動けず（stuck）／キッカーは枠外（MISS）',
      timeoutStuck.skipped === 'finished'
      || (timeoutStuck.role === 'keep' && timeoutStuck.event?.stuck === true && timeoutStuck.event?.timeout === true)
      || (timeoutStuck.role === 'shoot' && timeoutStuck.event?.miss === true && timeoutStuck.event?.timeout === true),
      timeoutStuck);
    await page.evaluate(() => window.__SHOOTOUT__.go('home'));
    await sleep(250);
}

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

  /* Build 7 の確認だけを走らせる（時間制限のある環境で full を分割するとき用） */
  if (mode === 'build7') {
    try {
      const { context, page } = await openPage(browser, { url: server.url });
      await page.evaluate(() => window.__SHOOTOUT__.skipOpening());
      await sleep(420);
      await buildSeven(page);
      check('I1 コンソールエラー 0（Build 7 の通し）', errors.length === 0, errors.slice(0, 5));
      await context.close();
    } finally {
      await browser.close();
      await server.close();
    }
    const failedBuild7 = checks.filter((item) => !item.ok);
    process.stdout.write(`\n${checks.length - failedBuild7.length}/${checks.length} checks passed\n`);
    if (failedBuild7.length) {
      process.stdout.write(`failed: ${failedBuild7.map((item) => item.name).join(' / ')}\n`);
      process.exitCode = 1;
    }
    return;
  }

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
    const shootDirHint = await page.evaluate(() => {
      const hint = document.querySelector('[data-testid="keeper-dir-hint"]');
      return { exists: Boolean(hint), hidden: hint ? hint.hidden === true && !hint.getClientRects().length : false };
    });
    check('L4 シュートの番にはキーパー用の方向案内を出さない', shootDirHint.exists && shootDirHint.hidden, shootDirHint);
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
    const dirHint = await page.evaluate(() => {
      const hint = document.querySelector('[data-testid="keeper-dir-hint"]');
      const zone = document.querySelector('[data-testid="zone-TL"] span');
      const rect = hint?.getBoundingClientRect();
      const stage = document.querySelector('#stage')?.getBoundingClientRect();
      return {
        visible: Boolean(hint && hint.getClientRects().length),
        text: hint?.textContent?.trim() ?? '',
        tl: zone?.textContent?.trim() ?? '',
        inside: Boolean(rect && stage && rect.left >= stage.left - 1 && rect.right <= stage.right + 1),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check('L3 キーパーの番に「画面の向きで選ぶ」短い案内（例はボタンと同じ左上・画面内に収まる）',
      dirHint.visible && dirHint.text.length > 8 && dirHint.tl.length > 0
      && dirHint.text.toLowerCase().includes(dirHint.tl.toLowerCase()) && dirHint.inside && dirHint.overflow <= 0, dirHint);
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
    /* バナーは演出の途中で書き換わるので、MISS KICK が出るまで待つ（最大3秒） */
    await page.waitForFunction(() => /MISS KICK/.test(document.querySelector('#banner')?.textContent || ''), null, { timeout: 3000 }).catch(() => {});
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
    const legend = await page.evaluate(() => {
      const head = document.querySelector('.kicklog__head');
      const shot = head?.querySelector('.kicklog__shot')?.getBoundingClientRect();
      const save = head?.querySelector('.kicklog__save')?.getBoundingClientRect();
      return {
        gap: shot && save ? Math.round(save.left - shot.right) : null,
        text: head?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      };
    });
    check('D7 凡例 ⚽ シュート vs 🧤 セーブ が近くに並ぶ（左右両端に離れない）', legend.gap != null && legend.gap < 90 && /vs/.test(legend.text), legend);
    await shot(page, 'result');
    await b3shot(page, 'result');
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
    /* ボールがゴールに届くのはキックから約0.8秒後。紙吹雪・ネットの揺れが出るまで待つ */
    await page.waitForFunction(() => {
      const stadium = window.__SHOOTOUT__.stadium();
      return stadium.confetti === true || stadium.netEnergy > 0;
    }, null, { timeout: 4000 }).catch(() => {});
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
     * J. Build 3 の修正項目（9項目）
     * ============================================================== */
    const overlap = (a, b) => Boolean(a && b)
      && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

    /* J1 ホームのヒーロー枠（文字特大でも押し潰さない） */
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ size: 'extra', language: 'ja' }));
    await page.evaluate(() => window.__SHOOTOUT__.go('home'));
    await sleep(380);
    const heroExtra = await page.evaluate(() => {
      const hero = document.querySelector('.hero');
      const kids = [...hero.children].filter((el) => !el.className.includes('rays'));
      const gap = parseFloat(getComputedStyle(hero).rowGap) || 0;
      const content = kids.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0) + gap * (kids.length - 1);
      const rect = hero.getBoundingClientRect();
      const img = document.querySelector('.hero__img');
      const word = document.querySelector('.hero__wordmark');
      const tag = document.querySelector('.hero__tag');
      const teams = document.querySelector('.hero__teams');
      const inside = [img, word, tag, teams].every((el) => {
        const box = el?.getBoundingClientRect();
        return box && box.height > 0 && box.top >= rect.top - 1 && box.bottom <= rect.bottom + 1;
      });
      return {
        inside,
        squashed: content > rect.height + 1,
        heroHeight: Math.round(rect.height),
        content: Math.round(content),
        imgHeight: Math.round(img?.getBoundingClientRect().height || 0),
        emblemLoaded: img?.complete === true,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check('J1 文字特大でもホームのエンブレム枠が押し潰されず、ロゴ・タイトル・対戦国が全部見える',
      heroExtra.inside && heroExtra.squashed === false && heroExtra.emblemLoaded === true && heroExtra.imgHeight >= 60 && heroExtra.overflowX <= 0, heroExtra);
    await b3shot(page, 'home-extra');
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ size: 'standard' }));
    await page.evaluate(() => window.__SHOOTOUT__.go('home'));
    await sleep(250);
    await b3shot(page, 'home');

    /* J2 バックグラウンドで音と時計が止まる */
    await page.evaluate(() => window.__SHOOTOUT__.appHidden(false));
    await page.evaluate(() => { window.__SHOOTOUT_FORCE_CPU__ = ['TL']; window.__SHOOTOUT__.startMatch(); });
    await page.waitForFunction(() => window.__SHOOTOUT__.match?.handover === false && (window.__SHOOTOUT__.match?.remainingMs ?? 0) > 0, null, { timeout: 8000 });
    await sleep(400);
    const beforeHide = await page.evaluate(() => ({ audio: window.__SHOOTOUT__.audio, remaining: window.__SHOOTOUT__.match?.remainingMs }));
    await page.evaluate(() => window.__SHOOTOUT__.appHidden(true));
    await sleep(700);
    const hiddenState = await page.evaluate(() => ({ audio: window.__SHOOTOUT__.audio, remaining: window.__SHOOTOUT__.match?.remainingMs }));
    await sleep(500);
    const hiddenLater = await page.evaluate(() => window.__SHOOTOUT__.match?.remainingMs);
    const pauseDelta = Math.abs((hiddenLater ?? 0) - (hiddenState.remaining ?? 0));
    await page.evaluate(() => window.__SHOOTOUT__.appHidden(false));
    await sleep(500);
    const shownState = await page.evaluate(() => ({ audio: window.__SHOOTOUT__.audio, remaining: window.__SHOOTOUT__.match?.remainingMs }));
    check('J2 バックグラウンドでBGM・歓声を止め AudioContext を suspend（戻ると再開）',
      beforeHide.audio.crowd === true && hiddenState.audio.backgrounded === true && hiddenState.audio.crowd === false
      && hiddenState.audio.music === false && hiddenState.audio.context !== 'running'
      && shownState.audio.backgrounded === false && shownState.audio.crowd === true,
      { beforeHide: beforeHide.audio, hidden: hiddenState.audio, shown: shownState.audio });
    check('J2b バックグラウンド中はラウンドの時計も止まる（7秒を無駄に消費しない）',
      pauseDelta < 400 && (shownState.remaining ?? 0) < (hiddenState.remaining ?? 0), { pauseDelta, hidden: hiddenState.remaining, shown: shownState.remaining });

    /* J3 試合画面の右上ボタン */
    await page.evaluate(() => window.__SHOOTOUT__.hold());
    const toolBoxes = await page.evaluate(() => {
      const box = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      return {
        sound: box('[data-testid="match-sound"]'),
        settings: box('[data-testid="match-settings"]'),
        back: box('[data-action="quit"]'),
        hud: box('.hud'),
        turn: box('[data-testid="role"]'),
        pressed: document.querySelector('[data-testid="match-sound"]')?.getAttribute('aria-pressed'),
      };
    });
    check('J3 プレイ中の右上にスピーカーと設定（戻る・スコア・ターン表示と重ならない）',
      Boolean(toolBoxes.sound && toolBoxes.settings) && !overlap(toolBoxes.sound, toolBoxes.back)
      && !overlap(toolBoxes.sound, toolBoxes.hud) && !overlap(toolBoxes.sound, toolBoxes.turn)
      && !overlap(toolBoxes.sound, toolBoxes.settings), toolBoxes);
    await b3shot(page, 'match-tools');
    await page.click('[data-testid="match-sound"]');
    await sleep(200);
    const soundOff = await page.evaluate(() => ({
      prefs: window.__SHOOTOUT__.prefs,
      pressed: document.querySelector('[data-testid="match-sound"]')?.getAttribute('aria-pressed'),
      screen: window.__SHOOTOUT__.screen,
    }));
    check('J3b 右上のスピーカーで音を ON/OFF（試合は続く）', soundOff.pressed === 'false' && soundOff.prefs.sound === false && soundOff.prefs.bgm === false && soundOff.screen === 'match', soundOff);
    await page.click('[data-testid="match-sound"]');
    await sleep(150);
    await page.click('[data-testid="match-settings"]');
    await sleep(250);
    const sheet = await page.evaluate(() => {
      const card = document.querySelector('[data-quick-settings]');
      return {
        open: Boolean(card),
        rows: card ? card.querySelectorAll('[data-quick-toggle]').length : 0,
        screen: window.__SHOOTOUT__.screen,
        history: window.__SHOOTOUT__.match?.history ?? -1,
      };
    });
    await b3shot(page, 'match-settings');
    await page.click('[data-quick="close"]');
    await sleep(200);
    const sheetClosed = await page.evaluate(() => ({ open: Boolean(document.querySelector('[data-quick-settings]')), screen: window.__SHOOTOUT__.screen, history: window.__SHOOTOUT__.match?.history ?? -1 }));
    check('J3c 右上の設定は試合を中断せずに開閉できる', sheet.open && sheet.rows === 6 && sheet.screen === 'match' && !sheetClosed.open && sheetClosed.screen === 'match' && sheetClosed.history === sheet.history, { sheet, sheetClosed });

    /* J5 ロッカーの先攻/後攻とPK表の並び */
    await page.evaluate(() => window.__SHOOTOUT__.go('locker'));
    await sleep(450);
    const lockerB3 = await page.evaluate(() => ({
      preview: window.__SHOOTOUT__.preview,
      badge: document.querySelector('[data-testid="preview-badge"]')?.textContent?.trim() ?? '',
      canvas: Boolean(document.querySelector('[data-testid="locker-preview"]')?.getClientRects().length),
      orders: document.querySelectorAll('[data-order]').length,
      order: window.__SHOOTOUT__.prefs.order,
    }));
    check('J9 ロッカーは3Dプレビュー（近く・斜め正面）とキャラ名バッジを出す',
      lockerB3.preview.available === true && lockerB3.canvas && /ブロック/.test(lockerB3.badge) && /無料/.test(lockerB3.badge), lockerB3);
    await b3shot(page, 'locker');
    /* キャラ切替は回転ジャンプ（spinning）で知らせる */
    await page.click('[data-character="stylized"]');
    await sleep(180);
    const afterSwitch = await page.evaluate(() => ({ preview: window.__SHOOTOUT__.preview, badge: document.querySelector('[data-testid="preview-badge"]')?.textContent?.trim() ?? '' }));
    await b3shot(page, 'locker-stylized');
    check('J9b スタイリッシュに切り替えるとバッジが変わり、その場で回転ジャンプする',
      afterSwitch.preview.character === 'stylized' && afterSwitch.preview.spinning === true && /スタイリッシュ/.test(afterSwitch.badge), afterSwitch);
    await page.click('[data-character="voxel"]');
    await sleep(220);
    await page.click('[data-testid="order-second"]');
    await sleep(320);
    const orderChosen = await page.evaluate(() => ({
      order: window.__SHOOTOUT__.prefs.order,
      on: document.querySelector('[data-testid="order-second"]')?.classList.contains('is-on'),
    }));
    check('J5 ロッカーに先攻/後攻の選択ボタンがあり、後攻を選べる', lockerB3.orders >= 2 && orderChosen.order === 'second' && orderChosen.on === true, { lockerB3, orderChosen });
    await page.evaluate(() => { window.__SHOOTOUT_FORCE_CPU__ = ['TL']; window.__SHOOTOUT__.startMatch(); window.__SHOOTOUT__.handover(); });
    await sleep(500);
    const pkOrder = await page.evaluate(() => ({
      first: window.__SHOOTOUT__.match?.first,
      rows: [...document.querySelectorAll('[data-testid^="pk-row-"]')].map((el) => `${el.dataset.testid}:${el.dataset.order}`),
      hud: [...document.querySelectorAll('.hud__team')].map((el) => (el.className.includes('hud__team--me') ? 'me' : 'opp')),
    }));
    await b3shot(page, 'pk-order');
    check('J5b 後攻を選んでキックオフすると相手が先攻（上段=先攻・下段=後攻、左=あなた）',
      pkOrder.first === 'opp' && pkOrder.rows[0] === 'pk-row-opp:先攻' && pkOrder.rows[1] === 'pk-row-me:後攻'
      && pkOrder.hud[0] === 'me' && pkOrder.hud[1] === 'opp', pkOrder);
    await page.evaluate(() => { window.__SHOOTOUT__.setPrefs({ order: 'first' }); window.__SHOOTOUT__.go('home'); });

    /* J6 戦績の2枠（リセットで通信通算が消えない） */
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('shootout4.record.v1') || '{}');
      localStorage.setItem('shootout4.record.v1', JSON.stringify({
        ...raw, played: 9, wins: 4, losses: 5, goals: 12, conceded: 14,
        onlinePlayed: 7, onlineWins: 5, onlineLosses: 2, onlineGoals: 11, onlineConceded: 9, points: 60,
      }));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__SHOOTOUT_READY__ === true, null, { timeout: 20000 });
    await page.evaluate(() => { window.__SHOOTOUT__.skipOpening(); window.__SHOOTOUT__.go('stats'); });
    await sleep(450);
    const statsB3 = await page.evaluate(() => ({
      cpu: Boolean(document.querySelector('[data-testid="stats-cpu"]')),
      online: Boolean(document.querySelector('[data-testid="stats-online"]')),
      onlinePlayed: document.querySelector('[data-testid="online-played"]')?.textContent?.trim(),
      onlineWins: document.querySelector('[data-testid="online-wins"]')?.textContent?.trim(),
      cpuPlayed: document.querySelector('[data-testid="stats-cpu"] .statgrid b')?.textContent?.trim(),
    }));
    await b3shot(page, 'stats');
    await page.click('[data-testid="reset-record"]');
    await sleep(250);
    await page.click('[data-modal="yes"]');
    await sleep(400);
    const afterReset = await page.evaluate(() => ({
      onlinePlayed: document.querySelector('[data-testid="online-played"]')?.textContent?.trim(),
      record: window.__SHOOTOUT__.record,
    }));
    check('J6 戦績は CPU（リセット可）と PRO 通信対戦通算の2枠。リセットで通信通算は消えない',
      statsB3.cpu && statsB3.online && statsB3.onlinePlayed === '7' && statsB3.onlineWins === '5' && statsB3.cpuPlayed === '9'
      && afterReset.onlinePlayed === '7' && afterReset.record.onlineWins === 5 && afterReset.record.played === 0, { statsB3, afterReset });

    /* J7 キーパーのダイビング（画面の左下を選ぶ→画面の左へ、頭から） */
    await page.evaluate(() => { window.__SHOOTOUT_FORCE_CPU__ = ['TL']; window.__SHOOTOUT__.startMatch(); window.__SHOOTOUT__.handover(); window.__SHOOTOUT__.hold(); });
    await sleep(400);
    await page.evaluate(() => { window.__SHOOTOUT__.selectDirection('TR'); window.__SHOOTOUT__.confirmKick(); });
    await page.waitForFunction(() => (window.__SHOOTOUT__.match?.history ?? 0) >= 1, null, { timeout: 12000 });
    await page.evaluate(() => { window.__SHOOTOUT__.handover(); window.__SHOOTOUT__.next(); window.__SHOOTOUT__.handover(); window.__SHOOTOUT__.hold(); });
    await page.waitForFunction(() => window.__SHOOTOUT__.match?.role === 'keep', null, { timeout: 8000 });
    await sleep(300);
    await page.click('[data-testid="zone-BL"]');
    const pickedBL = await page.evaluate(() => ({
      selected: [...document.querySelectorAll('.zone.is-selected')].map((el) => el.dataset.dir),
      disabled: document.querySelector('#confirm')?.disabled,
    }));
    /* 時計を止めてからキック：演出の後に自動で次のラウンドへ進まない（ダイビングを撮る） */
    await page.evaluate(() => window.__SHOOTOUT__.hold());
    await page.click('[data-testid="confirm"]');
    await sleep(2200);
    await sleep(140);
    const diveB3 = await page.evaluate(() => ({
      stadium: window.__SHOOTOUT__.stadium(),
      status: document.querySelector('#kick-status')?.textContent ?? '',
      history: window.__SHOOTOUT__.match?.history ?? 0,
    }));
    await b3shot(page, 'keeper-dive');
    check('J7 キーパーは押した左下（＝画面の左）へ、頭と手から飛んでゴール内に収まる',
      pickedBL.selected[0] === 'BL' && pickedBL.disabled === false
      && diveB3.stadium.keeper[0] > 0.6 && diveB3.stadium.keeperRoll < -0.2 && Math.abs(diveB3.stadium.keeper[0]) < 3.3
      && diveB3.stadium.keeper[1] > 0.2, { pickedBL, ...diveB3 });

    /* J8 国えらぶの横スクロール案内 */
    await page.evaluate(() => window.__SHOOTOUT__.go('country'));
    await sleep(400);
    const hints = await page.evaluate(() => [...document.querySelectorAll('[data-testid="strip-hint"]')].map((el) => ({ text: el.textContent.trim(), visible: Boolean(el.getClientRects().length), box: Math.round(el.getBoundingClientRect().width) })));
    await b3shot(page, 'country');
    const hintEn = await page.evaluate(() => { window.__SHOOTOUT__.setPrefs({ language: 'en' }); return document.querySelector('[data-testid="strip-hint"]')?.textContent?.trim() ?? ''; });
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ language: 'ja' }));
    await sleep(200);
    check('J8 国えらぶの「あなたの国」「対戦相手」の横にスクロール案内（12言語対応）',
      hints.length === 2 && hints.every((hint) => hint.visible && hint.box > 40 && /←|→/.test(hint.text)) && hintEn !== '' && hintEn !== hints[0].text, { hints, hintEn });

    /* ============================================================== *\
     * K. Build 4（実機フィードバック＋ランキング刷新＋個人データ）
     * ============================================================== */
    await page.evaluate(() => { window.__SHOOTOUT_FORCE_CPU__ = null; window.__SHOOTOUT__.setPrefs({ size: 'standard', night: false, language: 'ja', order: 'first', sound: true, bgm: true, vibrate: true }); });
    /* 髪型の検証を決定的にする（登録国を日本にそろえる） */
    await page.evaluate(() => window.__SHOOTOUT__.register({ country: 'JP', foot: 'right' }));
    await sleep(220);

    /* K1 ロッカー上部の「保存して着る」 */
    await page.evaluate(() => window.__SHOOTOUT__.go('locker'));
    await sleep(450);
    const lockerTop = await page.evaluate(() => {
      const body = document.querySelector('.screen__body');
      const button = document.querySelector('[data-testid="save-skin-top"]');
      const rect = button?.getBoundingClientRect();
      const bodyRect = body?.getBoundingClientRect();
      return {
        exists: Boolean(button),
        visible: rect ? rect.height > 0 && rect.bottom <= bodyRect.bottom + 2 : false,
        buttons: document.querySelectorAll('[data-action="save-skin"]').length,
        aboveOrder: (rect?.top ?? 0) < (document.querySelector('[data-testid="locker-order"]')?.getBoundingClientRect().top ?? 0),
        scrollTop: body?.scrollTop ?? -1,
      };
    });
    await page.click('[data-testid="save-skin-top"]');
    await sleep(260);
    const lockerToast = await page.evaluate(() => document.querySelector('#toast')?.textContent ?? '');
    check('K1 ロッカー上部（スクロール前）にも「保存して着る」があり、押すと保存できる',
      lockerTop.exists && lockerTop.visible && lockerTop.buttons === 2 && lockerTop.aboveOrder
      && /保存/.test(lockerToast), { lockerTop, lockerToast });
    await b4shot(page, 'locker-top-save');

    /* K2 蹴り始めは自分のボタンだけ（相手の方向・結果・スコア・PK表・バナーは着弾まで出ない） */
    await page.evaluate(() => { window.__SHOOTOUT_FORCE_CPU__ = ['TL']; window.__SHOOTOUT__.startMatch(); window.__SHOOTOUT__.handover(); window.__SHOOTOUT__.hold(); });
    await sleep(420);
    await page.click('[data-testid="zone-BR"]'); /* 選ぶ（ここで音も起こす） */
    const atKick = await page.evaluate(() => {
      window.__SHOOTOUT__.confirmKick();
      return {
        cpuLit: document.querySelectorAll('.zone.is-cpu').length,
        selected: [...document.querySelectorAll('.zone.is-selected')].map((el) => el.dataset.dir),
        status: document.querySelector('#kick-status')?.textContent ?? '',
        score: document.querySelector('[data-testid="score-me"]')?.textContent ?? '',
        cells: document.querySelectorAll('[data-testid="pk-me"] .pkcell.is-goal, [data-testid="pk-me"] .pkcell.is-miss').length,
        bannerHidden: document.querySelector('#banner')?.hidden !== false,
        history: window.__SHOOTOUT__.match?.history ?? 0,
        ball: window.__SHOOTOUT__.stadium().ball,
      };
    });
    check('K2 蹴り始めに相手の方向・結果テキスト・スコア・PK表・バナーが出ない（自分の選択だけ点灯）',
      atKick.history >= 1 && atKick.cpuLit === 0 && atKick.status === '' && atKick.score === '0'
      && atKick.cells === 0 && atKick.bannerHidden === true
      && atKick.selected.length === 1 && atKick.selected[0] === 'BR', atKick);
    await b4shot(page, 'kick-start');

    /* 着弾でまとめて出る */
    await page.waitForFunction(() => document.querySelector('#banner')?.hidden === false, null, { timeout: 6000 });
    const afterImpact = await page.evaluate(() => ({
      status: document.querySelector('#kick-status')?.textContent ?? '',
      score: document.querySelector('[data-testid="score-me"]')?.textContent ?? '',
      cells: document.querySelectorAll('[data-testid="pk-me"] .pkcell.is-goal').length,
      banner: document.querySelector('#banner')?.textContent ?? '',
      cpuLit: document.querySelectorAll('.zone.is-cpu').length,
      goal: window.__SHOOTOUT__.match?.lastEvent?.goal,
      audio: window.__SHOOTOUT__.audio,
    }));
    check('K3 ボールが届いた瞬間に相手の方向・結果テキスト・スコア・PK表・バナーが出る',
      afterImpact.goal === true && afterImpact.score === '1' && afterImpact.cells === 1
      && /あなた: 右下/.test(afterImpact.status) && /相手: 左上/.test(afterImpact.status)
      && /ゴール/.test(afterImpact.banner), afterImpact);
    check('K4 ゴールの瞬間に演出音（ホーン＋ファンファーレ）が鳴る',
      (afterImpact.audio.voices.goal ?? 0) >= 1 && afterImpact.audio.voice?.kind === 'goal', afterImpact.audio);
    await b4shot(page, 'impact');

    /* セーブ（同じ方向を選ぶ）でも、蹴り始めは相手のボタンを光らせない */
    await page.evaluate(() => { window.__SHOOTOUT_FORCE_CPU__ = ['TL']; window.__SHOOTOUT__.startMatch(); window.__SHOOTOUT__.handover(); window.__SHOOTOUT__.hold(); });
    await sleep(380);
    await page.click('[data-testid="zone-TL"]');
    const saveAtKick = await page.evaluate(() => {
      const voices = window.__SHOOTOUT__.audio.voices;
      window.__SHOOTOUT__.confirmKick();
      return { cpuLit: document.querySelectorAll('.zone.is-cpu').length, voices };
    });
    await page.waitForFunction(() => document.querySelector('#banner')?.hidden === false, null, { timeout: 6000 });
    const saveDone = await page.evaluate(() => ({
      status: document.querySelector('#kick-status')?.textContent ?? '',
      banner: document.querySelector('#banner')?.textContent ?? '',
      cpuLit: document.querySelectorAll('.zone.is-cpu').length,
      audio: window.__SHOOTOUT__.audio,
    }));
    check('K5 セーブでも相手の方向は着弾まで出さず、演出音は「セーブ」',
      saveAtKick.cpuLit === 0 && saveDone.cpuLit === 1 && /セーブ/.test(saveDone.banner)
      && (saveDone.audio.voices.save ?? 0) >= 1 && saveDone.audio.voice?.kind === 'save', { saveAtKick, saveDone });

    /* K6 利き足の蹴り分け（右＝左から右足 / 左＝右から左足） */
    const runUpFor = async (foot) => {
      await page.evaluate((value) => {
        window.__SHOOTOUT__.register({ foot: value });
        window.__SHOOTOUT_FORCE_CPU__ = ['TL'];
        window.__SHOOTOUT__.startMatch();
        window.__SHOOTOUT__.handover();
        window.__SHOOTOUT__.hold();
      }, foot);
      await sleep(520);
      return page.evaluate(() => window.__SHOOTOUT__.stadium().runUp);
    };
    const leftRun = await runUpFor('left');
    const rightRun = await runUpFor('right');
    check('K6 右利きはボールの左から右足、左利きは右から左足（助走位置・角度・蹴り足）',
      leftRun && rightRun
      && leftRun.startX > 0 && leftRun.plantX > 0 && Math.abs(leftRun.facing - Math.PI * 1.07) < 0.001 && leftRun.kickLeg === 1
      && rightRun.startX < 0 && rightRun.plantX < 0 && Math.abs(rightRun.facing - Math.PI * 0.93) < 0.001 && rightRun.kickLeg === 0
      && Math.abs(leftRun.shooter.pos[0] - leftRun.startX) < 0.02
      && Math.abs(rightRun.shooter.pos[0] - rightRun.startX) < 0.02, { leftRun, rightRun });
    await b4shot(page, 'runup-right');

    /* K7 バックグラウンド復帰で音が戻る */
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ sound: true, bgm: true }));
    await page.evaluate(() => window.__SHOOTOUT__.appHidden(false));
    await sleep(400);
    const beforeHide4 = await page.evaluate(() => window.__SHOOTOUT__.audio);
    await page.evaluate(() => window.__SHOOTOUT__.appHidden(true));
    await sleep(600);
    const hidden4 = await page.evaluate(() => window.__SHOOTOUT__.audio);
    await page.evaluate(() => window.__SHOOTOUT__.appHidden(false));
    await sleep(700);
    const shown4 = await page.evaluate(() => window.__SHOOTOUT__.audio);
    const gesture = await page.evaluate(() => window.__SHOOTOUT__.ensureAudio());
    check('K7 バックグラウンド復帰で音が戻る（Audio Session→resume→無音<audio>→BGM、タップでも resume）',
      beforeHide4.crowd === true && hidden4.crowd === false && hidden4.music === false
      && shown4.crowd === true && shown4.music === true && shown4.silent === true
      && shown4.recoveries > hidden4.recoveries && gesture === true, { beforeHide4, hidden4, shown4, gesture });

    /* K8 遊び方の下部: IPKSF 正式名称・加盟案内・公式勝ち点ルール */
    await page.evaluate(() => window.__SHOOTOUT__.go('rules'));
    await sleep(400);
    const rules4 = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="rules-ipksf"]');
      const points = document.querySelector('[data-testid="rules-points"]');
      const bullet = document.querySelector('.bulletlist');
      const body = document.querySelector('.screen__body');
      body.scrollTop = body.scrollHeight;
      const rect = panel?.getBoundingClientRect();
      const bodyRect = body?.getBoundingClientRect();
      return {
        name: document.querySelector('[data-testid="rules-ipksf-name"]')?.textContent ?? '',
        full: document.querySelector('[data-testid="rules-ipksf-full"]')?.textContent ?? '',
        join: document.querySelector('[data-testid="rules-join"]')?.textContent ?? '',
        pointsText: points?.innerText ?? '',
        afterBullets: Boolean(panel && bullet && panel.compareDocumentPosition(bullet) & Node.DOCUMENT_POSITION_PRECEDING),
        clipped: rect ? rect.bottom > bodyRect.bottom + 2 : true,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check('K8 遊び方の下部に IPKSF 正式名称・加盟案内・公式勝ち点ルール（見切れなし）',
      /INTERNATIONAL PENALTY KICK SHOOTOUT FEDERATION/.test(rules4.name)
      && /国際PK戦連盟/.test(rules4.full) && rules4.join.length > 2
      && /\+3pt/.test(rules4.pointsText) && /\+2pt/.test(rules4.pointsText) && /\+1pt/.test(rules4.pointsText)
      && rules4.afterBullets && rules4.clipped === false && rules4.overflow <= 0, rules4);
    await b4shot(page, 'rules-ipksf');

    /* K9 国別の髪型・髪色と、手（✊ / ✋） */
    await page.evaluate(() => {
      window.__SHOOTOUT__.setPrefs({ country: 'JP', opponent: 'BR' });
      window.__SHOOTOUT_FORCE_CPU__ = ['TL'];
      window.__SHOOTOUT__.startMatch();
      window.__SHOOTOUT__.handover();
      window.__SHOOTOUT__.hold();
    });
    await sleep(600);
    const look4 = await page.evaluate(() => ({
      stadium: window.__SHOOTOUT__.stadium(),
      style: window.__SHOOTOUT__.entitled,
    }));
    check('K9 3Dの両チームに手（こぶし＝フィールド / 指付きグローブ＝キーパー）と国別の髪',
      look4.stadium.hands.kicker?.kind === 'fist' && look4.stadium.hands.kicker?.count === 2
      && look4.stadium.hands.keeper?.kind === 'glove' && look4.stadium.hands.keeper?.count === 2
      && look4.stadium.hair.style === 'short' && look4.stadium.oppHair.style === 'topknot', look4);
    /* PRO の髪型は国籍で変わる（ロッカーのプレビューにも出る） */
    await page.evaluate(() => { window.__SHOOTOUT__.setPrefs({ opponent: 'SE' }); window.__SHOOTOUT__.go('locker'); });
    await sleep(420);
    await page.click('[data-character="stylized"]');
    await sleep(320);
    const preview4 = await page.evaluate(() => window.__SHOOTOUT__.preview);
    await page.click('[data-testid="save-skin-top"]');
    await sleep(260);
    await page.evaluate(() => { window.__SHOOTOUT_FORCE_CPU__ = ['TL']; window.__SHOOTOUT__.startMatch(); window.__SHOOTOUT__.handover(); window.__SHOOTOUT__.hold(); });
    await sleep(700);
    const stylized4 = await page.evaluate(() => window.__SHOOTOUT__.stadium());
    check('K9b PRO のスタイリッシュ型は国別の髪（JP=ショート / SE=アッシュ）で、3Dとロッカーの両方に反映',
      preview4.hair?.style === 'short' && preview4.hands?.kind === 'fist'
      && stylized4.style === 'stylized' && stylized4.hair.style === 'short' && stylized4.oppHair.style === 'short'
      && stylized4.hair.color === '#15100c' && stylized4.oppHair.color === '#8d877f', { preview4, stylized4 });
    await b4shot(page, 'hair-stylized');

    /* K10 ランキング: シーズン表記・あなたの順位・4タブ・世界/国内・順位表 */
    await page.evaluate(() => {
      const pad = (value) => String(value).padStart(2, '0');
      const now = new Date();
      const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const week = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
      const tally = { points: 7, wins: 3, losses: 1, goals: 12, conceded: 8, played: 4 };
      localStorage.setItem('shootout4.standing.v1', JSON.stringify({
        total: tally,
        month: { key: month, ...tally },
        week: { key: week, ...tally },
      }));
      localStorage.setItem('shootout4.shots.v1', JSON.stringify({ TL: 3, TR: 1, BL: 0, BR: 6 }));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__SHOOTOUT_READY__ === true, null, { timeout: 20000 });
    await page.evaluate(() => { window.__SHOOTOUT__.skipOpening(); window.__SHOOTOUT__.setPrefs({ language: 'ja', size: 'standard', order: 'first' }); window.__SHOOTOUT__.go('rank'); });
    await sleep(600);
    const rank4 = await page.evaluate(() => ({
      season: document.querySelector('[data-testid="rank-season-label"]')?.textContent ?? '',
      you: document.querySelector('[data-testid="rank-you"]')?.textContent ?? '',
      diff: document.querySelector('[data-testid="rank-diff"]')?.textContent ?? '',
      tabs: document.querySelectorAll('[data-rank-tab]').length,
      scopes: document.querySelectorAll('[data-scope]').length,
      rows: document.querySelectorAll('.ranktable__row').length,
      meRow: document.querySelector('[data-testid="rank-row-me"]')?.innerText?.replace(/\s+/g, ' ').trim() ?? '',
      rules: document.querySelector('[data-testid="rank-rules"]')?.innerText ?? '',
      sorted: window.__SHOOTOUT__.rank('total').map((row) => [row.place, row.tally.points, row.tally.goals, row.tally.conceded]),
    }));
    check('K10 ランキング: シーズン表記・あなたの順位（勝ち点/勝敗/勝率）・4タブ・世界/国内',
      /通算シーズン · 全期間/.test(rank4.season)
      && /あなたの順位：\d+位/.test(rank4.you) && /7pt/.test(rank4.you) && /3勝1敗/.test(rank4.you) && /75%/.test(rank4.you)
      && rank4.tabs === 4 && rank4.scopes === 2 && rank4.rows >= 1 && /🥇/.test(rank4.meRow)
      && /3pt/.test(rank4.rules) && /得失点差/.test(rank4.rules), rank4);
    await b4shot(page, 'rank');

    /* タブを切り替えると期間の集計に変わる（月間＝今月、勝率＝通算） */
    await page.click('[data-rank-tab="week"]');
    await sleep(260);
    const weekTab = await page.evaluate(() => ({
      label: document.querySelector('[data-testid="rank-season-label"]')?.textContent ?? '',
      on: document.querySelector('[data-rank-tab="week"]')?.classList.contains('is-on'),
      you: document.querySelector('[data-testid="rank-you"]')?.textContent ?? '',
    }));
    await page.click('[data-rank-tab="month"]');
    await sleep(240);
    const monthTab = await page.evaluate(() => ({
      label: document.querySelector('[data-testid="rank-season-label"]')?.textContent ?? '',
      you: document.querySelector('[data-testid="rank-you"]')?.textContent ?? '',
    }));
    await page.click('[data-rank-tab="rate"]');
    await sleep(240);
    const rateTab = await page.evaluate(() => ({
      label: document.querySelector('[data-testid="rank-season-label"]')?.textContent ?? '',
      you: document.querySelector('[data-testid="rank-you"]')?.textContent ?? '',
    }));
    check('K11 総合/月間/週間/勝率でシーズン表記と集計が切り替わる',
      /週シーズン/.test(weekTab.label) && weekTab.on === true
      && /シーズン · 残り/.test(monthTab.label) && /7pt/.test(monthTab.you)
      && /通算勝率/.test(rateTab.label) && /75%/.test(rateTab.you), { weekTab, monthTab, rateTab });
    await page.evaluate(() => window.__SHOOTOUT__.setRankTab('total'));
    await sleep(200);

    /* K12 戦績のキック傾向（4択の回数と％） */
    await page.evaluate(() => window.__SHOOTOUT__.go('stats'));
    await sleep(400);
    const tendency = await page.evaluate(() => ({
      rows: ['TL', 'TR', 'BL', 'BR'].map((dir) => {
        const row = document.querySelector(`[data-testid="tendency-${dir}"]`);
        return { dir, count: row?.dataset.count, rate: row?.dataset.rate, text: row?.innerText?.replace(/\s+/g, ' ').trim() ?? '' };
      }),
      total: document.querySelector('[data-testid="tendency-total"]')?.textContent ?? '',
      panel: Boolean(document.querySelector('[data-testid="stats-tendency"]')),
      shots: window.__SHOOTOUT__.shots,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.querySelector('.screen__body') ? true : false,
    }));
    check('K12 戦績にキック傾向（左上3/右上1/左下0/右下6・合計10本と％）',
      tendency.panel && tendency.rows[0].count === '3' && tendency.rows[0].rate === '30'
      && tendency.rows[1].count === '1' && tendency.rows[2].count === '0'
      && tendency.rows[3].count === '6' && tendency.rows[3].rate === '60'
      && /10本/.test(tendency.total) && tendency.overflow <= 0, tendency);
    await b4shot(page, 'stats-tendency');

    /* 文字特大でもランキング・戦績・遊び方が横にはみ出さない */
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ size: 'extra' }));
    const sweepB4 = await sweepScreens(page, 'build4', ['rank', 'stats', 'rules', 'locker']);
    check('K13 文字特大でもランキング・戦績・遊び方・ロッカーがはみ出さない', sweepB4.problems.length === 0, sweepB4.problems);
    await page.evaluate(() => window.__SHOOTOUT__.setPrefs({ size: 'standard' }));

    /* K14 結果画面の「結果をシェア」（Web Share が無い環境＝クリップボード） */
    await page.evaluate(() => {
      window.__SHOOTOUT__.setPrefs({ opponent: 'BR' });
      window.__SHOOTOUT_FORCE_CPU__ = ['TL'];
      window.__SHOOTOUT__.startMatch();
      window.__SHOOTOUT__.handover();
    });
    await sleep(400);
    const shareEnd = await playToEnd(page, { max: 30 });
    await page.waitForFunction(() => window.__SHOOTOUT__.screen === 'result', null, { timeout: 12000 });
    await sleep(320);
    const shareInfo = await page.evaluate(() => ({
      button: document.querySelector('[data-testid="share-result"]')?.textContent?.trim() ?? '',
      text: window.__SHOOTOUT__.shareText(),
      winner: window.__SHOOTOUT__.match?.winner ?? shareEnd?.winner,
    }));
    check('K14 結果画面に「結果をシェア」（国旗・スコア・#SHOOTOUT4・IPKSF）',
      shareInfo.button.length > 0 && /🇯🇵/.test(shareInfo.text) && /🇧🇷/.test(shareInfo.text)
      && /\d+-\d+/.test(shareInfo.text) && /#SHOOTOUT4/.test(shareInfo.text) && /IPKSF/.test(shareInfo.text), shareInfo);
    await page.evaluate(() => {
      try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch { /* そのまま */ }
      try {
        const fake = { writeText: async (value) => { window.__COPIED__ = value; } };
        Object.defineProperty(navigator, 'clipboard', { value: fake, configurable: true });
      } catch { /* そのまま */ }
      window.__COPIED__ = '';
    });
    await page.click('[data-testid="share-result"]');
    await sleep(320);
    const shared = await page.evaluate(() => ({ copied: window.__COPIED__, toast: document.querySelector('#toast')?.textContent ?? '' }));
    check('K14b 共有できない環境ではクリップボードへコピーして「コピーしました」',
      /#SHOOTOUT4/.test(shared.copied) && shared.copied === shareInfo.text && /コピーしました/.test(shared.toast), shared);
    await b4shot(page, 'result-share');

    /* ============================================================== *\
     * L. Build 6（棒読みボイス廃止・演出音の強化・キーパーの方向説明）
     * ============================================================== */
    const goalShowcase = await page.evaluate(() => {
      window.__SHOOTOUT__.setPrefs({ language: 'ja' });
      const before = window.__SHOOTOUT__.audio.voices.goal ?? 0;
      const result = window.__SHOOTOUT__.voice('goal');
      return { result, before, audio: window.__SHOOTOUT__.audio };
    });
    check('L1 ゴールはスタジアムホーン＋勝利のファンファーレ（音声の読み上げなし）',
      goalShowcase.result?.kind === 'goal' && goalShowcase.result?.mode === 'showcase'
      && (goalShowcase.audio.voices.goal ?? 0) > goalShowcase.before
      && goalShowcase.audio.voice?.kind === 'goal'
      && goalShowcase.audio.voice?.text === undefined
      && !Object.prototype.hasOwnProperty.call(goalShowcase.audio, 'speech'), goalShowcase);

    const showcaseProblems = [];
    for (const kind of ['goal', 'save', 'miss']) {
      const info = await page.evaluate((value) => {
        const before = window.__SHOOTOUT__.audio.voices[value] ?? 0;
        const result = window.__SHOOTOUT__.voice(value);
        const audio = window.__SHOOTOUT__.audio;
        return {
          result,
          counted: (audio.voices[value] ?? 0) === before + 1,
          last: audio.voice?.kind ?? '',
          mode: audio.voice?.mode ?? '',
          speech: Object.prototype.hasOwnProperty.call(audio, 'speech'),
        };
      }, kind);
      if (info.result?.kind !== kind || info.result?.mode !== 'showcase' || !info.counted
        || info.last !== kind || info.mode !== 'showcase' || info.speech) {
        showcaseProblems.push({ kind, ...info });
      }
    }
    check('L5 ゴール/セーブ/ミスが別々の演出音として鳴り、音声合成の記録を持たない', showcaseProblems.length === 0, showcaseProblems);

    /* 遊び方: キーパーの方向の説明（12言語・例がボタンの文言と一致） */
    const keeperRuleProblems = [];
    for (const language of languages) {
      await page.evaluate((tag) => {
        window.__SHOOTOUT__.setPrefs({ language: tag });
        window.__SHOOTOUT__.go('rules');
      }, language);
      await sleep(120);
      const info = await page.evaluate(() => {
        const text = document.querySelector('.rules-text')?.textContent ?? '';
        const tl = document.querySelector('.goaldiagram__zone--tl')?.textContent?.trim() ?? '';
        return {
          length: text.length,
          tl,
          mentions: tl ? text.toLowerCase().includes(tl.toLowerCase()) : false,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      if (info.length < 120 || !info.mentions || info.overflow > 0) keeperRuleProblems.push({ language, ...info });
    }
    check('L2 遊び方にキーパーの方向の説明と例（12言語・ボタン文言と一致・はみ出しなし）', keeperRuleProblems.length === 0, keeperRuleProblems);
    await page.evaluate(() => { window.__SHOOTOUT__.setPrefs({ language: 'ja' }); window.__SHOOTOUT__.go('home'); });

    /* M. Build 7（時間制限で分割したいときは SHOOTOUT_E2E_SKIP_M=1 で個別に `build7` を走らせる） */
    if (process.env.SHOOTOUT_E2E_SKIP_M !== '1') await buildSeven(page);

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
