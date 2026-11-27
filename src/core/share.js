/**
 * SHOOTOUT 4 — 結果のシェア（Build 9）
 *
 * ここは純粋関数だけ（DOM・Canvas・navigator を知らない）。
 *  ・文面（テキスト）
 *  ・結果カード画像の「モデル」（何を書くか。描画は ui/result-card.js）
 *  ・共有の段取り（画像つき → テキスト → クリップボード → 画像を保存）
 *
 * 画像は 720×900 の PNG。SNS のタイムラインで見やすい縦長で、
 * ロゴ・勝敗・両国の国旗とスコア・PKの○×・日時・戦績/勝ち点を1枚に収める。
 */

import { CONFIG } from '../config.js';
import { getCountry, countryName } from './countries.js';
import { pointsFor } from './ranking.js';

/** 結果カードの大きさ（px）。縦長 4:5 で SNS に貼りやすい */
export const CARD_WIDTH = 720;
export const CARD_HEIGHT = 900;

const pad2 = (value) => String(value).padStart(2, '0');

/** カードに書く日時（端末の時刻）: 2026.11.27 19:42 */
export function formatCardDate(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 共有する PNG のファイル名: shootout4-result-20261127-1942.png */
export function cardFileName(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'shootout4-result.png';
  return `shootout4-result-${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}.png`;
}

/**
 * 結果のシェア文面（Build 4 から）。
 * 国旗絵文字・勝敗・PKスコア・サドンデスなら本数・#SHOOTOUT4・IPKSF を1つの文に。
 * 画像（結果カード）と一緒に送る前提で、画像が無い環境でもこの文面だけで伝わる。
 */
export function buildShareText({ t, state, prefs, language }) {
  const me = getCountry(prefs.country);
  const oppCode = prefs.opponent || 'BR';
  const win = state.winner === 'me';
  const sudden = state.kicks.me.length > CONFIG.kickers || state.kicks.opp.length > CONFIG.kickers;
  const score = `${state.score.me}-${state.score.opp}`;
  const flag = (code) => {
    const value = String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    if (value.length !== 2) return '';
    return String.fromCodePoint(...[...value].map((character) => 0x1f1e6 + character.charCodeAt(0) - 65));
  };
  return [
    `${flag(me.code)} ${t(win ? 'victory' : 'defeat')} ${score} ${flag(oppCode)}`,
    `${countryName(me.code, language)} vs ${countryName(oppCode, language)}`,
    sudden ? t('shareSudden', { kicks: Math.max(state.kicks.me.length, state.kicks.opp.length) }) : '',
    'IPKSF · SHOOTOUT 4',
    '#SHOOTOUT4 #IPKSF',
  ].filter(Boolean).join('\n');
}

/** PKの○×を、蹴った本数ぶん並べる（goal / miss / none） */
function cellStates(list, rounds) {
  return Array.from({ length: rounds }, (_, index) => {
    if (index >= list.length) return 'none';
    return list[index] ? 'goal' : 'miss';
  });
}

/**
 * 結果カードに描く内容（モデル）。
 * 描画（Canvas）は ui/result-card.js が受け持つので、ここでは「値」だけを返す。
 */
export function buildResultCardModel({
  state,
  prefs = {},
  language = 'ja',
  t = null,
  standing = null,
  record = null,
  online = false,
  date = new Date(),
} = {}) {
  const tr = typeof t === 'function' ? t : (key, vars) => {
    if (!vars) return String(key);
    return Object.entries(vars).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), String(key));
  };
  const win = state.winner === 'me';
  const sudden = state.kicks.me.length > CONFIG.kickers || state.kicks.opp.length > CONFIG.kickers;
  const rounds = Math.max(CONFIG.kickers, state.kicks.me.length, state.kicks.opp.length);
  const me = getCountry(prefs.country);
  const oppCode = String(prefs.opponent || 'BR').toUpperCase();
  const opp = getCountry(oppCode);

  const totalPoints = standing && standing.total && Number.isFinite(Number(standing.total.points))
    ? Number(standing.total.points)
    : null;
  const wins = Number(record && record.wins) || 0;
  const losses = Number(record && record.losses) || 0;
  const played = Number(record && record.played) || wins + losses;
  const rate = played > 0 ? Math.round((wins / played) * 100) : 0;

  /* 下段の情報: 通信対戦は「勝ち点」、CPU戦は「通算成績」 */
  const info = online && totalPoints !== null
    ? `${tr('points')} +${pointsFor({ win, sudden })} · ${tr('rankPointsShort', { points: totalPoints })}`
    : tr('rankRecord', { wins, losses, rate });

  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    brand: CONFIG.brand,
    title: CONFIG.title,
    federation: CONFIG.federation,
    eyebrow: `${tr(online ? 'onlineTitle' : 'matchSummary')}${sudden ? ` · ${tr('suddenDeath')}` : ''}`,
    headline: tr(win ? 'victory' : 'defeat'),
    win,
    sudden,
    score: { me: Number(state.score.me) || 0, opp: Number(state.score.opp) || 0 },
    sides: {
      me: {
        code: me.code,
        name: countryName(me.code, language),
        flag: me.flag,
        first: state.first === 'me',
        order: tr(state.first === 'me' ? 'firstKick' : 'secondKick'),
      },
      opp: {
        code: opp.code,
        name: countryName(opp.code, language),
        flag: opp.flag,
        first: state.first === 'opp',
        order: tr(state.first === 'opp' ? 'firstKick' : 'secondKick'),
      },
    },
    rounds,
    cells: {
      me: cellStates(state.kicks.me, rounds),
      opp: cellStates(state.kicks.opp, rounds),
    },
    date: formatCardDate(date),
    info,
    tags: '#SHOOTOUT4 #IPKSF',
    footer: `${CONFIG.brand} · ${CONFIG.title}`,
    build: CONFIG.build,
  };
}

/**
 * 共有の段取り（上から順に試す）。
 *
 *   share-image … navigator.share({ files }) で画像＋文面（iOS 15+ / Android Chrome）
 *   share-text  … navigator.share({ text })。画像が使えない環境・失敗したとき
 *   clipboard   … 文面をクリップボードへ（必ず成功させたい受け皿）
 *   download    … 画像をファイルとして保存（PC・タッチが無い環境）
 *   show        … どれも無ければ文面を画面に出す（トースト）
 *
 * どの段も「失敗しても次へ」なので、共有がエラーで止まることはない。
 */
export function pickShareStrategy({
  hasShare = false,
  hasFiles = false,
  canShareFiles = false,
  hasClipboard = false,
  canDownload = false,
} = {}) {
  const plan = [];
  if (hasShare && hasFiles && canShareFiles) plan.push('share-image');
  if (hasShare) plan.push('share-text');
  if (hasClipboard) plan.push('clipboard');
  if (canDownload && hasFiles) plan.push('download');
  if (!plan.length) plan.push('show');
  return plan;
}
