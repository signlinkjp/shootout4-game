/** SHOOTOUT 4 — 通信対戦のロビー・ランキング */

import { getCountry, countryName } from '../core/countries.js';
import { flag, icon, esc, screenShell } from './layout.js';

export function onlineView({ t, entitled, language, state = {}, registered = false, officialCountry = null }) {
  const { mode = 'menu', scope = 'domestic', code = '', status = '', opponent = null, searching = false } = state;
  const quickDisabled = scope === 'world' && !entitled;
  return screenShell({
    title: t('onlineTitle'),
    back: 'home',
    className: 'screen--online',
    body: `
      <section class="segmented segmented--scope" role="group" aria-label="${esc(t('onlineTitle'))}">
        <button class="seg ${scope === 'domestic' ? 'is-on' : ''}" data-scope="domestic">${esc(t('scopeDomestic'))}</button>
        <button class="seg ${scope === 'world' ? 'is-on' : ''}" data-scope="world">${esc(t('scopeWorld'))} ${entitled ? '' : '🔒'}</button>
      </section>

      ${quickDisabled ? `<p class="notice">${esc(t('onlineProRequired'))} <button class="link" data-action="pro">${esc(t('proTitle'))} ›</button></p>` : ''}
      ${officialCountry ? `<p class="mini mini--center online__nation">${flag(officialCountry, 'flag flag--xs')}
        <span>${esc(countryName(officialCountry, language))}</span>
        ${registered ? '' : ` · <button class="link" data-action="register">${esc(t('registerOpen'))}</button>`}
      </p>` : ''}

      <section class="panel">
        <h2 class="section-title">${esc(t('quickMatch'))}</h2>
        <p class="mini">${esc(t('rankNote'))}</p>
        <button class="btn btn--primary btn--block ${quickDisabled ? 'is-disabled' : ''}" data-action="quick"
          ${quickDisabled ? 'aria-disabled="true"' : ''} data-testid="quick-match">
          ${icon('users')}<span>${esc(t('quickMatch'))}</span>
        </button>
      </section>

      <section class="panel">
        <h2 class="section-title">${esc(t('friendRoom'))} ${entitled ? '' : `· ${esc(t('proLocked'))}`}</h2>
        <div class="roomrow">
          <button class="btn btn--gold ${entitled ? '' : 'is-disabled'}" data-action="create-room">${icon('plus')}<span>${esc(t('createRoom'))}</span></button>
          <div class="codebox">
            <input id="room-code" class="codeinput" inputmode="text" autocomplete="off" spellcheck="false"
              maxlength="6" placeholder="${esc(t('enterCode'))}" value="${esc(code)}"
              aria-label="${esc(t('roomCode'))}">
            <button class="iconbtn" data-action="join-room" aria-label="${esc(t('joinRoom'))}">${icon('check')}</button>
            ${entitled ? '' : `<span class="mini">${esc(t('proLocked'))}</span>`}
          </div>
        </div>
        <p class="mini">${esc(t('roomCode'))}: 4〜6${language === 'ja' ? '文字' : ' chars'} · A–Z / 0–9</p>
      </section>

      ${searching ? `<section class="searching" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <p>${esc(t('searching'))}<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></p>
        ${code ? `<p class="searching__code">${esc(t('roomCode'))}: <b data-testid="room-code-value">${esc(code)}</b>
          <button class="iconbtn iconbtn--small" data-action="copy-code" aria-label="${esc(t('copyCode'))}">${icon('copy')}</button></p>` : ''}
        <button class="btn btn--ghost" data-action="cancel-search">${esc(t('cancelSearch'))}</button>
      </section>` : ''}

      ${opponent ? `<section class="opponent">
        <span class="opponent__label">${esc(t('opponentFound'))}</span>
        <div class="opponent__card">
          ${flag(opponent.countryCode || 'JP', 'flag flag--lg')}
          <div><b>${esc(opponent.nickname || 'PLAYER')}</b><small>${esc(countryName(opponent.countryCode || 'JP', language))}</small></div>
        </div>
        <button class="btn btn--primary btn--block" data-action="online-start">${esc(t('startMatch'))}</button>
      </section>` : ''}

      ${status ? `<p class="status" role="status" aria-live="polite">${esc(status)}</p>` : ''}

      <p class="mini mini--center">${esc(t('proFair'))}</p>
    `,
  });
}

export function rankView({ t, table, entitled, language, status = '' }) {
  return screenShell({
    title: t('rankTitle'),
    back: 'home',
    className: 'screen--rank',
    body: entitled
      ? `<p class="mini">${esc(t('rankNote'))}</p>
        <ol class="ranktable" data-testid="rank-table">
          ${table.map((row) => `<li class="ranktable__row ${row.isMe ? 'is-me' : ''}">
            <span class="ranktable__place">${row.place}</span>
            ${flag(row.countryCode || 'JP', 'flag flag--sm')}
            <span class="ranktable__name">${esc(row.nickname || 'PLAYER')}</span>
            <b class="ranktable__points">${esc(String(row.points || 0))}</b>
          </li>`).join('') || `<li class="ranktable__empty">${esc(t('noRankData'))}</li>`}
        </ol>
        ${status ? `<p class="status" role="status">${esc(status)}</p>` : ''}`
      : `<div class="locked">
          ${icon('globe', 'locked__icon')}
          <p>${esc(t('rankProOnly'))}</p>
          <button class="btn btn--gold" data-action="pro">${esc(t('proJoin'))}</button>
        </div>`,
  });
}
