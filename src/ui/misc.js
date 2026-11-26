/** SHOOTOUT 4 — 遊び方・戦績・設定・プライバシー・オープニング */

import { CONFIG } from '../config.js';
import { LANGUAGES, LANGUAGE_NAMES } from '../i18n.js';
import { DIRECTIONS } from '../core/rules.js';
import { emblem, esc, icon, screenShell, settingRow, toggleRow } from './layout.js';

export function openingView({ t }) {
  return `<div class="opening" role="dialog" aria-modal="true" aria-label="${esc(t('championship'))}">
    <div class="opening__sky" aria-hidden="true"></div>
    <div class="opening__stands" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="opening__beam" aria-hidden="true"></div>
    <div class="opening__content">
      <img class="opening__emblem" src="${CONFIG.emblem}" alt="">
      <p class="opening__fed">${esc(CONFIG.federation)}</p>
      <h1 class="opening__title">SHOOTOUT <b>4</b></h1>
      <p class="opening__sub">${esc(t('championship'))}</p>
    </div>
    <button class="opening__sound" data-intro="sound" hidden>${esc(t('soundStart'))}</button>
    <span class="opening__skip">${esc(t('skip'))}</span>
  </div>`;
}

export function rulesView({ t }) {
  return screenShell({
    title: t('rulesTitle'),
    back: 'home',
    body: `
      <section class="panel">
        <div class="goaldiagram" aria-hidden="true">
          <div class="goaldiagram__goal">
            ${DIRECTIONS.map((dir) => `<span class="goaldiagram__zone goaldiagram__zone--${dir.toLowerCase()}">${esc(t(`zone_${dir}`))}</span>`).join('')}
          </div>
          <div class="goaldiagram__spot"></div>
        </div>
        <p class="rules-text">${esc(t('rulesText'))}</p>
      </section>
      <section class="panel panel--flat">
        <ul class="bulletlist">
          <li>${esc(t('handoverShootHint'))}</li>
          <li>${esc(t('keeperHint'))}</li>
          <li>${esc(t('fairness'))}</li>
          <li>${esc(t('rulesFair'))}</li>
          <li>${esc(t('proFair'))}</li>
        </ul>
      </section>
    `,
  });
}

export function statsView({ t, record }) {
  const total = record.played || 0;
  const rate = total ? Math.round((record.wins / total) * 100) : 0;
  return screenShell({
    title: t('statsTitle'),
    back: 'home',
    body: `
      <section class="panel statpanel">
        <div class="bigrate"><b data-testid="winrate">${rate}%</b><span>${esc(t('winRate'))}</span></div>
        <div class="statgrid">
          <div><span>${esc(t('played'))}</span><b>${record.played}</b></div>
          <div><span>${esc(t('wins'))}</span><b>${record.wins}</b></div>
          <div><span>${esc(t('losses'))}</span><b>${record.losses}</b></div>
          <div><span>${esc(t('streak'))}</span><b>${record.bestStreak}</b></div>
          <div><span>${esc(t('goalsScored'))}</span><b>${record.goals}</b></div>
          <div><span>${esc(t('goalsAgainst'))}</span><b>${record.conceded}</b></div>
          <div><span>${esc(t('savesMade'))}</span><b>${record.saves}</b></div>
          <div><span>${esc(t('suddenDeath'))}</span><b>${record.sudden}</b></div>
        </div>
      </section>
      <button class="btn btn--danger btn--block" data-action="reset-record">${esc(t('resetStats'))}</button>
    `,
  });
}

export function settingsView({ t, prefs, entitled, registered = false, languages = LANGUAGES, names = LANGUAGE_NAMES }) {
  return screenShell({
    title: t('settingsTitle'),
    back: 'home',
    body: `
      <section class="panel">
        ${toggleRow('sound', prefs.sound, t)}
        ${toggleRow('bgm', prefs.bgm, t)}
        ${toggleRow('vibrate', prefs.vibrate, t)}
      </section>

      <section class="panel">
        <div class="row row--stack">
          <span class="row__label">${esc(t('textSize'))}</span>
          <div class="segmented" role="group" aria-label="${esc(t('textSize'))}">
            ${['standard', 'large', 'extra'].map((size) => `<button class="seg ${prefs.size === size ? 'is-on' : ''}" data-size="${size}" data-testid="size-${size}">${esc(t(`size_${size}`))}</button>`).join('')}
          </div>
        </div>
        ${settingRow('language', prefs.language, languages.map((code, index) => [code, names[index]]), t)}
        <div class="row">
          <span class="row__label">${esc(t('timeOfDay'))}</span>
          <div class="segmented" role="group" aria-label="${esc(t('timeOfDay'))}">
            <button class="seg ${prefs.night ? '' : 'is-on'}" data-night="false">${icon('sun')}${esc(t('dayMode'))}</button>
            <button class="seg ${prefs.night ? 'is-on' : ''}" data-night="true">${icon('moon')}${esc(t('nightMode'))}</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <button class="btn btn--ghost btn--block" data-action="sound-test" data-testid="sound-test">${icon('soundwave')}<span>${esc(t('soundTest'))}</span></button>
        <button class="btn btn--ghost btn--block" data-action="register" data-testid="settings-register">${icon('id')}<span>${esc(registered ? t('registerDone') : t('registerOpen'))}</span></button>
      </section>

      <section class="panel">
        <button class="btn btn--ghost btn--block" data-action="replay-intro">${esc(t('replayIntro'))}</button>
        <button class="btn btn--ghost btn--block" data-action="restore">${esc(t('restorePurchases'))}</button>
        <button class="btn btn--danger btn--block" data-action="reset-all">${esc(t('resetAll'))}</button>
        <p class="mini">${esc(entitled ? t('proActive') : t('proMockNote'))}</p>
        <p class="mini mono">SHOOTOUT 4 · V${CONFIG.version} · BUILD ${CONFIG.build} · ${esc(CONFIG.bundleId)}</p>
      </section>
    `,
  });
}

export function privacyView({ t }) {
  return screenShell({
    title: t('privacyTitle'),
    back: 'home',
    body: `
      <section class="panel">
        <p class="rules-text">${esc(t('privacyText'))}</p>
        <p class="mini">${esc(t('versionNote'))}</p>
        <p class="mini mono">${esc(CONFIG.federation)}</p>
      </section>
    `,
  });
}
