/** SHOOTOUT 4 — IPKSF 公式選手登録（言語・代表国籍・チーム名・名前と利き足・チームメイト） */

import { COUNTRIES, countryName } from '../core/countries.js';
import { LANGUAGES, LANGUAGE_NAMES } from '../i18n.js';
import { esc, icon, screenShell } from './layout.js';

function footRow({ t, value, player, label }) {
  return `<div class="row row--stack">
    <span class="row__label">${esc(label)}</span>
    <div class="segmented" role="group" aria-label="${esc(label)}">
      <button type="button" class="seg ${value === 'right' ? 'is-on' : ''}" data-foot="right" data-reg-player="${player}">${esc(t('footRight'))}</button>
      <button type="button" class="seg ${value === 'left' ? 'is-on' : ''}" data-foot="left" data-reg-player="${player}">${esc(t('footLeft'))}</button>
    </div>
  </div>`;
}

export function registerView({ t, draft, prefs, language, back = 'locker' }) {
  const teammates = draft.teammates || [];
  return screenShell({
    title: t('registerTitle'),
    back,
    className: 'screen--register',
    body: `
      <section class="panel register">
        <p class="rules-text">${esc(t('registerIntro'))}</p>
        <p class="notice notice--soft">${icon('globe')}<span>${esc(t('registerForWorld'))}</span></p>

        <label class="row row--stack">
          <span class="row__label">${esc(t('language'))}</span>
          <select class="row__select" data-reg="language" aria-label="${esc(t('language'))}">
            ${LANGUAGES.map((code, index) => `<option value="${code}" ${(draft.language || prefs.language) === code ? 'selected' : ''}>${esc(LANGUAGE_NAMES[index])}</option>`).join('')}
          </select>
        </label>

        <label class="row row--stack">
          <span class="row__label">${esc(t('registerCountry'))}</span>
          <select class="row__select" data-reg="country" aria-label="${esc(t('registerCountry'))}" data-testid="register-country">
            ${COUNTRIES.map((country) => `<option value="${country.code}" ${(draft.country || prefs.country) === country.code ? 'selected' : ''}>${esc(countryName(country.code, language))}</option>`).join('')}
          </select>
        </label>

        <label class="row row--stack">
          <span class="row__label">${esc(t('registerTeam'))}</span>
          <input class="textinput" type="text" maxlength="16" autocomplete="off" spellcheck="false"
            data-reg="teamName" value="${esc(draft.teamName || '')}" placeholder="${esc(t('registerTeam'))}"
            aria-label="${esc(t('registerTeam'))}" data-testid="register-team">
        </label>

        <label class="row row--stack">
          <span class="row__label">${esc(t('registerUser'))}</span>
          <input class="textinput" type="text" maxlength="12" autocomplete="off" spellcheck="false"
            data-reg="userName" value="${esc(draft.userName || '')}" placeholder="${esc(t('registerUser'))}"
            aria-label="${esc(t('registerUser'))}" data-testid="register-user">
        </label>

        ${footRow({ t, value: draft.foot, player: 1, label: t('registerFoot') })}
      </section>

      <section class="panel">
        <h2 class="section-title">${esc(t('registerTeammates'))}</h2>
        ${teammates.map((player, index) => `<div class="teammate" data-testid="teammate-${index + 2}">
          <div class="teammate__head">
            <span class="teammate__no">#${index + 2}</span>
            <span class="teammate__label">${esc(t('registerTeammate'))} ${index + 2}</span>
          </div>
          <input class="textinput" type="text" maxlength="12" autocomplete="off" spellcheck="false"
            data-reg-teammate="${index}" value="${esc(player.name || '')}" placeholder="Player ${index + 2}"
            aria-label="${esc(t('registerTeammate'))} ${index + 2}">
          ${footRow({ t, value: player.foot, player: index + 2, label: t('registerFoot') })}
        </div>`).join('')}
        <p class="mini">${esc(t('registerOptional'))}</p>
      </section>

      <button class="btn btn--gold btn--xl btn--block" data-action="save-registration" data-testid="save-registration">
        ${icon('check')}<span>${esc(t('registerSave'))}</span>
      </button>
      <p class="status" id="register-status" role="status" aria-live="polite"></p>
      <p class="mini">${esc(t('fairness'))}</p>
    `,
  });
}
