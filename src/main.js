/**
 * SHOOTOUT 4 — アプリ本体（画面の切り替え・試合進行・通信・課金）
 *
 * 試合は「8秒＋決定」: 4方向から選び、決定で即座に結果。
 * CPUはラウンド開始時に方向を確定しているので、決定した瞬間に両者の手がそろう。
 */

import { CONFIG } from './config.js';
import { tr, detectLanguage, LANGUAGES, LANGUAGE_NAMES, isLanguage } from './i18n.js';
import {
  DIRECTIONS, MISS, newMatch, resolveKick, kickerNumber, phase, randomDirection, winRate, mirrorDirection,
  timeoutChoice, isDirection,
} from './core/rules.js';
import { keeperOffsetFromRatio, ratioFromClientX } from './core/controls.js';
import { EMOTE_IDS, EMOTE_SECTIONS, EMOTES, emoteById, cpuEmoteFor } from './core/emotes.js';
import { chooseCPU } from './core/cpu.js';
import {
  COUNTRIES, getCountry, pickOpponent, countryName, isCountryUnlocked, hairSpecForCountry,
} from './core/countries.js';
import {
  TABS, rankTable, seasonInfo, rollStanding, emptyRow, medalFor,
} from './core/ranking.js';
import {
  DEFAULT_SKIN, normalizeSkin, readSkin, saveSkin, effectiveSkin, isPartUnlocked,
  isCharacterUnlocked, getCharacter,
} from './core/skins.js';
import {
  DEFAULT_REGISTRATION, readRegistration, writeRegistration, normalizeRegistration, isRegistered,
  playerFor, cpuPlayer, officialCountry, registrationSummary,
} from './core/registration.js';
import {
  openStorage, loadPrefs, savePrefs, loadRecord, saveRecord, addResult, addOnlineResult,
  resetRecord, EMPTY_RECORD, TEXT_SIZES, SIZE_SCALE, loadStanding, saveStanding, recordStanding,
  loadShots, saveShots, addShotDirection, shotSummary,
} from './storage.js';
import {
  unlockAudio, configureAudio, click, select as selectSound, whistle, kickSound, netSound,
  gloveSound, goalRoar, countdownTick, startCrowd, stopCrowd, crowdSurge,
  openingCrowd, audioState, uiSwitch, purchaseChime, testSound, voice, champion, ensureAudioRunning,
  suspendForBackground, resumeFromBackground,
} from './audio.js';
import {
  initialEntitlement, refreshEntitlement, purchase, restore, loadPrice, clearEntitlement,
  mode as iapMode, diagnostic as iapDiagnostic, PRODUCT_ID,
} from './platform/iap.js';
import {
  RealtimeClient, ShootoutSession, RankingNet, onlineConfig, onlineConfigured, normalizeCode,
  randomCode, isValidCode, ONLINE_TURN_MS,
} from './net/online.js';
import { createStadium } from './three/stadium.js';
import { createPreview } from './three/preview.js';
import { homeView } from './ui/home.js';
import { countryView } from './ui/country.js';
import { matchView, resultView, pkCellList, shownDirection } from './ui/match.js';
import { buildShareText, buildResultCardModel, pickShareStrategy } from './core/share.js';
import { renderResultCard, resultCardFile } from './ui/result-card.js';
import { lockerView } from './ui/locker.js';
import { registerView } from './ui/register.js';
import { proView } from './ui/pro.js';
import { onlineView, rankView } from './ui/online.js';
import { settingsView, statsView, rulesView, privacyView, openingView, quickSettingsView } from './ui/misc.js';
import { $, $$, esc, icon } from './ui/layout.js';

/* ------------------------------------------------------------------ *\
 * 初期化
 * ------------------------------------------------------------------ */

const app = $('#app');
const storage = openStorage();
const deviceLanguages = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
let prefs = loadPrefs(storage, deviceLanguages);
let record = loadRecord(storage);
let standing = loadStanding(storage);
let shots = loadShots(storage);
let entitled = initialEntitlement();
let skin = effectiveSkin(readSkin(storage), entitled);
let registration = readRegistration(storage);
let registerDraft = { ...registration, teammates: registration.teammates.map((item) => ({ ...item })) };
let registerNext = 'locker';
let registerBack = 'locker';
let handoverTimer = null;
if (!prefs.opponent) prefs.opponent = pickOpponent(prefs.country, Math.random, { entitled }).code;

let screen = 'home';
let draft = { ...skin };
let stadium = null;
let match = null;
let session = null;
let client = null;
let online = { mode: 'menu', scope: 'domestic', code: '', status: '', opponent: null, searching: false, room: '', rankTab: 'total' };
let rankRows = [];
let rankStatus = '';
let proStatus = '';
let proPrice = null;
let proDiagState = '';
let toastTimer = null;
let nextTimer = null;
let rankNet = null;
let pendingConfirm = null;
let helpOpen = false;
let lockerPreview = null;
let lockerPreviewKey = '';
let appHidden = false;
/* Build 9: 結果カードは結果画面を出した直後に裏で作っておく（共有タップの瞬間に
   Canvas を描き始めると、iOS の「ユーザー操作中に share を呼ぶ」制約に触れうる） */
let resultCardCache = null;

const t = (key, vars) => tr(prefs.language, key, vars);

function applyTheme() {
  document.documentElement.dataset.size = TEXT_SIZES.includes(prefs.size) ? prefs.size : 'standard';
  document.documentElement.lang = prefs.language;
  document.title = CONFIG.title;
  configureAudio({ sound: prefs.sound, bgm: prefs.bgm, vibrate: prefs.vibrate });
}

function persist() {
  savePrefs(storage, prefs);
}

/* ------------------------------------------------------------------ *\
 * 画面
 * ------------------------------------------------------------------ */

/**
 * 表示用のキッカー情報（名前・利き足・背番号）。
 * 自分は公式選手登録の内容、CPU はラウンドごとに利き足が変わる。
 */
function kickerInfo(side, number, round = 0) {
  if (side === 'me') {
    return playerFor(registration, number, { countryLabel: countryName(prefs.country, prefs.language) });
  }
  return cpuPlayer(round, number, {
    countryLabel: countryName(prefs.opponent || 'BR', prefs.language),
    seed: `${prefs.opponent || 'BR'}:${officialCountry(registration, prefs.country)}`,
  });
}

function currentView() {
  switch (screen) {
    case 'home':
      return homeView({ t, prefs, record, entitled, language: prefs.language });
    case 'country':
      return countryView({ t, prefs, entitled, language: prefs.language });
    case 'match':
      return matchView({
        t, prefs, state: match.state, language: prefs.language,
        online: Boolean(match.online), roomLabel: match.online ? online.code : '',
        kickerFor: kickerInfo,
      });
    case 'result':
      return resultView({
        t, state: match.state, record, language: prefs.language, prefs,
        online: Boolean(match.online), kickerFor: kickerInfo,
      });
    case 'locker':
      return lockerView({
        t, entitled, draft, language: prefs.language, registered: isRegistered(registration),
        order: prefs.order === 'second' ? 'second' : 'first',
        hair: hairSpecForCountry(registration.country || prefs.country),
      });
    case 'register':
      return registerView({ t, draft: registerDraft, prefs, language: prefs.language, back: registerBack });
    case 'pro':
      return proView({ t, entitled, language: prefs.language, diagnostic: proDiagState, price: proPrice });
    case 'online':
      return onlineView({ t, entitled, language: prefs.language, state: online, registered: isRegistered(registration), officialCountry: officialCountry(registration, prefs.country) });
    case 'rank': {
      const tab = TABS.includes(online.rankTab) ? online.rankTab : 'total';
      refreshStandingPeriods();
      const table = rankTable(rankRows, myRankRow(), { tab });
      return rankView({
        t, table, entitled, language: prefs.language, status: rankStatus,
        tab, scope: online.scope,
        season: seasonInfo(tab, { language: prefs.language, t }),
        you: table.find((row) => row.isMe) || null,
        medal: medalFor,
      });
    }
    case 'stats':
      return statsView({ t, record, shots });
    case 'settings':
      return settingsView({ t, prefs, entitled, registered: isRegistered(registration) });
    case 'rules':
      return rulesView({ t });
    case 'privacy':
      return privacyView({ t });
    default:
      return homeView({ t, prefs, record, entitled, language: prefs.language });
  }
}

function render() {
  cancelAnimationFrame(match?.timerId);
  app.innerHTML = currentView();
  if (screen === 'match') {
    updateTimer(CONFIG.roundSeconds * 1000, CONFIG.roundSeconds * 1000);
    attachStage();
    attachKeeperDrag();
    updateBoard();
    updateHud();
    updateKeeperControls();
  }
  if (screen === 'locker') attachLockerPreview();
  /* Build 9: 結果画面を出したら、共有に備えてカードを裏で用意しておく */
  if (screen === 'result') setTimeout(() => prepareResultCard(), 320);
  document.documentElement.dataset.screen = screen;
  const body = $('.screen__body');
  if (body) body.scrollTop = 0;
}

/**
 * ロッカーの3Dプレビュー。キャラクター・4部位が変わったら、その場で回転ジャンプを
 * 1回入れて「切り替わった」ことが目で分かるようにする。
 */
