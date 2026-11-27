/** SHOOTOUT 4 — 試合画面（HUD・PKスコアボード・4択・8秒タイマー・キーパーの駆け引き） */

import { CONFIG } from '../config.js';
import { DIRECTIONS, pkBoard, kickerNumber, phase, mirrorDirection } from '../core/rules.js';
import { EMOTES, EMOTE_SECTIONS } from '../core/emotes.js';
import { getCountry, countryName } from '../core/countries.js';
import { flag, icon, esc } from './layout.js';

export function pkCellList(state, side, t) {
  const board = pkBoard(state);
  const cells = board[side];
  return cells.map((cell) => {
      const value = cell.kicked ? (cell.goal ? '○' : '×') : '';
      const classes = [
        'pkcell',
        cell.sudden ? 'pkcell--sudden' : '',
        cell.kicked ? (cell.goal ? 'is-goal' : 'is-miss') : '',
        cell.current ? 'is-current' : '',
      ].filter(Boolean).join(' ');
    return `<span class="${classes}" title="${cell.sudden ? esc(t('suddenDeath')) : ''}">${value || (cell.current ? '<i></i>' : '')}</span>`;
  }).join('');
}

export function pkCells(state, side, t) {
  return `<div class="pkrow" data-testid="pk-${side}">${pkCellList(state, side, t)}</div>`;
}

/**
 * PK表の2行を「上段＝先攻 / 下段＝後攻」で返す（試合中・結果で同じ並び）。
 * どちらがあなたでどちらが相手か一目で分かるよう、名前・先攻/後攻・国旗を添える。
 */
export function pkRows(state, t, { meCode = 'JP', oppCode = 'BR', className = '' } = {}) {
  const order = [state.first, state.first === 'me' ? 'opp' : 'me'];
  return order.map((side) => {
    const mine = side === 'me';
    const phaseLabel = side === state.first ? t('firstKick') : t('secondKick');
    return `<div class="pkboard__row pkboard__row--${side} ${className}" data-testid="pk-row-${side}" data-order="${esc(phaseLabel)}">
      <span class="pkboard__tag"><b>${esc(mine ? t('you') : t('opponent'))}</b><em>${esc(phaseLabel)}</em></span>
      ${flag(mine ? meCode : oppCode, 'flag flag--xs')}
      ${pkCells(state, side, t)}
    </div>`;
  }).join('');
}

/** キーパーの画面はキッカーと向かい合うので、表示用の左右は反転する */
export function shownDirection(dir, role) {
  return role === 'keep' ? mirrorDirection(dir) : dir;
}

function roleText(t, role) {
  return role === 'shoot' ? t('shootTitle') : t('saveTitle');
}

function turnText(t, role) {
  return role === 'shoot' ? t('turnShootBig') : t('turnKeepBig');
}

function footLabel(t, foot) {
  return foot === 'left' ? t('footLeft') : t('footRight');
}

/** スタンプ・定型文のトレイ（Build 7） */
function emoteTray(t) {
  const group = ({ kind, label }) => {
    const items = EMOTES.filter((emote) => emote.kind === kind);
    if (!items.length) return '';
    return `<div class="emotetray__group" data-kind="${kind}">
      <span class="emotetray__label">${esc(t(label))}</span>
      <div class="emotetray__grid emotetray__grid--${kind}">
        ${items.map((emote) => `<button type="button" class="emotepill" data-emote="${emote.id}" data-testid="emote-${emote.id}" aria-label="${esc(t(emote.key))}">
          <span class="emotepill__face" aria-hidden="true">${emote.face}</span>
          <span class="emotepill__text">${esc(t(emote.key))}</span>
        </button>`).join('')}
      </div>
    </div>`;
  };
  return `<div class="emotetray" id="emote-tray" data-testid="emote-tray" hidden>
    <div class="emotetray__head">
      <b>${esc(t('emoteTray'))}</b>
      <button type="button" class="emotetray__close" data-action="emote-toggle" aria-label="${esc(t('close'))}">${icon('close')}</button>
    </div>
    ${EMOTE_SECTIONS.map(group).join('')}
  </div>`;
}

