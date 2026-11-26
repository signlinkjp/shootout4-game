/** SHOOTOUT 4 — ロッカー（ユニフォーム＆スパイク） */

import { KITS, BOOTS, getKit, getBoot, isKitUnlocked, isBootUnlocked } from '../core/skins.js';
import { bootChip, esc, icon, kitChip, screenShell } from './layout.js';

function kitTile(kit, { selected, entitled, t }) {
  const locked = !isKitUnlocked(kit.id, entitled);
  return `<button class="tile tile--kit ${selected ? 'is-on' : ''} ${locked ? 'is-locked' : ''}"
    data-kit="${kit.id}" ${locked ? 'data-action="pro"' : ''} data-testid="kit-${kit.id}"
    aria-pressed="${selected}">
    ${kitChip(kit.id)}
    <span class="tile__name">${esc(kit.name)}</span>
    <span class="tile__tag">${locked ? `🔒 ${esc(t('proTag'))}` : (kit.pro ? esc(t('proTag')) : esc(t('freeTag')))}</span>
  </button>`;
}

function bootTile(boot, { selected, entitled, t }) {
  const locked = !isBootUnlocked(boot.id, entitled);
  return `<button class="tile tile--boot ${selected ? 'is-on' : ''} ${locked ? 'is-locked' : ''}"
    data-boot="${boot.id}" ${locked ? 'data-action="pro"' : ''} data-testid="boot-${boot.id}"
    aria-pressed="${selected}">
    ${bootChip(boot.id)}
    <span class="tile__name">${esc(boot.name)}</span>
    <span class="tile__tag">${locked ? `🔒 ${esc(t('proTag'))}` : (boot.pro ? esc(t('proTag')) : esc(t('freeTag')))}</span>
  </button>`;
}

export function lockerView({ t, entitled, draft, language }) {
  const kit = getKit(draft.kit);
  const boot = getBoot(draft.boot);
  return screenShell({
    title: t('lockerTitle'),
    back: 'home',
    className: 'screen--locker',
    actions: entitled ? '' : `<button class="btn btn--tiny btn--gold" data-action="pro">${esc(t('proLocked'))}</button>`,
    body: `
      <section class="locker__preview" style="--k1:${kit.primary};--k2:${kit.secondary};--k3:${kit.accent};--k4:${kit.shorts};--k5:${kit.socks};--boot:${boot.color}">
        <div class="lineup" data-testid="lineup">
          ${Array.from({ length: 5 }, (_, index) => `<span class="player" style="--n:${index}">
            <i class="player__head"></i>
            <i class="player__body"></i>
            <i class="player__shorts"></i>
            <i class="player__legs"></i>
            <i class="player__boots"></i>
            <b>${index + 1}</b>
          </span>`).join('')}
        </div>
        <p class="locker__caption">${esc(t('preview'))} · ${esc(kit.name)} / ${esc(boot.name)}</p>
      </section>

      <section class="panel">
        <h2 class="section-title">${esc(t('kit'))}</h2>
        <div class="tiles">${KITS.map((item) => kitTile(item, { selected: item.id === draft.kit, entitled, t })).join('')}</div>
      </section>

      <section class="panel">
        <h2 class="section-title">${esc(t('boots'))}</h2>
        <div class="tiles tiles--boots">${BOOTS.map((item) => bootTile(item, { selected: item.id === draft.boot, entitled, t })).join('')}</div>
      </section>

      <button class="btn btn--gold btn--xl btn--block" data-action="save-skin" data-testid="save-skin">
        ${icon('check')}<span>${esc(t('apply'))}</span>
      </button>
      <p class="mini">${esc(t('fairness'))}</p>
      <p class="status" id="locker-status" role="status" aria-live="polite"></p>
    `,
  });
}
