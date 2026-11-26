/**
 * SHOOTOUT 4 — 画面の共通部品（ヘッダー・国旗・ボタン・シート）
 * 文字はすべて i18n.js の tr() を通す（画面にキー名を出さない）。
 */

import { CONFIG } from '../config.js';
import { getCountry, countryName } from '../core/countries.js';
import { getShirt, getShorts, getSocks, getBoot } from '../core/skins.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

const ICONS = {
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  ball: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5l3.6 2.6-1.4 4.2h-4.4L8.4 10.1z" fill="currentColor"/><path d="M12 3.5v4M4.6 9.2l3.8 1M19.4 9.2l-3.8 1M7.6 19.4l1.8-3.7M16.4 19.4l-1.8-3.7" stroke="currentColor" stroke-width="1.6"/>',
  shirt: '<path d="M8 4l-4 2.2 1.4 4L8 9v11h8V9l2.6 1.2L20 6.2 16 4l-2 1.4h-4z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>',
  trophy: '<path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5A3.5 3.5 0 0 1 16.5 11M9.5 20h5M12 13v7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  chart: '<path d="M4 20h16M7 20V11M12 20V5M17 20v-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  gear: '<path d="M3.5 7.5h9M17 7.5h3.5M3.5 12h4.5M12 12h8.5M3.5 16.5h7M15 16.5h5.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="15" cy="7.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="10" cy="12" r="2.2" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="13" cy="16.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.9"/>',
  shield: '<path d="M12 3l7 2.6v6.2c0 4.4-3 7.4-7 9.2-4-1.8-7-4.8-7-9.2V5.6z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>',
  globe: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.6 12h16.8M12 3.5c2.6 2.4 2.6 14.6 0 17M12 3.5c-2.6 2.4-2.6 14.6 0 17" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  users: '<circle cx="9" cy="8.5" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19c.5-3.3 2.6-5 5.5-5s5 1.7 5.5 5M16 6.2a3 3 0 0 1 0 5.6M18 19c-.2-2-.9-3.6-2-4.6 2.6-.3 4.3 1.3 4.7 4.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.2 5.2l1.8 1.8M17 17l1.8 1.8M18.8 5.2L17 7M7 17l-1.8 1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-8A1.5 1.5 0 0 0 5 6.5v8A1.5 1.5 0 0 0 6.5 16H8" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  door: '<path d="M14 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7M16 8l4 4-4 4M20 12H10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  id: '<rect x="3.5" y="5" width="17" height="14" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="11" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5.8 16.2c.5-1.7 1.7-2.6 3.2-2.6s2.7.9 3.2 2.6M14.5 9.4h4M14.5 12.4h4M14.5 15.4h2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  body: '<circle cx="12" cy="6.6" r="2.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.6 20c.4-4 2.1-6 4.4-6s4 2 4.4 6M4.8 12.2l1.8-1.4M19.2 12.2l-1.8-1.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  foot: '<path d="M9 3.5h3.2c.5 3 .7 5.6.7 8 0 2.2-.3 3.9-.9 5.2h-3c.6-1.6.9-3.4.9-5.4 0-2.4-.4-5-.9-7.8zM5 19.5h12c1.4 0 2.2-.6 2.2-1.7 0-.9-.6-1.5-1.6-1.6l-3.6-.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  soundwave: '<path d="M4 10v4h3l4 3.5v-11L7 10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 8.6a5 5 0 0 1 0 6.8M17.8 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  soundOff: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15.5 9.5l4.5 5M20 9.5l-4.5 5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  share: '<circle cx="18" cy="5.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="18.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.2 10.8l7.6-4M8.2 13.2l7.6 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};

export function icon(name, className = '') {
  const body = ICONS[name] || ICONS.ball;
  /* どの呼び方でも必ず基本サイズ（.icon）を持たせる（巨大SVGを防ぐ） */
  const classes = [...new Set(['icon', ...String(className).split(/\s+/).filter(Boolean)])].join(' ');
  return `<svg class="${classes}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function flag(code, className = 'flag') {
  const country = getCountry(code);
  return `<img class="${className}" src="${country.flag}" alt="" width="48" height="32" draggable="false">`;
}

/** 国旗の絵文字（ISO 2文字 → 地域表示記号。シェア文面用） */
export function flagEmoji(code) {
  const value = String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  if (value.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...value].map((character) => 0x1f1e6 + character.charCodeAt(0) - 65));
}

export function teamLabel(code, language, extra = '') {
  return `<span class="teamlabel">${flag(code)}<span class="teamlabel__name">${esc(countryName(code, language))}${extra ? `<em>${esc(extra)}</em>` : ''}</span></span>`;
}

export function emblem(className = 'emblem') {
  return `<img class="${className}" src="${CONFIG.emblem}" alt="IPKSF emblem" draggable="false">`;
}

export function brandMark() {
  return `<div class="brandmark">
    ${emblem('brandmark__emblem')}
    <div class="brandmark__text">
      <span class="brandmark__fed">${CONFIG.federation}</span>
      <span class="brandmark__title">SHOOTOUT <b>4</b></span>
    </div>
  </div>`;
}

export function screenShell({ title = '', body = '', back = 'home', actions = '', className = '' }) {
  return `<div class="screen ${className}">
    <header class="topbar">
      ${back ? `<button class="iconbtn" data-action="${back}" aria-label="back">${icon('back')}</button>` : '<span class="iconbtn iconbtn--ghost"></span>'}
      <h1 class="topbar__title">${esc(title)}</h1>
      <div class="topbar__actions">${actions}</div>
    </header>
    <div class="screen__body">${body}</div>
  </div>`;
}

export function settingRow(key, value, options, t) {
  return `<label class="row">
    <span class="row__label">${esc(t(key))}</span>
    <select class="row__select" data-pref="${key}" aria-label="${esc(t(key))}">
      ${options.map(([id, label]) => `<option value="${esc(id)}" ${String(value) === String(id) ? 'selected' : ''}>${esc(label)}</option>`).join('')}
    </select>
  </label>`;
}

export function toggleRow(key, value, t) {
  return `<div class="row">
    <span class="row__label">${esc(t(key))}</span>
    <div class="segmented" role="group" aria-label="${esc(t(key))}">
      <button type="button" data-toggle="${key}" data-value="true" class="seg ${value ? 'is-on' : ''}">${esc(t('on'))}</button>
      <button type="button" data-toggle="${key}" data-value="false" class="seg ${value ? '' : 'is-on'}">${esc(t('off'))}</button>
    </div>
  </div>`;
}

export function shirtChip(shirtId, { small = false } = {}) {
  const shirt = getShirt(shirtId);
  return `<span class="kit kit--${shirt.design} ${small ? 'kit--small' : ''}" style="--kit-primary:${shirt.primary};--kit-secondary:${shirt.secondary};--kit-accent:${shirt.accent};--kit-shorts:${shirt.primary};--kit-socks:${shirt.secondary}" aria-hidden="true"><i class="kit__body"></i></span>`;
}

export function shortsChip(shortsId) {
  const shorts = getShorts(shortsId);
  return `<span class="partchip partchip--shorts" style="--part:${shorts.color};--part-trim:${shorts.trim}" aria-hidden="true"><i></i></span>`;
}

export function socksChip(socksId) {
  const socks = getSocks(socksId);
  return `<span class="partchip partchip--socks" style="--part:${socks.color};--part-trim:${socks.band}" aria-hidden="true"><i></i></span>`;
}

export function bootChip(bootId) {
  const boot = getBoot(bootId);
  return `<span class="bootchip bootchip--${boot.shape}" style="--boot:${boot.color};--boot-sole:${boot.sole}" aria-hidden="true"></span>`;
}

export function statusLine(text, kind = '') {
  return `<p class="status ${kind ? `status--${kind}` : ''}" role="status" aria-live="polite">${esc(text)}</p>`;
}