export function matchView({ t, prefs, state, language, online = false, roomLabel = '', kickerFor = null }) {
  const me = getCountry(prefs.country);
  const oppCode = prefs.opponent || 'BR';
  const opp = getCountry(oppCode);
  const role = state.turn === 'me' ? 'shoot' : 'keep';
  const kickerNo = kickerNumber(state, 'me');
  const sudden = phase(state) === 'sudden';
  const myKicker = kickerFor ? kickerFor('me', kickerNo, state.history.length) : null;

  return `<div class="match">
    <header class="hud">
      <button class="iconbtn iconbtn--small" data-action="quit" aria-label="${esc(t('home'))}">${icon('back')}</button>
      <div class="hud__team hud__team--me">
        ${flag(me.code, 'flag flag--sm')}
        <span class="hud__name">${esc(countryName(me.code, language))}</span>
        <b class="hud__score" id="hud-me" data-testid="score-me">${state.score.me}</b>
      </div>
      <div class="hud__mid">
        <span class="hud__phase" id="hud-phase">${esc(sudden ? t('suddenDeath') : (state.first === 'me' ? t('firstKick') : t('secondKick')))}</span>
        <span class="hud__dash">-</span>
      </div>
      <div class="hud__team hud__team--opp">
        <b class="hud__score" id="hud-opp" data-testid="score-opp">${state.score.opp}</b>
        <span class="hud__name">${esc(countryName(oppCode, language))}</span>
        ${flag(opp.code, 'flag flag--sm')}
      </div>
    </header>

    <section class="pkboard" aria-label="PK scoreboard">
      <div class="pkboard__rows">
        ${pkRows(state, t, { meCode: me.code, oppCode: oppCode })}
      </div>
      <button type="button" class="emotebtn" id="emote-btn" data-action="emote-toggle" data-testid="emote-toggle"
        aria-expanded="false" aria-controls="emote-tray" aria-label="${esc(t('emoteTray'))}" title="${esc(t('emoteTray'))}">
        ${icon('chat')}</button>
      ${emoteTray(t)}
    </section>

    <div class="stage" id="stage">
      <canvas id="scene" aria-label="3D stadium"></canvas>
      <div class="stage__fallback" id="stage-fallback" hidden>
        <div class="fallback-goal"><i></i><i></i><i></i><i></i></div>
        <div class="fallback-ball"></div>
      </div>
      <div class="stage__overlay">
        <div class="stage__info">
          <div class="turn ${role === 'shoot' ? 'turn--shoot' : 'turn--keep'}" id="role-chip" data-testid="role" data-role="${role}">
            <span class="turn__dot" aria-hidden="true">${role === 'shoot' ? '⚽' : '🧤'}</span>
            <b class="turn__text">${esc(turnText(t, role))}</b>
          </div>
          <span class="chip chip--kicker" id="kicker-chip" data-testid="kicker">
            ${esc(t('kicker'))} ${kickerNo}${myKicker ? ` · ${esc(myKicker.name)} · ${esc(footLabel(t, myKicker.foot))}` : ''}
          </span>
          <!-- Build 5: キーパーの番だけ、方向の選び方（映っている画面のまま）を小さく添える -->
          <p class="dirhint" id="dir-hint" data-testid="keeper-dir-hint" hidden>${esc(t('keeperDirHint'))}</p>
        </div>
        <div class="stage__tools">
          <button type="button" class="iconbtn iconbtn--small stage__tool" data-action="toggle-sound" data-testid="match-sound"
            aria-pressed="${prefs.sound || prefs.bgm ? 'true' : 'false'}" aria-label="${esc(t('soundToggle'))}" title="${esc(t('soundToggle'))}">
            ${icon(prefs.sound || prefs.bgm ? 'sound' : 'soundOff')}
          </button>
          <button type="button" class="iconbtn iconbtn--small stage__tool" data-action="match-settings" data-testid="match-settings"
            aria-label="${esc(t('settings'))}" title="${esc(t('settings'))}">${icon('gear')}</button>
        </div>
      </div>
      <div class="handover" id="handover" hidden data-testid="handover">
        <div class="handover__card">
          <span class="handover__icon" id="handover-icon" aria-hidden="true">⚽</span>
          <b class="handover__title" id="handover-title"></b>
          <span class="handover__hint" id="handover-hint"></span>
        </div>
      </div>
      <div class="keeper-zone" id="keeper-zone" data-testid="keeper-zone" hidden>
        <span class="keeper-zone__hint">${esc(t('keeperHint'))}</span>
      </div>
      <div class="banner" id="banner" hidden></div>
      <div class="emotebubble" id="emote-bubble" data-testid="emote-bubble" hidden>
        <span class="emotebubble__face" id="emote-bubble-face" aria-hidden="true"></span>
        <span class="emotebubble__text" id="emote-bubble-text"></span>
        <span class="emotebubble__who" id="emote-bubble-who"></span>
      </div>
      <div class="stage__status" id="kick-status" role="status" aria-live="polite"></div>
      <button class="nextbtn" id="next-kick" data-action="next" hidden>${esc(t('nextKick') || t('confirm'))} ›</button>
    </div>

    <section class="controls">
      <div class="timer" id="timer">
        <div class="timer__bar"><i id="timer-fill"></i></div>
        <span class="timer__text" id="timer-text">${esc(t('timeLeft'))} ${CONFIG.roundSeconds}s</span>
      </div>
      <div class="zones" role="group" aria-label="${esc(roleText(t, role))}">
        <!-- 4択ボタン: data-dir="TL" / TR / BL / BR -->
        ${DIRECTIONS.map((dir) => `<button class="zone zone--${dir.toLowerCase()}" data-dir="${dir}" data-testid="zone-${dir}" aria-pressed="false">
          <span>${esc(t(`zone_${dir}`))}</span>
        </button>`).join('')}
      </div>
      <button class="btn btn--gold btn--confirm" id="confirm" data-action="confirm" disabled data-testid="confirm">
        ${icon('check')}<span>${esc(t('confirmKick'))}</span>
      </button>
    </section>

    ${online ? `<section class="stampbar">
      <button class="stamp stamp--leave" data-action="online-leave">${icon('door')}<small>${esc(t('leaveMatch'))}</small></button>
    </section>` : ''}

    ${roomLabel ? `<div class="roomchip">${esc(t('roomCode'))}: <b>${esc(roomLabel)}</b></div>` : ''}
  </div>`;
}

