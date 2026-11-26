/** SHOOTOUT 4 — ロッカー（キャラクター + 4部位: ユニフォーム・パンツ・靴下・スパイク） */

import {
  CHARACTERS, SHIRTS, SHORTS, SOCKS, BOOTS, getShirt, getShorts, getSocks, getBoot,
  getPart, partList, isPartUnlocked, isCharacterUnlocked,
} from '../core/skins.js';
import { bootChip, esc, icon, screenShell, shirtChip, shortsChip, socksChip } from './layout.js';

const PART_META = [
  ['shirt', 'partShirt', 'shirt'],
  ['shorts', 'partShorts', 'shorts'],
  ['socks', 'partSocks', 'socks'],
  ['boots', 'partBoots', 'boots'],
];

const CHIPS = {
  shirt: (id) => shirtChip(id),
  shorts: (id) => shortsChip(id),
  socks: (id) => socksChip(id),
  boots: (id) => bootChip(id),
};

function partTile(part, item, { selected, entitled, t }) {
  const locked = !isPartUnlocked(part, item.id, entitled);
  const setLabel = item.set === 'home' ? t('setHome') : item.set === 'away' ? t('setAway') : t('setPro');
  return `<button class="tile tile--part ${selected ? 'is-on' : ''} ${locked ? 'is-locked' : ''}"
    data-part="${part}" data-item="${item.id}" ${locked ? 'data-action="pro"' : ''}
    data-testid="${part}-${item.id}" aria-pressed="${selected}">
    ${CHIPS[part](item.id)}
    <span class="tile__name">${esc(item.name)}</span>
    <span class="tile__tag">${locked ? `🔒 ${esc(t('proLocked'))}` : esc(setLabel)}</span>
  </button>`;
}

function characterTile(character, { selected, entitled, t }) {
  const locked = !isCharacterUnlocked(character.id, entitled);
  return `<button class="tile tile--character ${selected ? 'is-on' : ''} ${locked ? 'is-locked' : ''}"
    data-character="${character.id}" ${locked ? 'data-action="pro"' : ''}
    data-testid="character-${character.id}" aria-pressed="${selected}">
    <span class="figure figure--${character.id}" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="tile__name">${esc(character.id === 'voxel' ? t('charVoxel') : t('charStylized'))}</span>
    <span class="tile__tag">${locked ? `🔒 ${esc(t('proLocked'))}` : esc(character.pro ? t('setPro') : t('freeTag'))}</span>
  </button>`;
}

export function lockerView({ t, entitled, draft, language, registered = false }) {
  const shirt = getShirt(draft.shirt);
  const shorts = getShorts(draft.shorts);
  const socks = getSocks(draft.socks);
  const boot = getBoot(draft.boots);
  return screenShell({
    title: t('lockerTitle'),
    back: 'home',
    className: 'screen--locker',
    actions: `<button class="btn btn--tiny ${registered ? 'btn--ghost' : 'btn--gold'}" data-action="register" data-testid="open-register">
      ${icon('id')}<span>${esc(registered ? t('registerDone') : t('registerOpen'))}</span></button>`,
    body: `
      <section class="locker__preview locker__preview--${draft.character}"
        style="--k1:${shirt.primary};--k2:${shirt.secondary};--k3:${shirt.accent};--k4:${shorts.color};--k5:${socks.color};--boot:${boot.color}">
        <div class="lineup" data-testid="lineup">
          ${Array.from({ length: 5 }, (_, index) => `<span class="player" style="--n:${index}">
            <i class="player__head"></i>
            <i class="player__body kit--${shirt.design}"></i>
            <i class="player__shorts"></i>
            <i class="player__legs"></i>
            <i class="player__boots"></i>
            <b>${index + 1}</b>
          </span>`).join('')}
        </div>
        <p class="locker__caption">${esc(t('preview'))} · ${esc(shirt.name)} / ${esc(shorts.name)} / ${esc(socks.name)} / ${esc(boot.name)}</p>
      </section>

      <section class="panel">
        <h2 class="section-title">${esc(t('character'))}</h2>
        <div class="tiles tiles--character">
          ${CHARACTERS.map((item) => characterTile(item, { selected: item.id === draft.character, entitled, t })).join('')}
        </div>
        <p class="mini">${esc(t('characterNote'))}</p>
      </section>

      ${PART_META.map(([part, titleKey]) => `<section class="panel" data-testid="locker-${part}">
        <h2 class="section-title">${esc(t(titleKey))}</h2>
        <div class="tiles tiles--parts">
          ${partList(part).map((item) => partTile(part, item, { selected: item.id === draft[part], entitled, t })).join('')}
        </div>
      </section>`).join('')}

      <button class="btn btn--gold btn--xl btn--block" data-action="save-skin" data-testid="save-skin">
        ${icon('check')}<span>${esc(t('apply'))}</span>
      </button>
      <p class="mini">${esc(t('fairness'))}</p>
      <p class="status" id="locker-status" role="status" aria-live="polite"></p>
    `,
  });
}
