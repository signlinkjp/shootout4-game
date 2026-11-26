/**
 * SHOOTOUT 4 — アプリ本体（画面の切り替え・試合進行・通信・課金）
 *
 * 試合は「7秒＋決定」: 4方向から選び、決定で即座に結果。
 * CPUはラウンド開始時に方向を確定しているので、決定した瞬間に両者の手がそろう。
 */

import { CONFIG } from './config.js';
import { tr, detectLanguage, LANGUAGES, LANGUAGE_NAMES, isLanguage } from './i18n.js';
import {
  DIRECTIONS, newMatch, resolveKick, kickerNumber, phase, randomDirection, winRate,
} from './core/rules.js';
import { chooseCPU } from './core/cpu.js';
import { COUNTRIES, getCountry, pickOpponent, countryName } from './core/countries.js';
import {
  KITS, BOOTS, DEFAULT_SKIN, normalizeSkin, readSkin, saveSkin, isKitUnlocked, isBootUnlocked,
} from './core/skins.js';
import {
  openStorage, loadPrefs, savePrefs, loadRecord, saveRecord, addResult, EMPTY_RECORD,
  TEXT_SIZES, SIZE_SCALE,
} from './storage.js';
import {
  unlockAudio, configureAudio, click, select as selectSound, whistle, kickSound, netSound,
  gloveSound, goalRoar, saveGroan, countdownTick, startCrowd, stopCrowd, crowdSurge,
  openingCrowd, audioState, uiSwitch, purchaseChime,
} from './audio.js';
import {
  initialEntitlement, refreshEntitlement, purchase, restore, loadPrice, clearEntitlement,
  mode as iapMode, diagnostic as iapDiagnostic, PRODUCT_ID,
} from './platform/iap.js';
import {
  RealtimeClient, ShootoutSession, RankingNet, onlineConfig, onlineConfigured, normalizeCode,
  randomCode, isValidCode, rankTable, ONLINE_TURN_MS,
} from './net/online.js';
import { createStadium } from './three/stadium.js';
import { homeView } from './ui/home.js';
import { countryView } from './ui/country.js';
import { matchView, resultView, pkCellList } from './ui/match.js';
import { lockerView } from './ui/locker.js';
import { proView } from './ui/pro.js';
import { onlineView, rankView } from './ui/online.js';
import { settingsView, statsView, rulesView, privacyView, openingView } from './ui/misc.js';
import { $, $$, esc } from './ui/layout.js';

/* ------------------------------------------------------------------ *\
 * 初期化
 * ------------------------------------------------------------------ */

const app = $('#app');
const storage = openStorage();
const deviceLanguages = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
let prefs = loadPrefs(storage, deviceLanguages);
let record = loadRecord(storage);
let entitled = initialEntitlement();
let skin = readSkin(storage);
if (!prefs.opponent) prefs.opponent = pickOpponent(prefs.country).code;

let screen = 'home';
let draft = { ...skin };
let stadium = null;
let match = null;
let session = null;
let client = null;
let online = { mode: 'menu', scope: 'domestic', code: '', status: '', opponent: null, searching: false, room: '' };
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

function currentView() {
  switch (screen) {
    case 'home':
      return homeView({ t, prefs, record, entitled, language: prefs.language });
    case 'country':
      return countryView({ t, prefs, language: prefs.language });
    case 'match':
      return matchView({ t, prefs, state: match.state, language: prefs.language, online: Boolean(match.online), roomLabel: match.online ? online.code : '' });
    case 'result':
      return resultView({ t, state: match.state, record, language: prefs.language, prefs, online: Boolean(match.online) });
    case 'locker':
      return lockerView({ t, entitled, draft, language: prefs.language });
    case 'pro':
      return proView({ t, entitled, language: prefs.language, diagnostic: proDiagState, price: proPrice });
    case 'online':
      return onlineView({ t, entitled, language: prefs.language, state: online });
    case 'rank':
      return rankView({ t, table: rankTable(rankRows, myRankRow()), entitled, language: prefs.language, status: rankStatus });
    case 'stats':
      return statsView({ t, record });
    case 'settings':
      return settingsView({ t, prefs, entitled });
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
    updateBoard();
    updateHud();
  }
  document.documentElement.dataset.screen = screen;
  const body = $('.screen__body');
  if (body) body.scrollTop = 0;
}

