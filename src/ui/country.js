/** SHOOTOUT 4 — 国えらび（自分の国・相手の国・CPUの強さ） */

import { COUNTRIES, countryName, getCountry, isCountryUnlocked } from '../core/countries.js';
import { LEVELS, levelStars } from '../core/cpu.js';
import { countryKit } from '../core/countries.js';
import { flag, icon, esc, screenShell } from './layout.js';

function strip({ t, selected, action, language, entitled }) {
  return `<div class="strip" role="listbox" aria-label="${esc(t('countryTitle'))}">
    ${COUNTRIES.map((country) => {
      const locked = !isCountryUnlocked(country.code, entitled);
      return `<button class="strip__item ${country.code === selected ? 'is-on' : ''} ${locked ? 'is-locked' : ''}"
        role="option" aria-selected="${country.code === selected}"
        data-${action}="${country.code}" data-testid="${action}-${country.code}">
        ${flag(country.code)}
        <span>${esc(countryName(country.code, language))}</span>
        ${locked ? `<em class="strip__pro">🔒 PRO</em>` : ''}
      </button>`;
    }).join('')}
  </div>`;
}

export function countryView({ t, prefs, entitled, language }) {
  const me = getCountry(prefs.country);
  const opp = getCountry(prefs.opponent || 'BR');
  const opponentAction = 'opponent';
  const kitColor = countryKit(opp.code);
  return screenShell({
    title: t('countryTitle'),
    back: 'home',
    className: 'screen--country',
    body: `
      <section class="panel">
        <h2 class="section-title">${esc(t('yourCountry'))}</h2>
        ${strip({ t, selected: me.code, action: 'mycountry', language, entitled })}
      </section>

      <section class="panel">
        <div class="section-head">
          <h2 class="section-title">${esc(t('opponentCountry'))}</h2>
          <button class="btn btn--tiny" data-action="random-opponent">${esc(t('randomOpponent'))}</button>
        </div>
        ${strip({ t, selected: opp.code, action: opponentAction, language, entitled })}
        <div class="row row--stack">
          <span class="row__label">${esc(t('cpuLevel'))}</span>
          <div class="segmented segmented--four" role="group" aria-label="${esc(t('cpuLevel'))}">
            ${LEVELS.map((level) => `<button type="button" class="seg ${prefs.level === level ? 'is-on' : ''}"
              data-level="${level}" data-testid="level-${level}">
              <span>${esc(t(`level_${level}`))}</span>
              <span class="stars" aria-hidden="true">${'★'.repeat(levelStars(level))}</span>
            </button>`).join('')}
          </div>
        </div>
      </section>

      <section class="versus" aria-label="match up">
        <div class="versus__side">
          ${flag(me.code, 'flag flag--xl')}
          <b>${esc(countryName(me.code, language))}</b>
          <span class="versus__tag">${esc(t('you'))}</span>
        </div>
        <div class="versus__mid">
          <span class="versus__vs">VS</span>
          <span class="versus__level">${'★'.repeat(levelStars(prefs.level))}</span>
        </div>
        <div class="versus__side">
          ${flag(opp.code, 'flag flag--xl')}
          <b>${esc(countryName(opp.code, language))}</b>
          <span class="versus__tag" style="--opp:${kitColor.primary}">${esc(t('opponent'))}</span>
        </div>
      </section>

      <button class="btn btn--primary btn--xl btn--block" data-action="kickoff" data-testid="kickoff">
        ${icon('ball')}<span>${esc(t('startMatch'))}</span>
      </button>
      <div class="country__note">
        <p class="mini">${esc(t('fairness'))}</p>
        <p class="mini">${esc(t('proBenefitCountries'))} · ${esc(t('versionNote'))}</p>
      </div>
    `,
  });
}