function attachLockerPreview() {
  disposeLockerPreview();
  const canvas = $('#locker-preview');
  const lineup = $('#locker-lineup');
  if (!canvas) return;
  const hair = hairSpecForCountry(registration.country || prefs.country);
  const key = `${draft.character}|${draft.shirt}|${draft.shorts}|${draft.socks}|${draft.boots}|${hair.style}|${hair.color}`;
  const changed = Boolean(lockerPreviewKey) && lockerPreviewKey !== key;
  lockerPreviewKey = key;
  lockerPreview = createPreview(canvas, {
    style: draft.character,
    kit: { shirt: draft.shirt, shorts: draft.shorts, socks: draft.socks, boots: draft.boots },
    hair,
    animate: changed,
  });
  if (!lockerPreview.available) {
    canvas.hidden = true;
    if (lineup) lineup.hidden = false;
  } else if (lineup) {
    lineup.hidden = true;
  }
}

function disposeLockerPreview() {
  if (lockerPreview) {
    try {
      lockerPreview.dispose();
    } catch {
      /* WebGL の後始末は失敗しても続行 */
    }
    lockerPreview = null;
  }
}

function go(next) {
  if (screen === 'match' && next !== 'match') {
    stopRound();
    disposeStadium();
    stopCrowd();
  }
  if (screen === 'locker' && next !== 'locker') {
    disposeLockerPreview();
    lockerPreviewKey = '';
  }
  screen = next;
  render();
}

/* ------------------------------------------------------------------ *\
 * 3Dスタジアム
 * ------------------------------------------------------------------ */

function attachStage() {
  disposeStadium();
  const canvas = $('#scene');
  if (!canvas) return;
  stadium = createStadium(canvas, { night: prefs.night });
  if (!stadium.available) {
    canvas.hidden = true;
    const fallback = $('#stage-fallback');
    if (fallback) fallback.hidden = false;
    stadium = null;
    return;
  }
  stadium.setNight(prefs.night);
  updateStadiumTeams();
  prepareStadiumKick();
}

function attackingSide() {
  return match && match.state.turn === 'me' ? 'me' : 'opp';
}

/** 4部位 + キャラクター + 両チームの利き足・国別の髪を3Dへ渡す（すべて見た目だけ） */
function updateStadiumTeams() {
  if (!stadium || !match) return;
  const round = match.state.history.length;
  stadium.setTeams({
    skin: effectiveSkin(skin, entitled),
    entitled,
    myNumber: kickerNumber(match.state, 'me'),
    oppCountry: getCountry(prefs.opponent || 'BR').kit,
    footed: kickerInfo('me', kickerNumber(match.state, 'me'), round).foot,
    opponentFooted: kickerInfo('opp', kickerNumber(match.state, 'opp'), round).foot,
    hair: hairSpecForCountry(registration.country || prefs.country),
    oppHair: hairSpecForCountry(prefs.opponent || 'BR'),
  });
}

function prepareStadiumKick() {
  if (!stadium || !match) return;
  const side = attackingSide();
  const round = match.state.history.length;
  const number = kickerNumber(match.state, side);
  const role = currentRole();
  stadium.setRole(role);
  stadium.prepareKick({ kicker: number, role, footed: kickerInfo(side, number, round).foot });
}

function disposeStadium() {
  if (stadium) {
    try {
      stadium.dispose();
    } catch {
      /* WebGL の後始末は失敗しても続行 */
    }
    stadium = null;
  }
}

function currentRole() {
  return match && match.state.turn === 'me' ? 'shoot' : 'keep';
}

/* ------------------------------------------------------------------ *\
 * 試合
 * ------------------------------------------------------------------ */

function startMatch({ onlineMatch = false } = {}) {
  resultCardCache = null;
  const first = onlineMatch
    ? (session && session.mySide === 'away' ? 'opp' : 'me')
    : (prefs.order === 'second' ? 'opp' : 'me');
  match = {
    online: onlineMatch,
    state: newMatch({ first }),
    selection: null,
    confirmed: false,
    cpuDir: null,
    timerId: 0,
    deadline: 0,
    applied: 0,
    roundId: 0,
    nextTimer: null,
    waitingOpponent: false,
    lastRole: null,
    handover: false,
    hold: false,
    keeperX: 0,
    startedAt: performance.now(),
  };
  screen = 'match';
  online.searching = false;
  render();
  beginRound();
}

function beginRound() {
  if (!match) return;
  stopRound();
  const state = match.state;
  match.roundId += 1;
  match.selection = null;
  match.confirmed = false;
  match.waitingOpponent = false;
  match.hold = false;
  const forced = typeof window !== 'undefined' ? window.__SHOOTOUT_FORCE_CPU__ : null;
  match.cpuDir = match.online ? null : (Array.isArray(forced) && forced.length
    ? forced[state.history.length % forced.length]
    : chooseCPU(state, { level: prefs.level }));

  const role = currentRole();
  match.role = role;
  const kicker = kickerNumber(state, role === 'shoot' ? 'me' : 'opp');
  const roleChip = $('#role-chip');
  if (roleChip) {
    /* 大きなターン表示（⚽/🧤 + 文言）は子要素を保ったまま差し替える */
    roleChip.dataset.role = role;
    roleChip.classList.toggle('turn--shoot', role === 'shoot');
    roleChip.classList.toggle('turn--keep', role === 'keep');
    const dot = roleChip.querySelector('.turn__dot');
    const label = roleChip.querySelector('.turn__text');
    if (dot) dot.textContent = role === 'shoot' ? '⚽' : '🧤';
    if (label) label.textContent = t(role === 'shoot' ? 'turnShootBig' : 'turnKeepBig');
  }
  const kickerChip = $('#kicker-chip');
  if (kickerChip) kickerChip.textContent = `${t('kicker')} ${kicker}`;
  const status = $('#kick-status');
  if (status) status.textContent = '';
  match.keeperX = 0;
  match.opponentKeeperX = 0;
  if (stadium) {
    stadium.setKeeperOffset(0);
    stadium.setRemoteKeeperOffset(0);
  }
  const banner = $('#banner');
  if (banner) { banner.hidden = true; banner.className = 'banner'; }
  toggleEmoteTray(false);
  const nextBtn = $('#next-kick');
  if (nextBtn) nextBtn.hidden = true;
  $$('.zone').forEach((button) => {
    button.disabled = false;
    button.classList.remove('is-selected', 'is-cpu');
    button.setAttribute('aria-pressed', 'false');
  });
  const confirmButton = $('#confirm');
  if (confirmButton) confirmButton.disabled = true;
  const timer = $('#timer');
  if (timer) timer.classList.remove('is-urgent');

  if (stadium) {
    updateStadiumTeams();
    prepareStadiumKick();
  }
  const side = role === 'shoot' ? 'me' : 'opp';
  const foot = kickerInfo(side, kickerNumber(state, side), state.history.length).foot;
  if (kickerChip) {
    kickerChip.textContent = `${t('kicker')} ${kickerNumber(state, side)} · ${kickerInfo(side, kickerNumber(state, side), state.history.length).name} · ${t(foot === 'left' ? 'footLeft' : 'footRight')}`;
  }
  whistle();
  startCrowd(getCountry(prefs.country));

  /* キッカー↔キーパーの交代時に、説明付きのワンクッション（1.3秒） */
  const first = match.lastRole == null;
  const switched = match.lastRole != null && match.lastRole !== role;
  match.lastRole = role;
  match.handover = first || switched;
  clearTimeout(handoverTimer);
  if (match.handover) {
    showHandover(role, { first });
    handoverTimer = setTimeout(() => {
      if (!match) return;
      match.handover = false;
      hideHandover();
      updateKeeperControls();
      startTimer();
    }, CONFIG.handoverMs);
  } else {
    hideHandover();
    startTimer();
  }
  updateKeeperControls();
  updateHud();
  updateBoard();
}

/** 交代のワンクッション（大きな文字で「次はあなたがキーパーです」） */
function showHandover(role, { first = false } = {}) {
  const overlay = $('#handover');
  const icon = $('#handover-icon');
  const title = $('#handover-title');
  const hint = $('#handover-hint');
  if (!overlay) return;
  if (icon) icon.textContent = role === 'shoot' ? '⚽' : '🧤';
  if (title) title.textContent = first
    ? t(role === 'shoot' ? 'turnShootBig' : 'turnKeepBig')
    : t(role === 'shoot' ? 'handoverShoot' : 'handoverKeep');
  if (hint) hint.textContent = t(role === 'shoot' ? 'handoverShootHint' : 'handoverKeepHint');
  if (match) match.lastHandover = { role, first, title: title ? title.textContent : '' };
  overlay.hidden = false;
  overlay.classList.add('is-show');
}

function hideHandover() {
  const overlay = $('#handover');
  if (!overlay) return;
  overlay.classList.remove('is-show');
  overlay.hidden = true;
}

/** キーパーの番だけ、3D画面の上に「左右に動かせる」領域を出す */
function updateKeeperControls() {
  const zone = $('#keeper-zone');
  const active = Boolean(match && match.role === 'keep' && !match.confirmed && !match.handover);
  if (zone) zone.hidden = !active;
  /* Build 5: 「映っている画面のままの向きで選ぶ」短い案内も、キーパーの番だけ出す */
  const hint = $('#dir-hint');
  if (hint) hint.hidden = !active;
}

function startTimer(remaining = CONFIG.roundSeconds * 1000) {
  if (!match) return;
  const duration = CONFIG.roundSeconds * 1000;
  const left0 = Math.max(1, Math.min(duration, remaining));
  match.deadline = performance.now() + left0;
  match.pausedAt = 0;
  let lastSecond = Math.ceil(left0 / 1000) + 1;
  const step = () => {
    if (!match || match.confirmed) return;
    const left = Math.max(0, match.deadline - performance.now());
    updateTimer(left, duration);
    const second = Math.ceil(left / 1000);
    if (second !== lastSecond) {
      lastSecond = second;
      if (second <= 3 && second > 0) countdownTick(second === 1);
    }
    if (left <= 0) {
      autoPick();
      return;
    }
    match.timerId = requestAnimationFrame(step);
  };
  match.timerId = requestAnimationFrame(step);
}