function go(next) {
  if (screen === 'match' && next !== 'match') {
    stopRound();
    disposeStadium();
    stopCrowd();
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
  stadium.setTeams({
    myKit: skin.kit,
    myBoot: skin.boot,
    myNumber: kickerNumber(match.state, 'me'),
    oppCountry: getCountry(prefs.opponent || 'BR').kit,
  });
  stadium.setNight(prefs.night);
  stadium.setRole(currentRole());
  stadium.prepareKick({ kicker: kickerNumber(match.state, match.state.turn === 'me' ? 'me' : 'opp'), role: currentRole() });
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
  const first = onlineMatch ? (session && session.mySide === 'away' ? 'opp' : 'me') : 'me';
  match = {
    online: onlineMatch,
    state: newMatch({ first }),
    selection: null,
    confirmed: false,
    cpuDir: null,
    timerId: 0,
    deadline: 0,
    applied: 0,
    nextTimer: null,
    waitingOpponent: false,
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
  match.selection = null;
  match.confirmed = false;
  match.waitingOpponent = false;
  const forced = typeof window !== 'undefined' ? window.__SHOOTOUT_FORCE_CPU__ : null;
  match.cpuDir = match.online ? null : (Array.isArray(forced) && forced.length
    ? forced[state.history.length % forced.length]
    : chooseCPU(state, { level: prefs.level }));

  const role = currentRole();
  match.role = role;
  const kicker = kickerNumber(state, role === 'shoot' ? 'me' : 'opp');
  const roleChip = $('#role-chip');
  if (roleChip) roleChip.textContent = role === 'shoot' ? t('shootTitle') : t('saveTitle');
  const kickerChip = $('#kicker-chip');
  if (kickerChip) kickerChip.textContent = `${t('kicker')} ${kicker}`;
  const status = $('#kick-status');
  if (status) status.textContent = '';
  const banner = $('#banner');
  if (banner) { banner.hidden = true; banner.className = 'banner'; }
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
    stadium.setTeams({
      myKit: skin.kit,
      myBoot: skin.boot,
      myNumber: kickerNumber(state, 'me'),
      oppCountry: getCountry(prefs.opponent || 'BR').kit,
    });
    stadium.setRole(role);
    stadium.prepareKick({ kicker, role });
  }
  whistle();
  startCrowd(getCountry(prefs.country));
  startTimer();
  updateHud();
  updateBoard();
}

function startTimer() {
  if (!match) return;
  const duration = CONFIG.roundSeconds * 1000;
  match.deadline = performance.now() + duration;
  let lastSecond = CONFIG.roundSeconds + 1;
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

function showBanner(goal) {
  const banner = $('#banner');
  if (!banner) return;
  banner.hidden = false;
  banner.textContent = t(goal ? 'goal' : 'save');
  banner.className = `banner is-show ${goal ? 'is-goal' : 'is-save'}`;
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

function autoPick() {
  if (!match || match.confirmed) return;
  const dir = match.selection || randomDirection();
  if (!match.selection) selectDirection(dir);
  resolveRound(dir, { timeout: true });
}

function resolveRound(dir, { timeout }) {
  if (!match || match.confirmed) return;
  match.confirmed = true;
  cancelAnimationFrame(match.timerId);
  $('#confirm') && ($('#confirm').disabled = true);
  $$('.zone').forEach((button) => { button.disabled = true; });
  updateTimer(0, CONFIG.roundSeconds * 1000);

  if (match.online) {
    if (!session || !session.matchName) {
      toast(t('connectionError'));
      return;
    }
    setKickStatus(t('waitingOpponent'));
    match.waitingOpponent = true;
    const round = match.state.history.length;
    const sent = session.pick(round, dir, { timeout });
    if (!sent) {
      /* すでに相手の手が届いていて、この端末では解決済みの可能性 */
      setKickStatus('');
    }
    return;
  }

  const role = match.role || currentRole();
  const shot = role === 'shoot' ? dir : match.cpuDir;
  const save = role === 'shoot' ? match.cpuDir : dir;
  applyKick(shot, save, { timeout });
}

function applyKick(shot, save, { timeout = false } = {}) {
  if (!match) return;
  const round = match.state.history.length;
  if (match.applied > round) return;
  const next = resolveKick(match.state, { shot, save });
  match.state = next;
  match.applied = next.history.length;
  const event = next.history.at(-1);
  const role = match.role || currentRole();

  match.selection = null;
  match.confirmed = true;
  updateHud();
  updateBoard();
  markReveal(event, role);
  if (timeout) setKickStatus(t('timeoutPick'));

  let animation = null;
  if (stadium) {
    animation = stadium.kick({
      shot: event.shot,
      save: event.save,
      goal: event.goal,
      kicker: event.kicker,
      role,
      onImpact: (kind) => {
        if (kind === 'kick') kickSound();
        if (kind === 'goal') { netSound(); goalRoar(2.4); crowdSurge(1.1); }
        if (kind === 'save') { gloveSound(); saveGroan(); }
      },
    });
  } else {
    kickSound();
    setTimeout(() => {
      if (event.goal) { netSound(); goalRoar(2.2); }
      else { gloveSound(); saveGroan(); }
    }, 260);
  }

  setTimeout(() => showBanner(event.goal), stadium ? 780 : 320);

  const token = next.history.length;
  const finish = () => {
    /* すでに次のキックへ進んでいた／別の画面へ移った場合は、遅れて届いた演出で進めない */
    if (!match || screen !== 'match' || match.state.history.length !== token) return;
    const nextBtn = $('#next-kick');
    if (nextBtn) nextBtn.hidden = false;
    nextTimer = setTimeout(() => nextRound(), 1500);
  };
  if (animation && typeof animation.then === 'function') animation.then(finish);
  else setTimeout(finish, 1150);
}

function markReveal(event, role) {
  $$('.zone').forEach((button) => {
    const dir = button.dataset.dir;
    if (event.goal) {
      if (dir === event.shot) button.classList.add('is-selected');
    } else {
      if (dir === event.save) button.classList.add('is-cpu');
      if (dir === event.shot) button.classList.add('is-selected');
    }
  });
  const status = $('#kick-status');
  if (status) {
    const shotName = t(`zone_${event.shot}`);
    const saveName = t(`zone_${event.save}`);
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
  record = addResult(record, { winner: state.winner, goals, conceded, saves, shots, sudden });
  saveRecord(storage, record);
  if (match.online) {
    record.points = Math.max(0, (record.points || 0) + (state.winner === 'me' ? 25 : -15));
    record.onlineWins = (record.onlineWins || 0) + (state.winner === 'me' ? 1 : 0);
    record.onlineLosses = (record.onlineLosses || 0) + (state.winner === 'me' ? 0 : 1);
    saveRecord(storage, record);
  }
  stopRound();
  disposeStadium();
  stopCrowd();
  screen = 'result';
  render();
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

function updateHud() {
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
  if (kickerChip) {
    const role = currentRole();
    kickerChip.textContent = `${t('kicker')} ${kickerNumber(match.state, role === 'shoot' ? 'me' : 'opp')}`;
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
    nickname: (prefs.nickname || 'PLAYER').slice(0, 12),
    countryCode: prefs.country,
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
        applyKick(event.shot, event.save);
      }
      break;
    case 'stamp':
      showStamp(event.id);
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
  session.quickMatch({ scope: online.scope, country: prefs.country, profile: onlineProfile() });
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

function myRankRow() {
  return {
    id: rankId(),
    nickname: prefs.nickname || countryName(prefs.country, prefs.language),
    countryCode: prefs.country,
    points: record.points || 0,
    wins: record.onlineWins || 0,
    losses: record.onlineLosses || 0,
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
  if (!entitled) {
    go('rank');
    return;
  }
  go('rank');
  if (!onlineConfigured()) {
    rankStatus = t('onlineNotConfigured');
    return;
  }
  ensureSession();
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
}

/* ------------------------------------------------------------------ *\
 * 課金
 * ------------------------------------------------------------------ */

async function buyPro() {
  proStatus = '';
  const result = await purchase();
  if (result.status === 'success') {
    entitled = true;
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

function showStamp(id) {
  const faces = { hello: '👋', nice: '🔥', oops: '😅', gg: '🤝', thanks: '🙏', wow: '😮' };
  const pop = $('#stamp-pop');
  if (!pop) return;
  pop.hidden = false;
  pop.textContent = faces[id] || '👏';
  pop.style.animation = 'none';
  void pop.offsetWidth;
  pop.style.animation = '';
  setTimeout(() => { pop.hidden = true; }, 1400);
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
  if (!COUNTRIES.some((country) => country.code === prefs.opponent)) prefs.opponent = 'BR';
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
  const stamp = event.target.closest('button[data-stamp]');
  if (stamp) {
    unlockAudio();
    if (session && session.matchName) session.sendStamp(stamp.dataset.stamp);
    showStamp(stamp.dataset.stamp);
    return;
  }
  const kitTile = event.target.closest('button[data-kit]');
  if (kitTile && !kitTile.dataset.action) {
    draft = normalizeSkin({ ...draft, kit: kitTile.dataset.kit });
    selectSound();
    render();
    return;
  }
  const bootTile = event.target.closest('button[data-boot]');
  if (bootTile && !bootTile.dataset.action) {
    draft = normalizeSkin({ ...draft, boot: bootTile.dataset.boot });
    selectSound();
    render();
    return;
  }
  const levelButton = event.target.closest('button[data-level]');
  if (levelButton) {
    updatePrefs({ level: levelButton.dataset.level });
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
    render();
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
    const patch = { country: code };
    if (prefs.opponent === code) patch.opponent = pickOpponent(code).code;
    updatePrefs(patch);
    if (code === 'br') { /* no-op: 国を変えても強さは変えない */ }
    return;
  }
  const opponent = event.target.closest('button[data-opponent]');
  if (opponent) {
    updatePrefs({ opponent: opponent.dataset.opponent });
    return;
  }

  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  unlockAudio();
  configureAudio(prefs);

  switch (action) {
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
      updatePrefs({ opponent: pickOpponent(prefs.country).code });
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
        record = { ...EMPTY_RECORD };
        saveRecord(storage, record);
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
      openQuick();
      break;
    case 'create-room':
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
  const select = event.target.closest('select[data-pref]');
  if (!select) return;
  const key = select.dataset.pref;
  updatePrefs({ [key]: select.value });
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

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCrowd();
  } else if (screen === 'match') {
    startCrowd(getCountry(prefs.country));
  }
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
  get match() {
    if (!match) return null;
    return {
      online: match.online,
      role: match.role,
      selection: match.selection,
      confirmed: match.confirmed,
      winner: match.state.winner,
      score: { ...match.state.score },
      kicks: { me: [...match.state.kicks.me], opp: [...match.state.kicks.opp] },
      history: match.state.history.length,
      remainingMs: Math.max(0, Math.round((match.deadline || 0) - performance.now())),
      phase: phase(match.state),
    };
  },
  get audio() { return audioState(); },
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
    match.deadline = performance.now() + 600000;
    return true;
  },
  texts: (key) => t(key),
  languages: LANGUAGES,
  languageNames: LANGUAGE_NAMES,
  countries: COUNTRIES.map((country) => country.code),
  productId: PRODUCT_ID,
};

boot();
