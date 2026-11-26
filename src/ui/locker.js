/** SHOOTOUT 4 — ロッカー（3Dプレビュー + キャラクター + 4部位 + 攻撃順） */

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

/** プレビュー枠に出す「いま表示中のキャラ」のバッジ（日本語・中文・韓国語は全角括弧） */
function characterBadge(character, entitled, t, language) {
  const name = character.id === 'voxel' ? t('charVoxel') : t('charStylized');
  const tag = character.id === 'voxel' ? t('freeTag') : (entitled ? t('proTag') : t('setPro'));
  const wide = /^(ja|zh|ko)/.test(String(language || ''));
  const badge = wide ? `${name}（${tag}）` : `${name} (${tag})`;
  return { name, tag, badge };
}

export function lockerView({ t, entitled, draft, language, registered = false, order = 'first' }) {
  const shirt = getShirt(draft.shirt);
  const shorts = getShorts(draft.shorts);
  const socks = getSocks(draft.socks);
  const boot = getBoot(draft.boots);
  const character = CHARACTERS.find((item) => item.id === draft.character) || CHARACTERS[0];
  const badge = characterBadge(character, entitled, t, language);
  return screenShell({
    title: t('lockerTitle'),
    back: 'home',
    className: 'screen--locker',
    actions: `<button class="btn btn--tiny ${registered ? 'btn--ghost' : 'btn--gold'}" data-action="register" data-testid="open-register">
      ${icon('id')}<span>${esc(registered ? t('registerDone') : t('registerOpen'))}</span></button>`,
    body: `
      <section class="locker__preview locker__preview--${draft.character}"
        data-preview-character="${draft.character}" data-testid="locker-preview-panel"
        style="--k1:${shirt.primary};--k2:${shirt.secondary};--k3:${shirt.accent};--k4:${shorts.color};--k5:${socks.color};--boot:${boot.color}">
        <canvas class="locker__canvas" id="locker-preview" data-testid="locker-preview" aria-label="${esc(badge.name)}"></canvas>
        <div class="lineup" data-testid="lineup" id="locker-lineup" hidden>
          ${Array.from({ length: 5 }, (_, index) => `<span class="player" style="--n:${index}">
            <i class="player__head"></i>
            <i class="player__body kit--${shirt.design}"></i>
            <i class="player__shorts"></i>
            <i class="player__legs"></i>
            <i class="player__boots"></i>
            <b>${index + 1}</b>
          </span>`).join('')}
        </div>
        <div class="locker__badges">
          <span class="locker__badge locker__badge--character" data-testid="preview-badge"
            data-character-badge="${character.id}">${esc(badge.badge)}</span>
          <span class="locker__badge locker__badge--kit" data-testid="preview-kit">${esc(shirt.name)}</span>
        </div>
        <p class="locker__caption">${esc(shirt.name)} / ${esc(shorts.name)} / ${esc(socks.name)} / ${esc(boot.name)}</p>
      </section>

      <section class="panel panel--order" data-testid="locker-order">
        <div class="row row--stack">
          <span class="row__label">${esc(t('kickOrder'))}</span>
          <div class="segmented" role="group" aria-label="${esc(t('kickOrder'))}">
            <button type="button" class="seg ${order === 'second' ? '' : 'is-on'}" data-order="first" data-testid="order-first">${esc(t('firstKick'))}</button>
            <button type="button" class="seg ${order === 'second' ? 'is-on' : ''}" data-order="second" data-testid="order-second">${esc(t('secondKick'))}</button>
          </div>
          <p class="mini">${esc(t('orderNote'))}</p>
        </div>
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