/** アプリを離れるとき、ラウンドの時計を止める（戻ったら残り時間から再開） */
function pauseRound() {
  if (!match || match.confirmed || match.pausedAt) return false;
  match.pausedAt = performance.now();
  cancelAnimationFrame(match.timerId);
  return true;
}

function resumeRound() {
  if (!match || match.confirmed || !match.pausedAt) return false;
  const left = Math.max(0, (match.deadline || 0) - match.pausedAt);
  match.pausedAt = 0;
  if (match.handover) return false;
  startTimer(left > 0 ? left : 1);
  return true;
}

function updateTimer(left, duration) {
  const fill = $('#timer-fill');
  const text = $('#timer-text');
  const timer = $('#timer');
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, (left / duration) * 100))}%`;
  if (text) text.textContent = `${t('timeLeft')} ${Math.max(0, Math.ceil(left / 1000))}s`;
  if (timer) timer.classList.toggle('is-urgent', left > 0 && left < 3000);
}

function stopRound() {
  if (match) cancelAnimationFrame(match.timerId);
  clearTimeout(nextTimer);
  nextTimer = null;
  clearTimeout(handoverTimer);
  handoverTimer = null;
  hideHandover();
}

function selectDirection(dir) {
  if (!match || match.confirmed || !DIRECTIONS.includes(dir)) return;
  match.selection = dir;
  $$('.zone').forEach((button) => {
    const on = button.dataset.dir === dir;
    button.classList.toggle('is-selected', on);
    button.setAttribute('aria-pressed', String(on));
  });
  const confirmButton = $('#confirm');
  if (confirmButton) confirmButton.disabled = false;
  selectSound();
}

function showBanner(kind) {
  const banner = $('#banner');
  if (!banner) return;
  const miss = kind === 'miss';
  banner.hidden = false;
  banner.textContent = miss ? t('missKick') : t(kind === 'goal' ? 'goal' : 'save');
  banner.className = `banner is-show ${miss ? 'is-miss' : kind === 'goal' ? 'is-goal' : 'is-save'}`;
}

function setKickStatus(text, kind = '') {
  const status = $('#kick-status');
  if (!status) return;
  status.textContent = text;
  status.dataset.kind = kind;
}

function confirmKick() {
  if (!match || match.confirmed || !match.selection) return;
  resolveRound(match.selection, { timeout: false });
}

/**
 * 8秒たっても決めていなければ、自動で選ばない。
 * 蹴る番なら枠外へ（MISS KICK）、キーパーの番なら動けず失点。
 */
function autoPick() {
  if (!match || match.confirmed) return;
  resolveRound(match.selection || null, { timeout: true });
}

/** 3D画面のキーパーを左右に動かす（止める方向の決定とは別の駆け引き） */
function setKeeperFromClientX(clientX) {
  const stage = $('#stage');
  if (!stage || !stadium || !match || match.role !== 'keep' || match.confirmed) return;
  const ratio = ratioFromClientX(clientX, stage.getBoundingClientRect());
  /*
   * Build 7: キーパー視点はゴール裏からキッカーを見ているので、画面の右はワールド -X。
   * 指を右へ動かしたらキーパーも画面の右へ動くよう、ここで符号を反転する。
   * 送る値（match.keeperX）はワールド座標のオフセットのままなので、
   * キッカー側の画面では同じゴールポスト側に相手キーパーが見える。
   */
  const value = keeperOffsetFromRatio(ratio);
  match.keeperX = value;
  stadium.setKeeperOffset(value);
  if (match.online && session) session.sendKeeper(value);
}

function attachKeeperDrag() {
  const zone = $('#keeper-zone');
  if (!zone) return;
  let dragging = false;
  zone.addEventListener('pointerdown', (event) => {
    if (!match || match.role !== 'keep' || match.confirmed) return;
    dragging = true;
    zone.setPointerCapture?.(event.pointerId);
    setKeeperFromClientX(event.clientX);
    event.preventDefault();
  });
  zone.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    setKeeperFromClientX(event.clientX);
    event.preventDefault();
  });
  const end = (event) => {
    if (!dragging) return;
    dragging = false;
    if (match && match.online && session) session.sendKeeper(match.keeperX, { force: true });
    zone.releasePointerCapture?.(event.pointerId);
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

function resolveRound(dir, { timeout }) {
  if (!match || match.confirmed) return;
  match.confirmed = true;
  cancelAnimationFrame(match.timerId);
  hideHandover();
  updateKeeperControls();
  $('#confirm') && ($('#confirm').disabled = true);
  $$('.zone').forEach((button) => { button.disabled = true; });
  updateTimer(0, CONFIG.roundSeconds * 1000);

  const role = match.role || currentRole();
  const picked = isDirection(dir) ? dir : null;
  /*
   * Build 7: 時間切れの扱い。
   *   ・方向を選んでいたなら、決定を押し忘れていても「その方向へ普通に蹴る／飛ぶ」
   *   ・何も選んでいなかったときだけ、蹴る側は枠外（MISS）・キーパーは動けない（stuck）
   */
  const choice = timeout && !picked
    ? timeoutChoice({ role, selection: null })
    : { dir: picked, auto: false, stuck: false };

  if (match.online) {
    if (!session || !session.matchName) {
      toast(t('connectionError'));
      return;
    }
    setKickStatus(t('waitingOpponent'));
    match.waitingOpponent = true;
    const round = match.state.history.length;
    /*
     * キーパーの画面はキッカーと向かい合う（左右が反転する）ので、押したボタンの位置へ
     * 飛べるよう、送る前に反転してゴール基準の方向にそろえる。
     * 時間切れで動けなかったキーパーは、MISS を「飛ばない」の合図として送る
     * （相手側では必ず失点になる）。
     */
    const wire = choice.stuck
      ? MISS
      : (picked ? (role === 'keep' ? mirrorDirection(picked) : picked) : MISS);
    const sent = session.pick(round, wire, { timeout: choice.auto });
    if (!sent) {
      /* すでに相手の手が届いていて、この端末では解決済みの可能性 */
      setKickStatus('');
    }
    return;
  }

  if (role === 'shoot') {
    /* 時間切れで何も選んでいなければ枠外へ蹴る（自動でコースを選ばない） */
    const shot = picked || (choice.auto ? MISS : randomDirection());
    applyKick(shot, match.cpuDir, { timeout: choice.auto });
  } else {
    /* キーパー: 選んでいればその方向へ飛ぶ。何も選んでいなければ動けない */
    const save = picked ? mirrorDirection(picked) : null;
    applyKick(match.cpuDir, save, { timeout: choice.auto, stuck: choice.stuck });
  }
}

function applyKick(shot, save, { timeout = false, stuck = false } = {}) {
  if (!match) return;
  const round = match.state.history.length;
  if (match.applied > round) return;
  const next = resolveKick(match.state, { shot, save, timeout, stuck });
  match.state = next;
  match.applied = next.history.length;
  const event = next.history.at(-1);
  const role = match.role || currentRole();
  const foot = kickerInfo(event.side, event.kicker, event.index).foot;

  /* Build 4: 自分が蹴った方向を数える（「戦績」のキック傾向） */
  if (role === 'shoot' && event.side === 'me' && DIRECTIONS.includes(event.shot)) {
    shots = addShotDirection(shots, event.shot);
    saveShots(storage, shots);
  }

  match.selection = null;
  match.confirmed = true;
  const roundId = match.roundId;
  const bannerKind = event.miss ? 'miss' : (event.goal ? 'goal' : 'save');

  /*
   * Build 4（最重要）: 蹴り始めに分かるのは「自分が選んだボタン」だけ。
   * 相手の方向（is-cpu）・結果テキスト・HUDスコア・PK表・バナーは、
   * ボールがゴールに届いた瞬間（onImpact）にまとめて出す。
   * 遅れて届いた演出で、次のラウンドを塗り替えないよう roundId で確認する。
   */
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    if (!match || match.roundId !== roundId || screen !== 'match') return;
    markReveal(event, role);
    /* スコアとPK表だけ更新する（キッカー表示は蹴った選手のまま残す） */
    updateHud({ chip: false });
    updateBoard();
    if (timeout) {
      setKickStatus(t(event.miss ? 'timeoutMiss' : event.stuck ? 'timeoutStuck' : 'timeoutMiss'));
    }
    showBanner(bannerKind);
    /* Build 7: CPU 戦なら、ときどき CPU からも軽いリアクションが返る */
    if (!match.online) maybeCpuEmote(event);
  };

  if (timeout) setKickStatus(t(event.miss ? 'timeoutMiss' : event.stuck ? 'timeoutStuck' : 'timeoutMiss'));

  /* 判定の演出音（ゴール/セーブ/ミス）は着弾に合わせて鳴らす。
     Build 6: 棒読みの読み上げは廃止し、スタジアムホーン＋ファンファーレ／
     観客のどよめき／落胆のため息で盛り上げる（audio.js の voice）。 */
  const announce = () => {
    voice(bannerKind);
  };

  let animation = null;
  if (stadium) {
    animation = stadium.kick({
      shot: event.shot,
      save: event.save || 'CENTER',
      goal: event.goal,
      kicker: event.kicker,
      role,
      footed: foot,
      stuck: Boolean(event.stuck),
      onImpact: (kind) => {
        if (kind === 'kick') kickSound();
        if (kind === 'goal') { netSound(); goalRoar(2.4); crowdSurge(1.1); }
        /* セーブは gloveSound（グローブの当たり）＋ voice('save')（どよめきとクリア音） */
        if (kind === 'save') { gloveSound(); }
        /* ミスキックはボールが枠外へ流れる音＋ voice('miss')（観客の落胆） */
        if (kind === 'miss') { netSound(); }
        if (kind === 'goal' || kind === 'save' || kind === 'miss') {
          announce();
          reveal();
        }
      },
    });
  } else {
    kickSound();
    setTimeout(() => {
      if (event.goal) { netSound(); goalRoar(2.2); }
      else if (event.miss) netSound();
      else gloveSound();
      announce();
      reveal();
    }, 300);
  }

  const token = next.history.length;
  const finish = () => {
    /* すでに次のキックへ進んでいた／別の画面へ移った場合は、遅れて届いた演出で進めない */
    if (!match || screen !== 'match' || match.roundId !== roundId || match.state.history.length !== token) return;
    /* 検証（スクショ）用に時計を止めている間は、自動で次のキックへ進まない */
    if (match.hold) return;
    const nextBtn = $('#next-kick');
    if (nextBtn) nextBtn.hidden = false;
    nextTimer = setTimeout(() => nextRound(), 1500);
  };
  if (animation && typeof animation.then === 'function') animation.then(finish);
  else setTimeout(finish, 1150);
}

function markReveal(event, role) {
  /* キーパーの画面はキッカーと向かい合う（左右反転）。ボールが行った側のボタンを光らせる */
  const viewShot = event.miss ? null : shownDirection(event.shot, role);
  const viewSave = event.save ? shownDirection(event.save, role) : null;
  $$('.zone').forEach((button) => {
    const dir = button.dataset.dir;
    if (event.miss) {
      if (dir === viewSave) button.classList.add('is-cpu');
      return;
    }
    if (event.goal) {
      if (dir === viewShot) button.classList.add('is-selected');
    } else {
      if (dir === viewSave) button.classList.add('is-cpu');
      if (dir === viewShot) button.classList.add('is-selected');
    }
  });
  const status = $('#kick-status');
  if (status) {
    const shotName = event.miss ? t('outOfFrame') : t(`zone_${viewShot}`);
    const saveName = event.stuck ? t('noDive') : (viewSave ? t(`zone_${viewSave}`) : t('noDive'));
    status.textContent = role === 'shoot'
      ? `${t('you')}: ${shotName} / ${t('opponent')}: ${saveName}`
      : `${t('opponent')}: ${shotName} / ${t('you')}: ${saveName}`;
  }
}

function nextRound() {
  clearTimeout(nextTimer);
  nextTimer = null;
  if (!match || screen !== 'match') return;
  if (match.state.winner) {
    finishMatch();
    return;
  }
  beginRound();
}

function finishMatch() {
  if (!match) return;
  const state = match.state;
  const goals = state.score.me;
  const conceded = state.score.opp;
  const saves = state.kicks.opp.filter((goal) => !goal).length;
  const shots = state.kicks.me.length;
  const sudden = state.kicks.me.length > CONFIG.kickers || state.kicks.opp.length > CONFIG.kickers;
  if (match.online) {
    /* 通信対戦は「PRO 通信対戦 通算」へ別枠で記録（CPU戦績には足さない） */
    record = addOnlineResult(record, { winner: state.winner, goals, conceded, sudden });
    /* IPKSF ランキング（Build 4）: 勝ち点 3/2/1/0 を累積・月間・週間に積む */
    standing = recordStanding(storage, standing, { winner: state.winner, goals, conceded, sudden });
  } else {
    record = addResult(record, { winner: state.winner, goals, conceded, saves, shots, sudden });
  }
  saveRecord(storage, record);
  stopRound();
  disposeStadium();
  stopCrowd();
  screen = 'result';
  render();
  /* Build 8: 決着の華やかな締め（勝ちはファンファーレ＋大歓声、負けは小さな反応） */
  champion({ win: state.winner === 'me' });
}

function quitMatch() {
  if (!match) {
    go('home');
    return;
  }
  if (match.state.winner) {
    finishMatch();
    return;
  }
  askConfirm(t('quitConfirm'), () => {
    stopRound();
    disposeStadium();
    stopCrowd();
    if (match.online && session) session.leave();
    match = null;
    online.searching = false;
    online.opponent = null;
    go('home');
  });
}

function updateHud({ chip = true } = {}) {
  if (!match) return;
  const me = $('#hud-me');
  const opp = $('#hud-opp');
  const phaseLabel = $('#hud-phase');
  if (me) me.textContent = String(match.state.score.me);
  if (opp) opp.textContent = String(match.state.score.opp);
  if (phaseLabel) {
    phaseLabel.textContent = phase(match.state) === 'sudden'
      ? t('suddenDeath')
      : (match.state.first === 'me' ? t('firstKick') : t('secondKick'));
  }
  const kickerChip = $('#kicker-chip');
  if (kickerChip && chip) {
    const role = currentRole();
    const side = role === 'shoot' ? 'me' : 'opp';
    const number = kickerNumber(match.state, side);
    const info = kickerInfo(side, number, match.state.history.length);
    kickerChip.textContent = `${t('kicker')} ${number} · ${info.name} · ${t(info.foot === 'left' ? 'footLeft' : 'footRight')}`;
  }
}

function updateBoard() {
  if (!match) return;
  const me = $('[data-testid="pk-me"]');
  const opp = $('[data-testid="pk-opp"]');
  if (me) me.innerHTML = pkCellList(match.state, 'me', t);
  if (opp) opp.innerHTML = pkCellList(match.state, 'opp', t);
}

/* ------------------------------------------------------------------ *\
 * 通信対戦
 * ------------------------------------------------------------------ */

function ensureSession() {
  if (session) return session;
  const config = onlineConfig();
  client = new RealtimeClient({ url: config.url, key: config.key });
  session = new ShootoutSession({
    client,
    onEvent: (event) => handleOnlineEvent(event),
  });
  return session;
}

function onlineProfile() {
  return {
    nickname: (prefs.nickname || registration.userName || registration.teamName || 'PLAYER').slice(0, 12),
    /* 世界戦・世界ランキングは登録した代表国で戦う（国内・フリーは普段の国） */
    countryCode: online.scope === 'world' ? officialCountry(registration, prefs.country) : prefs.country,
    pro: entitled,
    level: prefs.level,
  };
}

function handleOnlineEvent(event) {
  switch (event.type) {
    case 'waiting':
      online.searching = true;
      if (screen === 'online') {
        const status = $('.searching p');
        if (status) status.innerHTML = `${esc(t('searching'))}<span class="dots"><i></i><i></i><i></i></span>`;
      }
      break;
    case 'paired': {
      online.opponent = event.opponent;
      online.searching = false;
      online.status = '';
      if (screen === 'online') render();
      setTimeout(() => {
        if (online.opponent && screen === 'online') startMatch({ onlineMatch: true });
      }, 1100);
      break;
    }
    case 'opponent-info':
      online.opponent = { ...online.opponent, ...event.opponent };
      break;
    case 'opponent-pick':
      if (match && match.online && !match.confirmed) setKickStatus(`${t('opponent')} ✓`);
      break;
    case 'kick':
      if (match && match.online) {
        match.role = event.shooterSide === 'me' ? 'shoot' : 'keep';
        match.waitingOpponent = false;
        applyKick(event.shot, event.save, { stuck: Boolean(event.stuck) });
      }
      break;
    case 'opponent-keeper':
      if (match && match.online && stadium) {
        match.opponentKeeperX = event.x;
        stadium.setRemoteKeeperOffset(event.x);
      }
      break;
    case 'stamp':
      showEmote(event.id, { mine: false });
      break;
    case 'opponent-left':
      toast(t('opponentLeft'));
      if (match && match.online) {
        setTimeout(() => {
          if (match) {
            stopRound();
            disposeStadium();
            stopCrowd();
            match = null;
            online.opponent = null;
            online.status = t('opponentLeft');
            go('online');
          }
        }, 1400);
      }
      break;
    case 'timeout':
      online.status = t('searching');
      if (screen === 'online') {
        online.searching = false;
        render();
      }
      break;
    case 'error':
      online.searching = false;
      online.status = event.reason === 'pro-world' ? t('onlineProRequired') : t('connectionError');
      if (screen === 'online') render();
      break;
    case 'rank':
      rankRows = event.rows || [];
      rankStatus = rankRows.length ? '' : t('noRankData');
      if (screen === 'rank') render();
      break;
    default:
      break;
  }
}

function openQuick() {
  if (!onlineConfigured()) {
    online.status = t('onlineNotConfigured');
    render();
    return;
  }
  if (online.scope === 'world' && !entitled) {
    online.status = t('onlineProRequired');
    render();
    return;
  }
  ensureSession();
  session.quickMatch({ scope: online.scope, country: onlineProfile().countryCode, profile: onlineProfile() });
  online.searching = true;
  online.opponent = null;
  online.status = '';
  online.code = '';
  render();
}

function createRoom() {
  if (!entitled) {
    online.status = t('proLocked');
    render();
    return;
  }
  if (!onlineConfigured()) {
    online.status = t('onlineNotConfigured');
    render();
    return;
  }
  const code = randomCode();
  online.code = code;
  ensureSession();
  session.joinRoom({ code, profile: onlineProfile() });
  online.searching = true;
  online.opponent = null;
  online.status = '';
  render();
}

function joinRoom(codeInput) {
  if (!entitled) {
    online.status = t('proLocked');
    render();
    return;
  }
  if (!onlineConfigured()) {
    online.status = t('onlineNotConfigured');
    render();
    return;
  }
  const code = normalizeCode(codeInput);
  if (!isValidCode(code)) {
    online.status = t('enterCode');
    render();
    return;
  }
  online.code = code;
  ensureSession();
  session.joinRoom({ code, profile: onlineProfile() });
  online.searching = true;
  online.opponent = null;
  online.status = '';
  render();
}

function cancelSearch() {
  if (session) session.leave({ bye: false });
  online.searching = false;
  online.opponent = null;
  online.status = '';
  render();
}

function leaveOnlineMatch() {
  if (session) session.leave();
  stopRound();
  disposeStadium();
  stopCrowd();
  match = null;
  online.opponent = null;
  online.searching = false;
  go('online');
}

function refreshStandingPeriods(date = new Date()) {
  const { standing: rolled, changed } = rollStanding(standing, date);
  if (changed) {
    standing = rolled;
    saveStanding(storage, standing);
  }
  return standing;
}

function myRankRow() {
  const country = officialCountry(registration, prefs.country);
  const current = refreshStandingPeriods();
  const base = emptyRow({
    id: rankId(),
    nickname: registration.userName || registration.teamName || prefs.nickname || countryName(country, prefs.language),
    countryCode: country,
  }, new Date(), Date.now());
  return {
    ...base,
    total: { ...current.total },
    month: { ...current.month },
    week: { ...current.week },
    updatedAt: Date.now(),
  };
}

function rankId() {
  const key = 'shootout4.rankid';
  let id = storage.getItem(key);
  if (!id) {
    id = `s4${Math.random().toString(36).slice(2, 10)}`;
    try {
      storage.setItem(key, id);
    } catch {
      /* private mode */
    }
  }
  return id;
}

function openRank() {
  go('rank');
  if (!entitled) return;
  refreshRank();
}

/** ランキングの通信を（選択中の世界/国内で）開き直す */
function refreshRank() {
  if (!entitled) return;
  if (!onlineConfigured()) {
    rankStatus = t('onlineNotConfigured');
    if (screen === 'rank') render();
    return;
  }
  ensureSession();
  rankNet?.close();
  rankNet = new RankingNet({
    client,
    onRows: (rows) => {
      rankRows = rows;
      rankStatus = rows.length ? '' : t('noRankData');
      if (screen === 'rank') render();
    },
    backend: storage,
  });
  rankRows = rankNet.cached();
  rankNet.open({ scope: online.scope, row: myRankRow() });
  rankStatus = rankRows.length ? '' : t('searching');
  if (screen === 'rank') render();
}

/* ------------------------------------------------------------------ *\
 * 結果のシェア（Build 9）
 *   720×900 の結果カード（PNG）＋文面を共有する。
 *     1. navigator.share({ files: [png], title, text })   … 画像＋文面（iOS 15+ など）
 *     2. navigator.share({ title, text })                  … 画像が使えない環境・失敗時
 *     3. クリップボードへコピー（＋PC では PNG を保存）
 *     4. どれも無理なら文面をトーストで見せる
 *   途中で何が起きてもエラーで止まらない（キャンセルだけは静かに終わる）。
 * ------------------------------------------------------------------ */

/** 結果カード（PNG の Blob と File）。作れなければ null */
async function buildResultCard() {
  if (!match) return null;
  try {
    const date = new Date();
    const model = buildResultCardModel({
      state: match.state,
      prefs,
      language: prefs.language,
      t,
      standing,
      record,
      online: Boolean(match.online),
      date,
    });
    const { blob } = await renderResultCard(model);
    if (!blob) return null;
    return { model, blob, file: resultCardFile(blob, date) };
  } catch {
    return null;
  }
}

/** 画像をファイルとして保存できる環境か（タッチ端末では保存UIに任せ、PCだけ落とす） */
function canDownloadFile() {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return false;
  return !(Number(navigator.maxTouchPoints) > 0);
}

function downloadBlob(blob, name) {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}

/** カードの中身が変わる条件（言語・国・スコア・勝敗・勝ち点）。変わったら作り直す */
function resultCardSignature() {
  if (!match) return '';
  const state = match.state;
  return JSON.stringify({
    language: prefs.language,
    country: prefs.country,
    opponent: prefs.opponent,
    online: Boolean(match.online),
    kicks: [state.kicks.me.length, state.kicks.opp.length],
    score: [state.score.me, state.score.opp],
    winner: state.winner,
    points: standing && standing.total ? standing.total.points : null,
    record: record ? [record.wins, record.losses, record.played] : null,
  });
}

/** 結果カードを（まだ無ければ）作る。共有タップ時は、ほぼ待たずに File が返る */
function prepareResultCard() {
  if (!match) return Promise.resolve(null);
  const signature = resultCardSignature();
  if (resultCardCache && resultCardCache.signature === signature) return resultCardCache.promise;
  const promise = buildResultCard();
  resultCardCache = { signature, promise };
  return promise;
}

async function shareResult() {
  if (!match) return 'none';
  const text = buildShareText({ t, state: match.state, prefs, language: prefs.language });
  const title = `${CONFIG.title} · ${CONFIG.brand}`;
  const card = await prepareResultCard();
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  const hasShare = typeof nav.share === 'function';
  let canShareFiles = false;
  if (hasShare && card && card.file) {
    try {
      canShareFiles = typeof nav.canShare !== 'function' || Boolean(nav.canShare({ files: [card.file] }));
    } catch {
      canShareFiles = false;
    }
  }
  const plan = pickShareStrategy({
    hasShare,
    hasFiles: Boolean(card && card.file),
    canShareFiles,
    hasClipboard: Boolean(nav.clipboard && typeof nav.clipboard.writeText === 'function'),
    canDownload: canDownloadFile(),
  });

  let copied = false;
  let downloaded = false;
  for (const step of plan) {
    try {
      if (step === 'share-image') {
        await nav.share({ files: [card.file], title, text });
        return 'shared-image';
      }
      if (step === 'share-text') {
        await nav.share({ title, text });
        return 'shared-text';
      }
      if (step === 'clipboard') {
        await nav.clipboard.writeText(text);
        copied = true;
        continue;
      }
      if (step === 'download' && card) {
        downloaded = downloadBlob(card.blob, card.file && card.file.name ? card.file.name : 'shootout4-result.png');
        continue;
      }
    } catch (error) {
      /* キャンセルはそのまま静かに終わる。ほかの失敗は次の手段へ */
      if (error && error.name === 'AbortError') return 'cancelled';
    }
  }

  if (copied) {
    toast(t('copied'));
    return 'copied';
  }
  if (downloaded) return 'saved';
  toast(text);
  return 'shown';
}

/* ------------------------------------------------------------------ *\
 * 課金
 * ------------------------------------------------------------------ */

async function buyPro() {
  proStatus = '';
  const result = await purchase();
  if (result.status === 'success') {
    entitled = true;
    skin = effectiveSkin(skin, entitled);
    proStatus = t('proMember');
    purchaseChime(true);
    render();
  } else if (result.status === 'cancelled') {
    proStatus = '';
    render();
  } else {
    proStatus = result.status === 'pending' ? t('proPending') : t('proFailed');
    proDiagState = iapDiagnostic();
    purchaseChime(false);
    render();
  }
}

async function restorePro() {
  const result = await restore();
  entitled = result.status === 'restored' ? true : entitled;
  skin = effectiveSkin(skin, entitled);
  proStatus = result.status === 'restored' ? t('proRestored') : t('proNothing');
  proDiagState = iapDiagnostic();
  purchaseChime(result.status === 'restored');
  render();
}

/* ------------------------------------------------------------------ *\
 * 設定・保存
 * ------------------------------------------------------------------ */

function updatePrefs(patch, { rerender = true } = {}) {
  prefs = { ...prefs, ...patch };
  persist();
  applyTheme();
  if (screen === 'match' && stadium && 'night' in patch) stadium.setNight(prefs.night);
  if (rerender) render();
}

function saveLocker() {
  try {
    skin = saveSkin(storage, entitled, draft);
    draft = { ...skin };
    const status = $('#locker-status');
    if (status) status.textContent = t('saved');
    toast(t('saved'));
    selectSound();
  } catch {
    const status = $('#locker-status');
    if (status) status.textContent = t('proLocked');
  }
}

/* ------------------------------------------------------------------ *\
 * 選手登録
 * ------------------------------------------------------------------ */

function openRegister({ next = 'locker', back = null, world = false } = {}) {
  registerDraft = {
    ...registration,
    teammates: registration.teammates.map((item) => ({ ...item })),
  };
  if (!registerDraft.userName) registerDraft.userName = prefs.nickname || '';
  if (!registerDraft.language) registerDraft.language = prefs.language;
  registerNext = next;
  registerBack = back || (screen === 'settings' ? 'settings' : 'locker');
  if (world) toast(t('registerForWorld'));
  go('register');
}

function saveRegistration() {
  const next = normalizeRegistration(registerDraft);
  const status = $('#register-status');
  if (!next.userName.trim()) {
    if (status) status.textContent = t('registerRequired');
    return;
  }
  registration = writeRegistration(storage, next);
  registerDraft = { ...registration, teammates: registration.teammates.map((item) => ({ ...item })) };
  if (registration.language && registration.language !== prefs.language) {
    prefs = { ...prefs, language: registration.language };
    persist();
    applyTheme();
  }
  if (registration.country && !isCountryUnlocked(prefs.country, entitled)) {
    prefs = { ...prefs, country: registration.country };
    persist();
  }
  toast(t('registerSaved'));
  selectSound();
  const back = registerNext === 'online' ? 'online' : registerBack;
  registerNext = 'locker';
  go(back);
  render();
}

/* ------------------------------------------------------------------ *\
 * オープニング・トースト・確認
 * ------------------------------------------------------------------ */

function showOpening(withAudio = false) {
  closeOpening();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = openingView({ t });
  const overlay = wrapper.firstElementChild;
  document.body.append(overlay);
  let audioStarted = withAudio;
  const started = performance.now();
  if (withAudio) openingCrowd(CONFIG.openingMs / 1000);
  const soundButton = overlay.querySelector('[data-intro="sound"]');
  if (soundButton) soundButton.hidden = withAudio || !prefs.sound;
  const close = () => closeOpening();
  overlay.addEventListener('click', async (event) => {
    if (event.target.closest('[data-intro="sound"]')) {
      await unlockAudio();
      configureAudio(prefs);
      if (!overlay.isConnected || audioStarted) return;
      audioStarted = true;
      soundButton.hidden = true;
      openingCrowd(Math.max(0.4, (CONFIG.openingMs - (performance.now() - started)) / 1000));
      return;
    }
    close();
  });
  setTimeout(close, CONFIG.openingMs);
}

function closeOpening() {
  const overlay = document.querySelector('.opening');
  if (!overlay) return;
  overlay.classList.add('is-closing');
  setTimeout(() => overlay.remove(), 320);
}

function toast(text) {
  const element = $('#toast');
  if (!element) return;
  element.textContent = text;
  element.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('is-show'), 2000);
}

/**
 * スタンプ・定型文の吹き出し（Build 7）。
 * 送るのは id だけなので、表示は受け取った側の言語で行う。
 * 新しいものが来たら差し替え、2.6秒で消す（上部の小さな吹き出しなので画面を塞がない）。
 */
let emoteTimer = null;
/** hold（検証用）を指定すると自動では消さない（スクリーンショット用） */
function showEmote(id, { mine = false, hold = 0 } = {}) {
  const emote = emoteById(id);
  if (!emote) return null;
  const bubble = $('#emote-bubble');
  if (!bubble) return null;
  const text = t(emote.key);
  const face = $('#emote-bubble-face');
  const label = $('#emote-bubble-text');
  const who = $('#emote-bubble-who');
  if (face) face.textContent = emote.face;
  if (label) label.textContent = text;
  if (who) who.textContent = t(mine ? 'you' : 'opponent');
  bubble.dataset.mine = mine ? 'true' : 'false';
  bubble.dataset.emote = emote.id;
  bubble.hidden = false;
  bubble.classList.remove('is-show');
  void bubble.offsetWidth;
  bubble.classList.add('is-show');
  clearTimeout(emoteTimer);
  emoteTimer = hold ? null : setTimeout(() => {
    bubble.hidden = true;
    bubble.classList.remove('is-show');
  }, 2600);
  if (match) match.lastEmote = { id: emote.id, text, mine };
  return { id: emote.id, face: emote.face, text, mine };
}

/** スタンプ・定型文のトレイを開く／閉じる */
function toggleEmoteTray(force) {
  const tray = $('#emote-tray');
  const button = $('#emote-btn');
  if (!tray) return false;
  const open = force === undefined ? tray.hidden : Boolean(force);
  tray.hidden = !open;
  button?.setAttribute('aria-expanded', String(open));
  return open;
}

/** トレイの1つを押したとき: 自分の吹き出しを出し、通信戦なら相手へ送る */
function sendEmote(id) {
  const emote = emoteById(id);
  if (!emote) return null;
  selectSound();
  const shown = showEmote(id, { mine: true });
  if (match && match.online && session && session.matchName) session.sendStamp(id);
  toggleEmoteTray(false);
  return shown;
}

/**
 * CPU 戦のときだけ、たまに CPU からも軽いリアクションを返す（試し押ししやすくする）。
 * event は今の1本の結果、role は自分の役割。
 */
function maybeCpuEmote(event) {
  if (!match || match.online || !event) return null;
  const kind = event.miss
    ? 'iMiss'
    : event.side === 'me'
      ? (event.goal ? 'conceded' : 'cpuSave')
      : (event.goal ? 'cpuGoal' : 'iSaved');
  const id = cpuEmoteFor(kind);
  if (!id) return null;
  const roundId = match.roundId;
  setTimeout(() => {
    if (!match || screen !== 'match' || match.roundId !== roundId) return;
    showEmote(id, { mine: false });
  }, 900);
  return id;
}

function askConfirm(message, onYes) {
  pendingConfirm = onYes;
  const sheet = document.createElement('div');
  sheet.className = 'modal';
  sheet.innerHTML = `<div class="modal__card" role="dialog" aria-modal="true">
    <p class="modal__text">${esc(message)}</p>
    <div class="modal__actions">
      <button class="btn btn--ghost" data-modal="no">${esc(t('cancel'))}</button>
      <button class="btn btn--danger" data-modal="yes">${esc(t('confirm'))}</button>
    </div>
  </div>`;
  document.body.append(sheet);
  sheet.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-modal]')?.dataset.modal;
    if (!choice) {
      if (event.target === sheet) { sheet.remove(); pendingConfirm = null; }
      return;
    }
    sheet.remove();
    const action = pendingConfirm;
    pendingConfirm = null;
    if (choice === 'yes' && action) action();
  });
}

/* ------------------------------------------------------------------ *\
 * 試合中の音・設定・アプリの出入り
 * ------------------------------------------------------------------ */

/** 右上のスピーカーボタンの見た目を、いまの設定に合わせる */
function refreshSoundButton() {
  const button = $('[data-testid="match-sound"]');
  if (!button) return;
  const on = Boolean(prefs.sound || prefs.bgm);
  button.setAttribute('aria-pressed', String(on));
  button.innerHTML = icon(on ? 'sound' : 'soundOff');
}

/** 試合中に開く簡易設定（試合を中断しない） */
function openQuickSettings() {
  document.querySelector('[data-quick-settings]')?.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = quickSettingsView({ t, prefs });
  const sheet = wrapper.firstElementChild;
  if (!sheet) return;
  document.body.append(sheet);
  sheet.addEventListener('click', (event) => {
    if (event.target.closest('[data-quick="close"]') || event.target === sheet) {
      sheet.remove();
      return;
    }
    const toggle = event.target.closest('[data-quick-toggle]');
    if (!toggle) return;
    const key = toggle.dataset.quickToggle;
    const value = toggle.dataset.value === 'true';
    /* 試合を描き直すと3Dが作り直されるので、設定だけを当て直す */
    updatePrefs({ [key]: value }, { rerender: false });
    sheet.querySelectorAll(`[data-quick-toggle="${key}"]`).forEach((button) => {
      button.classList.toggle('is-on', (button.dataset.value === 'true') === value);
    });
    if (key !== 'vibrate') uiSwitch();
    refreshSoundButton();
  });
}

/**
 * ホームボタン・他アプリへ移ったら、音（BGM・歓声）とラウンドの時計を止める。
 * iPhone の Dynamic Island にスピーカー印が残り続ける問題の対策（Build 3）。
 */
function onAppHidden() {
  if (appHidden) return false;
  appHidden = true;
  pauseRound();
  suspendForBackground();
  document.documentElement.dataset.background = 'true';
  return true;
}

function onAppVisible() {
  if (!appHidden) return false;
  appHidden = false;
  resumeFromBackground({ crowd: screen === 'match' && Boolean(match) && !match.confirmed });
  if (prefs.sound || prefs.bgm) configureAudio(prefs);
  /*
   * Build 6: ここで ensureAudioRunning() を呼ばない。onAppVisible() は
   * visibilitychange / focus（ユーザージェスチャーではない）から発火するので、
   * needsGestureRecovery をここで消費してしまうと、戻って最初のタップで
   * AudioContext を作り直せず、BGM が鳴らないままになる。
   * 音の起こし直しは pointerdown / touchstart / keydown（本物の操作）でだけ行う。
   */
  resumeRound();
  document.documentElement.dataset.background = 'false';
  return true;
}

/* ------------------------------------------------------------------ *\
 * イベント
 * ------------------------------------------------------------------ */

async function boot() {
  applyTheme();
  render();
  localizeCountryName();
  showOpening(false);
  /* PROの状態はネイティブの StoreKit に聞き直す（答えが来るまで待たない） */
  if (iapMode() === 'store') {
    refreshEntitlement().then((value) => {
      if (value != null && value !== entitled) {
        entitled = value;
        render();
      }
      loadPrice().then((product) => {
        if (product) {
          proPrice = product.price;
          if (screen === 'pro') render();
        }
      });
    });
  }
  modelReady();
}

function localizeCountryName() {
  if (!COUNTRIES.some((country) => country.code === prefs.country)) prefs.country = 'JP';
  if (!isCountryUnlocked(prefs.country, entitled)) prefs.country = 'JP';
  if (!COUNTRIES.some((country) => country.code === prefs.opponent)) prefs.opponent = 'BR';
  if (!isCountryUnlocked(prefs.opponent, entitled)) prefs.opponent = pickOpponent(prefs.country, Math.random, { entitled }).code;
  if (!isCountryUnlocked(prefs.opponent, entitled)) prefs.opponent = 'BR';
}

function modelReady() {
  /* 画面の準備ができたことをテスト/デバッグ用に知らせる */
  window.__SHOOTOUT_READY__ = true;
  document.documentElement.dataset.screen = screen;
}

app.addEventListener('click', async (event) => {
  try {
  const zone = event.target.closest('button[data-dir]');
  if (zone) {
    unlockAudio();
    configureAudio(prefs);
    selectDirection(zone.dataset.dir);
    return;
  }
  const stamp = event.target.closest('button[data-emote]');
  if (stamp) {
    unlockAudio();
    sendEmote(stamp.dataset.emote);
    return;
  }
  if (event.target.closest('[data-action="emote-toggle"]')) {
    unlockAudio();
    toggleEmoteTray();
    uiSwitch();
    return;
  }
  const footButton = event.target.closest('button[data-foot]');
  if (footButton) {
    const player = Number(footButton.dataset.regPlayer);
    const foot = footButton.dataset.foot === 'left' ? 'left' : 'right';
    if (player === 1) {
      registerDraft.foot = foot;
    } else if (registerDraft.teammates[player - 2]) {
      registerDraft.teammates[player - 2] = { ...registerDraft.teammates[player - 2], foot };
    }
    selectSound();
    render();
    return;
  }
  const partTile = event.target.closest('button[data-part]');
  if (partTile && !partTile.dataset.action) {
    const part = partTile.dataset.part;
    if (part && isPartUnlocked(part, partTile.dataset.item, entitled)) {
      draft = normalizeSkin({ ...draft, [part]: partTile.dataset.item });
      selectSound();
      render();
    }
    return;
  }
  const characterTile = event.target.closest('button[data-character]');
  if (characterTile && !characterTile.dataset.action) {
    const id = characterTile.dataset.character;
    if (isCharacterUnlocked(id, entitled)) {
      draft = normalizeSkin({ ...draft, character: getCharacter(id).id });
      selectSound();
      render();
    }
    return;
  }
  const levelButton = event.target.closest('button[data-level]');
  if (levelButton) {
    updatePrefs({ level: levelButton.dataset.level });
    return;
  }
  const orderButton = event.target.closest('button[data-order]');
  if (orderButton) {
    const order = orderButton.dataset.order === 'second' ? 'second' : 'first';
    if (order !== prefs.order) uiSwitch();
    updatePrefs({ order });
    return;
  }
  const sizeButton = event.target.closest('button[data-size]');
  if (sizeButton) {
    updatePrefs({ size: sizeButton.dataset.size });
    return;
  }
  const nightButton = event.target.closest('button[data-night]');
  if (nightButton) {
    const night = nightButton.dataset.night === 'true';
    if (night !== prefs.night) uiSwitch();
    updatePrefs({ night });
    return;
  }
  const scopeButton = event.target.closest('button[data-scope]');
  if (scopeButton) {
    online.scope = scopeButton.dataset.scope;
    if (screen === 'rank') refreshRank();
    render();
    return;
  }
  const rankTabButton = event.target.closest('button[data-rank-tab]');
  if (rankTabButton) {
    const tab = rankTabButton.dataset.rankTab;
    if (TABS.includes(tab)) {
      online.rankTab = tab;
      uiSwitch();
      render();
    }
    return;
  }
  const toggle = event.target.closest('button[data-toggle]');
  if (toggle) {
    const key = toggle.dataset.toggle;
    const value = toggle.dataset.value === 'true';
    updatePrefs({ [key]: value });
    return;
  }
  const myCountry = event.target.closest('button[data-mycountry]');
  if (myCountry) {
    const code = myCountry.dataset.mycountry;
    if (!isCountryUnlocked(code, entitled)) {
      toast(t('proLocked'));
      go('pro');
      return;
    }
    const patch = { country: code };
    if (prefs.opponent === code) patch.opponent = pickOpponent(code, Math.random, { entitled }).code;
    updatePrefs(patch);
    return;
  }
  const opponent = event.target.closest('button[data-opponent]');
  if (opponent) {
    const code = opponent.dataset.opponent;
    if (!isCountryUnlocked(code, entitled)) {
      toast(t('proLocked'));
      go('pro');
      return;
    }
    updatePrefs({ opponent: code });
    return;
  }

  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  unlockAudio();
  configureAudio(prefs);

  switch (action) {
    case 'toggle-sound': {
      const on = !(prefs.sound || prefs.bgm);
      updatePrefs({ sound: on, bgm: on }, { rerender: false });
      refreshSoundButton();
      if (on) uiSwitch();
      toast(`${t('sound')} ${t(on ? 'on' : 'off')}`);
      break;
    }
    case 'match-settings':
      openQuickSettings();
      break;
    case 'settings':
      go('settings');
      break;
    case 'home':
      if (screen === 'match') { quitMatch(); break; }
      go('home');
      break;
    case 'country':
      go('country');
      break;
    case 'kickoff':
      click();
      startMatch({ onlineMatch: false });
      break;
    case 'random-opponent':
      updatePrefs({ opponent: pickOpponent(prefs.country, Math.random, { entitled }).code });
      break;
    case 'next':
      nextRound();
      break;
    case 'confirm':
      confirmKick();
      break;
    case 'quit':
      quitMatch();
      break;
    case 'rematch':
      startMatch({ onlineMatch: Boolean(match && match.online) });
      break;
    case 'locker':
      draft = { ...skin };
      go('locker');
      break;
    case 'save-skin':
      saveLocker();
      break;
    case 'register':
      openRegister({ next: 'locker' });
      break;
    case 'save-registration':
      saveRegistration();
      break;
    case 'sound-test':
      testSound();
      toast(t('soundTestDone'));
      break;
    case 'pro':
      proStatus = '';
      go('pro');
      break;
    case 'unlock':
      await buyPro();
      break;
    case 'restore':
      await restorePro();
      break;
    case 'rank':
      openRank();
      break;
    case 'share-result':
      await shareResult();
      break;
    case 'stats':
      go('stats');
      break;
    case 'rules':
      go('rules');
      break;
    case 'privacy':
      go('privacy');
      break;
    case 'replay-intro':
      showOpening(true);
      break;
    case 'reset-record':
      askConfirm(t('resetConfirm'), () => {
        /* CPU戦績だけを消す（PRO 通信対戦の通算は残す） */
        record = resetRecord(storage, record);
        render();
      });
      break;
    case 'reset-all':
      askConfirm(t('resetAllConfirm'), () => {
        record = { ...EMPTY_RECORD };
        saveRecord(storage, record);
        clearEntitlement();
        entitled = false;
        try {
          Object.keys(window.localStorage)
            .filter((key) => key.startsWith('shootout4.'))
            .forEach((key) => window.localStorage.removeItem(key));
        } catch {
          /* private mode */
        }
        prefs = loadPrefs(storage, deviceLanguages);
        standing = loadStanding(storage);
        shots = loadShots(storage);
        registration = { ...DEFAULT_REGISTRATION, teammates: DEFAULT_REGISTRATION.teammates.map((item) => ({ ...item })) };
        registerDraft = { ...registration, teammates: registration.teammates.map((item) => ({ ...item })) };
        skin = { ...DEFAULT_SKIN };
        draft = { ...skin };
        applyTheme();
        render();
      });
      break;
    case 'online':
      online = { ...online, mode: 'menu', searching: false, opponent: null, status: '' };
      go('online');
      break;
    case 'quick':
      if (online.scope === 'world' && !isRegistered(registration)) {
        openRegister({ next: 'online', world: true });
        break;
      }
      openQuick();
      break;
    case 'create-room':
      if (!isRegistered(registration)) {
        openRegister({ next: 'online' });
        break;
      }
      createRoom();
      break;
    case 'join-room': {
      const input = $('#room-code');
      joinRoom(input ? input.value : online.code);
      break;
    }
    case 'copy-code':
      try {
        await navigator.clipboard.writeText(online.code);
        toast(t('copied'));
      } catch {
        toast(online.code);
      }
      break;
    case 'cancel-search':
      cancelSearch();
      break;
    case 'online-start':
      startMatch({ onlineMatch: true });
      break;
    case 'online-leave':
      leaveOnlineMatch();
      break;
    default:
      break;
  }
  } catch (error) {
    /* 画面の不具合でアプリ全体を止めない（原因は開発時に console で見る） */
    console.warn('[shootout4] interaction failed', error && error.message ? error.message : error);
  }
});

/* 設定の select（言語・など） */
app.addEventListener('change', (event) => {
  const registrationSelect = event.target.closest('select[data-reg]');
  if (registrationSelect) {
    registerDraft[registrationSelect.dataset.reg] = registrationSelect.value;
    return;
  }
  const select = event.target.closest('select[data-pref]');
  if (!select) return;
  const key = select.dataset.pref;
  updatePrefs({ [key]: select.value });
});

/* 選手登録の入力（1行テキストのみ。改行・制御文字は保存時に落とす） */
app.addEventListener('input', (event) => {
  const field = event.target.closest('[data-reg]');
  if (field) {
    registerDraft[field.dataset.reg] = field.value;
    return;
  }
  const mate = event.target.closest('[data-reg-teammate]');
  if (mate) {
    const index = Number(mate.dataset.regTeammate);
    if (registerDraft.teammates[index]) {
      registerDraft.teammates[index] = { ...registerDraft.teammates[index], name: mate.value };
    }
  }
});

/* キーボード（1〜4 で方向、Enter で決定） */
document.addEventListener('keydown', (event) => {
  if (screen !== 'match' || !match || match.confirmed) return;
  if (/^[1-4]$/.test(event.key)) {
    event.preventDefault();
    selectDirection(DIRECTIONS[Number(event.key) - 1]);
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    confirmKick();
  }
});

/* Build 7: スタンプ・定型文のトレイは、外を触ったら閉じる */
document.addEventListener('pointerdown', (event) => {
  const tray = $('#emote-tray');
  if (!tray || tray.hidden) return;
  if (event.target.closest('#emote-tray') || event.target.closest('[data-action="emote-toggle"]')) return;
  toggleEmoteTray(false);
}, { capture: true });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) onAppHidden();
  else onAppVisible();
});
window.addEventListener('pagehide', onAppHidden);
window.addEventListener('pageshow', () => { if (!document.hidden) onAppVisible(); });
/*
 * Build 5: `blur` では止めない。共有シート・StoreKitの課金シート・
 * コントロールセンター・通知が開いただけで AudioContext を suspend してしまい、
 * 戻ったときに音が出なくなっていた。バックグラウンドは visibilitychange（document.hidden）
 * と pagehide、および Swift 側の applicationWillResignActive / applicationDidEnterBackground
 * で十分。`focus` は「隠れていたのに戻った」場合の保険として残す。
 */
window.addEventListener('focus', () => { if (!document.hidden) onAppVisible(); });

/*
 * Build 4: タップ・クリック・キー入力のたびに、AudioContext が suspend なら
 * resume する（バックグラウンドから戻って最初の操作で必ず音が戻る安全策）。
 */
['pointerdown', 'touchstart', 'keydown'].forEach((type) => {
  document.addEventListener(type, () => {
    if (!prefs.sound && !prefs.bgm) return;
    /* Build 6: 復帰後の最初の操作で AudioContext を作り直したら、試合中の歓声も張り直す */
    const rebuilt = ensureAudioRunning();
    if (rebuilt && prefs.sound && screen === 'match' && match && !match.confirmed) {
      startCrowd(getCountry(prefs.country));
    }
  }, { capture: true, passive: true });
});

/* デバッグ / 実ブラウザ検証用（画面には出さない） */
window.__SHOOTOUT__ = {
  version: CONFIG.version,
  build: CONFIG.build,
  roundSeconds: CONFIG.roundSeconds,
  get screen() { return screen; },
  get prefs() { return { ...prefs }; },
  get record() { return { ...record }; },
  get entitled() { return entitled; },
  get skin() { return { ...skin }; },
  get registration() {
    return registrationSummary(registration, {
      countryLabel: countryName(registration.country, prefs.language),
      languageName: prefs.language,
    });
  },
  get registrationRaw() {
    return { ...registration, teammates: registration.teammates.map((item) => ({ ...item })) };
  },
  register: (patch) => {
    registerDraft = normalizeRegistration({ ...registration, ...patch });
    saveRegistration();
    return { ...registration };
  },
  openRegister: (options) => openRegister(options || {}),
  saveRegistration: () => { saveRegistration(); return { ...registration }; },
  kickerFor: (side, number, round) => kickerInfo(side, number, round),
  keeperOffset: (x) => {
    if (!stadium) return 0;
    stadium.setKeeperOffset(x);
    if (match) match.keeperX = Number(x) || 0;
    return stadium.snapshot().keeperOffset;
  },
  /* Build 7: キーパーの左右（指の位置 → ワールドのオフセット）とスタンプ・定型文 */
  keeperRatio: (ratio) => keeperOffsetFromRatio(ratio),
  emote: (id, hold = false) => showEmote(id, { mine: true, hold: hold ? 600000 : 0 }),
  emoteIds: () => [...EMOTE_IDS],
  emoteSections: () => EMOTE_SECTIONS.map((section) => ({ ...section })),
  emoteText: (id) => {
    const emote = emoteById(id);
    return emote ? { id: emote.id, face: emote.face, text: t(emote.key) } : null;
  },
  emoteTray: (open) => toggleEmoteTray(open),
  emoteTexts: (language) => EMOTE_IDS.map((id) => {
    const emote = emoteById(id);
    return { id, face: emote.face, text: tr(isLanguage(language) ? language : prefs.language, emote.key) };
  }),
  cpuEmote: (kind) => cpuEmoteFor(kind, { chance: 1 }),
  get lastEmote() { return (match && match.lastEmote) || null; },
  remoteKeeperOffset: (x) => {
    if (!stadium) return 0;
    return stadium.setRemoteKeeperOffset(x);
  },
  previewHandover: (role = 'keep') => {
    showHandover(role === 'keep' ? 'keep' : 'shoot', { first: false });
    return true;
  },
  handover: () => {
    if (!match) return false;
    match.handover = false;
    clearTimeout(handoverTimer);
    hideHandover();
    updateKeeperControls();
    if (!match.deadline || match.deadline - performance.now() < 500) startTimer();
    return true;
  },
  timeoutNow: () => {
    if (!match || match.confirmed) return false;
    autoPick();
    return true;
  },
  get match() {
    if (!match) return null;
    return {
      online: match.online,
      role: match.role,
      first: match.state.first,
      selection: match.selection,
      confirmed: match.confirmed,
      winner: match.state.winner,
      score: { ...match.state.score },
      kicks: { me: [...match.state.kicks.me], opp: [...match.state.kicks.opp] },
      history: match.state.history.length,
      remainingMs: match.pausedAt
        ? Math.max(0, Math.round((match.deadline || 0) - match.pausedAt))
        : Math.max(0, Math.round((match.deadline || 0) - performance.now())),
      paused: Boolean(match.pausedAt),
      nextPending: Boolean(nextTimer),
      handoverHidden: Boolean(document.querySelector('#handover')?.hidden),
      phase: phase(match.state),
      handover: Boolean(match.handover),
      lastHandover: match.lastHandover || null,
      lastEvent: match.state.history.length ? { ...match.state.history.at(-1) } : null,
      keeperX: match.keeperX || 0,
      opponentKeeperX: match.opponentKeeperX || 0,
      lastEmote: match.lastEmote || null,
    };
  },
  get audio() { return audioState(); },
  /* Build 4: ランキング（勝ち点）とキック傾向（4択） */
  get standing() { return JSON.parse(JSON.stringify(standing)); },
  get shots() { return { ...shots }; },
  get shotTendency() { return shotSummary(shots); },
  get rankingTab() { return online.rankTab; },
  setRankTab: (tab) => {
    if (TABS.includes(tab)) {
      online.rankTab = tab;
      render();
    }
    return online.rankTab;
  },
  rank: (tab) => rankTable(rankRows, myRankRow(), { tab: tab || online.rankTab }),
  season: (tab) => seasonInfo(tab || online.rankTab, { language: prefs.language, t }),
  refreshRank: () => { refreshRank(); return rankRows.length; },
  shareText: () => (match ? buildShareText({ t, state: match.state, prefs, language: prefs.language }) : ''),
  share: () => shareResult(),
  /* Build 9: 結果カード（検証用にモデルと PNG を取り出せる） */
  cardModel: () => (match ? buildResultCardModel({
    state: match.state, prefs, language: prefs.language, t,
    standing, record, online: Boolean(match.online), date: new Date(),
  }) : null),
  cardPng: async () => {
    const card = await prepareResultCard();
    if (!card) return null;
    const dataUrl = await new Promise((resolve) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(card.blob);
      } catch {
        resolve('');
      }
    });
    return {
      type: card.blob.type,
      size: card.blob.size,
      name: card.file && card.file.name ? card.file.name : '',
      width: card.model.width,
      height: card.model.height,
      dataUrl,
    };
  },
  /* Build 6: 判定の演出音（音声の読み上げはなし）。返り値は { kind, mode: 'showcase' } */
  voice: (kind) => voice(kind || 'goal'),
  ensureAudio: () => ensureAudioRunning(),
  get preview() { return lockerPreview ? lockerPreview.snapshot() : { available: false }; },
  appHidden: (value) => (value ? onAppHidden() : onAppVisible()),
  mirror: (dir) => mirrorDirection(dir),
  get online() { return { ...online, configured: onlineConfigured() }; },
  get ranking() { return rankRows.map((row) => ({ ...row })); },
  stadium: () => (stadium ? stadium.snapshot() : { available: false }),
  hero: () => stadium && stadium.setHeroCamera(),
  hide: (what) => stadium && stadium.debugHide(what),
  cam: (pos, look) => {
    if (!stadium) return false;
    const THREE = stadium.scene.children[0].constructor;
    /* setCamera 相当: 外から渡した座標へ即座に動かす（検証用） */
    stadium.debugCamera(pos, look);
    return true;
  },
  debugScene: () => {
    if (!stadium) return null;
    return stadium.scene.children.map((child) => ({
      type: child.type,
      pos: child.position.toArray().map((v) => Number(v.toFixed(2))),
      visible: child.visible,
      name: child.name || '',
      children: child.children.length,
      mat: child.material ? (child.material.color ? `#${child.material.color.getHexString()}` : 'multi') : '',
    }));
  },
  setPrefs(patch) {
    updatePrefs(patch);
  },
  go,
  startMatch,
  finish: () => finishMatch(),
  skipOpening: () => closeOpening(),
  selectDirection,
  confirmKick,
  next: () => nextRound(),
  autoPick,
  settle: () => { clearTimeout(nextTimer); nextRound(); },
  /* スクリーンショット用: ラウンドの時計だけ止める（選択・決定はそのまま使える） */
  hold: () => {
    if (!match) return false;
    cancelAnimationFrame(match.timerId);
    clearTimeout(nextTimer);
    nextTimer = null;
    match.deadline = performance.now() + 600000;
    match.hold = true;
    return true;
  },
  texts: (key) => t(key),
  languages: LANGUAGES,
  languageNames: LANGUAGE_NAMES,
  countries: COUNTRIES.map((country) => country.code),
  freeCountries: COUNTRIES.filter((country) => !country.pro).map((country) => country.code),
  proCountries: COUNTRIES.filter((country) => country.pro).map((country) => country.code),
  productId: PRODUCT_ID,
};

boot();
