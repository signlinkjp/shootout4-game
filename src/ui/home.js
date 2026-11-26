/** SHOOTOUT 4 — ホーム画面 */

import { CONFIG } from '../config.js';
import { countryName, getCountry } from '../core/countries.js';
import { emblem, flag, icon, esc } from './layout.js';

export function homeView({ t, prefs, record, entitled, language }) {
  const me = getCountry(prefs.country);
  const opp = getCountry(prefs.opponent || (prefs.country === 'BR' ? 'JP' : 'BR'));
  const menu = [
    ['online', 'users', 'playOnline', entitled ? '' : t('freeTag')],
    ['locker', 'shirt', 'locker', entitled ? t('unlocked') : t('proLocked')],
    ['rank', 'globe', 'rank', entitled ? '' : t('proLocked')],
    ['stats', 'chart', 'stats', `${record.wins}W / ${record.losses}L`],
    ['rules', 'shield', 'rules', ''],
    ['settings', 'gear', 'settings', ''],
  ];
  return `<div class="home">
    <header class="home__top">
      <span class="home__badge">${esc(CONFIG.brand)}</span>
      <button class="iconbtn" data-action="settings" aria-label="${esc(t('settings'))}">${icon('gear')}</button>
    </header>

    <section class="hero">
      <div class="hero__rays" aria-hidden="true"></div>
      <div class="hero__emblem">${emblem('hero__img')}</div>
      <div class="hero__wordmark">SHOOTOUT <b>4</b></div>
      <p class="hero__tag">${esc(t('tagline'))}</p>
      <div class="hero__teams">
        <span class="hero__team">${flag(me.code, 'flag flag--lg')}<b>${esc(countryName(me.code, language))}</b></span>
        <span class="hero__vs">VS</span>
        <span class="hero__team">${flag(opp.code, 'flag flag--lg')}<b>${esc(countryName(opp.code, language))}</b></span>
      </div>
    </section>

    <div class="home__cta">
      <button class="btn btn--primary btn--xl" data-action="country">
        ${icon('play', 'icon icon--xl')}<span>${esc(t('playCpu'))}</span>
      </button>
      <button class="btn btn--gold btn--block" data-action="online">
        ${icon('users')}<span>${esc(t('playOnline'))}</span>
      </button>
    </div>

    <nav class="menu-grid">
      ${menu.map(([action, iconName, label, sub]) => `<button class="menu" data-action="${action}">
        ${icon(iconName, 'menu__icon')}
        <span class="menu__label">${esc(t(label))}</span>
        ${sub ? `<span class="menu__sub">${esc(sub)}</span>` : ''}
      </button>`).join('')}
    </nav>

    ${entitled ? `<button class="procard procard--member" data-action="pro" data-testid="procard">
      <span class="procard__emblem">${emblem('procard__img')}</span>
      <span class="procard__body">
        <b>${esc(t('proTitle'))}</b>
        <small>${esc(t('proHomeNote'))}</small>
      </span>
      <span class="procard__price">✓</span>
    </button>` : `<button class="procard" data-action="pro" data-testid="procard">
      <span class="procard__emblem">${emblem('procard__img')}</span>
      <span class="procard__body">
        <b>${esc(t('proTitle'))}</b>
        <small>${esc(t('proHomeNote'))}</small>
      </span>
      <span class="procard__price">${esc(CONFIG.iap.proPrice)}</span>
    </button>`}

    <footer class="home__foot">
      <span>V${CONFIG.version} · BUILD ${CONFIG.build}</span>
      <span>${esc(t('versionNote'))}</span>
    </footer>
  </div>`;
}
