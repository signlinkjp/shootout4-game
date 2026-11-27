/** SHOOTOUT 4 — PRO（IPKSF 公式加盟・買い切り ¥300・非消費型） */

import { CONFIG } from '../config.js';
import { fallbackPrice } from '../platform/iap.js';
import { emblem, esc, icon, screenShell, statusLine } from './layout.js';

export function proView({ t, entitled, language, diagnostic, price }) {
  const displayPrice = price || CONFIG.iap.proPrice || fallbackPrice(language);
  const benefits = [
    ['globe', 'proBenefitRank'],
    ['users', 'proBenefitFriend'],
    ['shirt', 'proBenefitLocker'],
    ['body', 'proBenefitCharacter'],
    ['globe', 'proBenefitCountries'],
  ];
  return screenShell({
    title: t('proTitle'),
    back: 'home',
    className: 'screen--pro',
    body: `
      <section class="prohero">
        ${emblem('prohero__img')}
        <div class="prohero__text">
          <span class="prohero__fed">${esc(CONFIG.federation)}</span>
          <h2>${esc(t('proTitle'))}</h2>
          <p class="prohero__price">${esc(displayPrice)} <small>${esc(t('oneTime'))}</small></p>
          <p class="prohero__state ${entitled ? 'is-on' : ''}">${entitled ? `✓ ${esc(t('proMember'))}` : esc(t('proNonMember'))}</p>
        </div>
      </section>

      <ul class="benefits">
        ${benefits.map(([iconName, key]) => `<li>${icon(iconName, 'benefits__icon')}<span>${esc(t(key))}</span></li>`).join('')}
      </ul>

      <p class="mini mini--center">${esc(t('proFair'))}</p>

      ${entitled
        ? `<button class="btn btn--ghost btn--block" data-action="restore">${esc(t('proRestore'))}</button>`
        : `<button class="btn btn--gold btn--xl btn--block" data-action="unlock" data-testid="pro-buy">
            ${icon('shield')}<span>${esc(t('proJoin'))} · ${esc(displayPrice)}</span>
          </button>
          <button class="btn btn--ghost btn--block" data-action="restore">${esc(t('proRestore'))}</button>`}
      ${statusLine('', '')}
      <p class="mini mini--center" id="pro-status" role="status" aria-live="polite"></p>
      ${diagnostic ? `<p class="mini mini--center mono">${esc(t('proDiag'))}: ${esc(diagnostic)}</p>` : ''}
    `,
  });
}