function logRow({ t, event, index, mine, meCode, oppCode, kickerFor, language }) {
  const number = event.kicker;
  const info = kickerFor ? kickerFor(event.side, number, event.index) : null;
  const shotLabel = event.miss ? t('outOfFrame') : t(`zone_${event.shot}`);
  const saveLabel = event.stuck ? t('noDive') : t(`zone_${event.save}`);
  return `<div class="kicklog__row ${event.goal ? 'is-goal' : 'is-miss'}" data-testid="kicklog-${index}">
    <span class="kicklog__no">${index + 1}${event.phase === 'sudden' ? '<em>SD</em>' : ''}</span>
    <div class="kicklog__main">
      <span class="kicklog__who">
        ${flag(mine ? meCode : oppCode, 'flag flag--xs')}
        <b>${esc(info ? info.name : `${t('kicker')} ${number}`)}</b>
        ${info ? `<em class="foot foot--${info.foot}">${esc(footLabel(t, info.foot))}</em>` : ''}
      </span>
      <span class="kicklog__dirs">
        <span class="kicklog__shot" data-testid="kicklog-shot-${index}">⚽ ${esc(shotLabel)}</span>
        <span class="kicklog__vs">vs</span>
        <span class="kicklog__save" data-testid="kicklog-save-${index}">🧤 ${esc(saveLabel)}</span>
        <b class="kicklog__res">${event.goal ? '○' : '×'}</b>
      </span>
    </div>
  </div>`;
}

/* 文面は Build 9 から core/share.js（結果カードと同じ場所）に移した。ここからも使える。 */
export { buildShareText } from '../core/share.js';

export function resultView({ t, state, record, language, prefs, online = false, kickerFor = null }) {
  const me = getCountry(prefs.country);
  const oppCode = prefs.opponent || 'BR';
  const win = state.winner === 'me';
  const goals = state.score.me;
  const conceded = state.score.opp;
  const saves = state.kicks.opp.filter((goal) => !goal).length;
  const myKicks = state.kicks.me.length;
  const sudden = state.kicks.me.length > CONFIG.kickers || state.kicks.opp.length > CONFIG.kickers;
  return `<div class="result ${win ? 'result--win' : 'result--lose'}">
    <div class="result__glow" aria-hidden="true"></div>
    <span class="result__eyebrow">${esc(online ? t('onlineTitle') : t('matchSummary'))}${sudden ? ` · ${esc(t('suddenDeath'))}` : ''}</span>
    <h1 class="result__title" data-testid="result-title">${esc(t(win ? 'victory' : 'defeat'))}</h1>

    <div class="result__score" data-testid="result-score">
      <span class="result__side">${flag(me.code, 'flag flag--lg')}<b>${esc(countryName(me.code, language))}</b></span>
      <span class="result__nums"><b>${goals}</b><i>–</i><b>${conceded}</b></span>
      <span class="result__side">${flag(oppCode, 'flag flag--lg')}<b>${esc(countryName(oppCode, language))}</b></span>
    </div>

    <section class="pkboard pkboard--result">
      ${pkRows(state, t, { meCode: me.code, oppCode: oppCode })}
    </section>

    <section class="kicklog" aria-label="${esc(t('matchSummary'))}">
      <div class="kicklog__head">
        <span class="kicklog__shot">⚽ ${esc(t('kickLogShot'))}</span>
        <span class="kicklog__vs">vs</span>
        <span class="kicklog__save">🧤 ${esc(t('kickLogSave'))}</span>
      </div>
      ${state.history.map((event, index) => logRow({
        t,
        event,
        index,
        mine: event.side === 'me',
        meCode: me.code,
        oppCode,
        kickerFor,
        language,
      })).join('')}
    </section>

    <div class="statgrid">
      <div><span>${esc(t('goalsScored'))}</span><b>${goals}</b></div>
      <div><span>${esc(t('savesMade'))}</span><b>${saves}</b></div>
      <div><span>${esc(t('shots'))}</span><b>${myKicks}</b></div>
      <div><span>${esc(t('winRate'))}</span><b>${record.played ? Math.round((record.wins / record.played) * 100) : 0}%</b></div>
    </div>

    <div class="result__actions">
      <button class="btn btn--primary btn--xl" data-action="rematch" data-testid="rematch">${icon('play')}<span>${esc(t('rematch'))}</span></button>
      <button class="btn btn--ghost" data-action="share-result" data-testid="share-result">${icon('share')}<span>${esc(t('shareResult'))}</span></button>
      <button class="btn btn--ghost" data-action="home">${esc(t('backHome'))}</button>
    </div>
  </div>`;
}
