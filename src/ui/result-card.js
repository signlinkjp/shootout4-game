/**
 * SHOOTOUT 4 — 結果カード（PNG）の描画（Build 9）
 *
 * 720×900 の 2D Canvas に、IPKSF / SHOOTOUT 4 のロゴ、勝敗、両国の国旗・国名・
 * スコア、PKの○×表、日時と戦績（通信対戦は勝ち点）を描く。
 *
 * ここは「描く」だけ。何を書くかは core/share.js の buildResultCardModel が決める。
 * Canvas が無い環境（単体テスト）でも、2D コンテキストを渡せば同じ絵を描ける。
 */

import { CARD_WIDTH, CARD_HEIGHT, cardFileName } from '../core/share.js';

const FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Segoe UI", system-ui, sans-serif';

const COLORS = {
  gold: '#ffd66b',
  goldDeep: '#e2b04a',
  white: '#f4f8ff',
  soft: '#c9d7f0',
  muted: '#93a6c8',
  dim: '#64769a',
  miss: '#ff7189',
  win: '#ffd66b',
  lose: '#b6c6e4',
};

const CARD = {
  flags: { y: 456, w: 96, h: 64, left: 64, right: 560 },
  table: { labelX: 64, cellX: 196, cell: 50, gap: 10, header: 628, me: 644, opp: 706, max: 7 },
};

/* ------------------------------------------------------------------ *\
 * 小道具
 * ------------------------------------------------------------------ */

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, fillStyle) {
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function strokeRoundRect(ctx, x, y, width, height, radius, strokeStyle, lineWidth = 1) {
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function setFont(ctx, size, weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

/** 幅に収まるまで文字を小さくする（長い国名・勝敗見出し用） */
function fitFont(ctx, text, maxWidth, startSize, weight = 700) {
  let size = startSize;
  setFont(ctx, size, weight);
  while (size > 11 && ctx.measureText(String(text)).width > maxWidth) {
    size -= 1;
    setFont(ctx, size, weight);
  }
  return size;
}

/** 文字間を空けて1文字ずつ描く（letterSpacing 非対応の環境でも同じ見た目） */
function spacedText(ctx, text, x, y, spacing, { align = 'center', color = COLORS.white, size = 16, weight = 700 } = {}) {
  const value = String(text || '');
  const characters = [...value];
  if (!characters.length) return 0;
  setFont(ctx, size, weight);
  const widths = characters.map((character) => ctx.measureText(character).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + spacing * (characters.length - 1);
  let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  characters.forEach((character, index) => {
    ctx.fillText(character, cursor, y);
    cursor += widths[index] + spacing;
  });
  return total;
}

function text(ctx, value, x, y, { align = 'center', color = COLORS.white, size = 16, weight = 700 } = {}) {
  setFont(ctx, size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(String(value ?? ''), x, y);
}

/* ------------------------------------------------------------------ *\
 * 背景・ロゴ
 * ------------------------------------------------------------------ */

function drawBackground(ctx, model) {
  const sky = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
  sky.addColorStop(0, '#081a38');
  sky.addColorStop(0.55, '#0a2149');
  sky.addColorStop(1, '#050e20');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  /* スタジアムの光（上は金色、下は青） */
  const top = ctx.createRadialGradient(360, 60, 20, 360, 60, 460);
  top.addColorStop(0, model.win ? 'rgba(255,208,96,0.20)' : 'rgba(120,170,255,0.14)');
  top.addColorStop(1, 'rgba(8,26,56,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, CARD_WIDTH, 620);

  const bottom = ctx.createRadialGradient(360, CARD_HEIGHT, 20, 360, CARD_HEIGHT, 480);
  bottom.addColorStop(0, 'rgba(64,150,255,0.16)');
  bottom.addColorStop(1, 'rgba(5,14,32,0)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 380, CARD_WIDTH, CARD_HEIGHT - 380);

  /* 芝のストライプ（ごく薄く） */
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = '#8fe3b0';
  ctx.lineWidth = 30;
  for (let i = -2; i < 8; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * 120 - 120, CARD_HEIGHT);
    ctx.lineTo(i * 120 + 220, 0);
    ctx.stroke();
  }
  ctx.restore();

  /* 縁の暗さ（四隅を締める） */
  const vignette = ctx.createRadialGradient(360, 450, 240, 360, 450, 560);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  strokeRoundRect(ctx, 16, 16, CARD_WIDTH - 32, CARD_HEIGHT - 32, 34, 'rgba(255,255,255,0.13)', 2);
  strokeRoundRect(ctx, 24, 24, CARD_WIDTH - 48, CARD_HEIGHT - 48, 28, 'rgba(255,214,102,0.20)', 1);
}

function drawBall(ctx, x, y, radius, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();

  const inner = radius * 0.42;
  const points = [];
  for (let i = 0; i < 5; i += 1) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 5;
    points.push([x + Math.cos(angle) * inner, y + Math.sin(angle) * inner]);
  }
  ctx.beginPath();
  points.forEach(([px, py], index) => (index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  points.forEach(([px, py]) => {
    const angle = Math.atan2(py - y, px - x);
    ctx.moveTo(px, py);
    ctx.lineTo(x + Math.cos(angle) * radius * 0.96, y + Math.sin(angle) * radius * 0.96);
  });
  ctx.stroke();
  ctx.restore();
}

function drawEmblem(ctx, emblem) {
  const center = { x: 360, y: 84 };
  if (emblem && emblem.width && emblem.height) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, 36, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(emblem, center.x - 36, center.y - 36, 72, 72);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(center.x, center.y, 36, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,214,102,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.arc(center.x, center.y, 36, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,214,102,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();
  drawBall(ctx, center.x, center.y, 21, COLORS.gold);
}

function drawHeader(ctx, model, images = {}) {
  drawEmblem(ctx, images.emblem);

  spacedText(ctx, model.brand, 360, 160, 12, { size: 22, color: COLORS.gold, weight: 800 });
  const titleSize = fitFont(ctx, model.title, 600, 56, 800);
  text(ctx, model.title, 360, 160 + titleSize * 0.86, { size: titleSize, weight: 800, color: COLORS.white });

  const federation = String(model.federation || '');
  const fedSize = federation.length > 48 ? 8 : 9;
  spacedText(ctx, federation, 360, 244, 1.8, { size: fedSize, color: 'rgba(180,199,228,0.65)', weight: 600 });

  /* 仕切り線（中央に菱形） */
  const line = ctx.createLinearGradient(150, 0, 570, 0);
  line.addColorStop(0, 'rgba(255,214,102,0)');
  line.addColorStop(0.5, 'rgba(255,214,102,0.55)');
  line.addColorStop(1, 'rgba(255,214,102,0)');
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(150, 266);
  ctx.lineTo(570, 266);
  ctx.stroke();
  ctx.save();
  ctx.translate(360, 266);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = COLORS.gold;
  ctx.fillRect(-4, -4, 8, 8);
  ctx.restore();
}

/* ------------------------------------------------------------------ *\
 * 本文（見出し・スコア・PK表・情報）
 * ------------------------------------------------------------------ */

function drawEyebrow(ctx, model) {
  const label = String(model.eyebrow || '');
  setFont(ctx, 15, 700);
  const width = ctx.measureText(label).width + 46;
  const y = 292;
  fillRoundRect(ctx, 360 - width / 2, y, width, 34, 17, 'rgba(255,255,255,0.07)');
  strokeRoundRect(ctx, 360 - width / 2, y, width, 34, 17, 'rgba(255,255,255,0.14)', 1);
  text(ctx, label, 360, y + 22, { size: 15, weight: 700, color: COLORS.soft });
}

function drawHeadline(ctx, model) {
  const headline = String(model.headline || '');
  const size = fitFont(ctx, headline, 580, 74, 800);
  ctx.save();
  if (model.win) {
    ctx.shadowColor = 'rgba(255,196,64,0.55)';
    ctx.shadowBlur = 34;
  }
  text(ctx, headline, 360, 410, { size, weight: 800, color: model.win ? COLORS.win : COLORS.lose });
  ctx.restore();
  fillRoundRect(ctx, 318, 426, 84, 4, 2, model.win ? 'rgba(255,214,102,0.85)' : 'rgba(182,198,228,0.5)');
}

function drawFlag(ctx, image, side, x, y, width, height) {
  ctx.save();
  roundRectPath(ctx, x, y, width, height, 8);
  ctx.clip();
  if (image && image.width && image.height) {
    ctx.drawImage(image, x, y, width, height);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, width, height);
    text(ctx, side.code, x + width / 2, y + height / 2 + 7, { size: 20, weight: 800, color: COLORS.white });
  }
  ctx.restore();
  strokeRoundRect(ctx, x, y, width, height, 8, 'rgba(255,255,255,0.28)', 1.4);
}

function drawScore(ctx, model, images = {}) {
  const me = model.sides.me;
  const opp = model.sides.opp;
  const { flags } = CARD;

  drawFlag(ctx, images.me, me, flags.left, flags.y, flags.w, flags.h);
  drawFlag(ctx, images.opp, opp, flags.right, flags.y, flags.w, flags.h);

  /* 国名（長い名前は収まるまで小さく） */
  const nameMe = fitFont(ctx, me.name, 200, 21, 700);
  text(ctx, me.name, flags.left + flags.w / 2, flags.y + flags.h + 32, { size: nameMe, weight: 700, color: me.first ? COLORS.white : COLORS.soft });
  const nameOpp = fitFont(ctx, opp.name, 200, 21, 700);
  text(ctx, opp.name, flags.right + flags.w / 2, flags.y + flags.h + 32, { size: nameOpp, weight: 700, color: opp.first ? COLORS.white : COLORS.soft });

  /* 先攻 / 後攻 */
  text(ctx, me.order, flags.left + flags.w / 2, flags.y + flags.h + 54, { size: 12, weight: 600, color: COLORS.dim });
  text(ctx, opp.order, flags.right + flags.w / 2, flags.y + flags.h + 54, { size: 12, weight: 600, color: COLORS.dim });

  /* スコア（勝った側を金色に） */
  const scoreSize = 88;
  text(ctx, model.score.me, 292, 526, { size: scoreSize, weight: 800, color: model.win ? COLORS.win : COLORS.soft });
  text(ctx, '–', 360, 518, { size: 46, weight: 700, color: 'rgba(180,199,228,0.55)' });
  text(ctx, model.score.opp, 428, 526, { size: scoreSize, weight: 800, color: model.win ? COLORS.soft : COLORS.win });
}

function drawCell(ctx, x, y, size, state) {
  const radius = 12;
  if (state === 'goal') {
    fillRoundRect(ctx, x, y, size, size, radius, 'rgba(255,214,102,0.14)');
    strokeRoundRect(ctx, x, y, size, size, radius, 'rgba(255,214,102,0.62)', 1.4);
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size * 0.24, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = 3;
    ctx.stroke();
    return;
  }
  if (state === 'miss') {
    fillRoundRect(ctx, x, y, size, size, radius, 'rgba(255,113,137,0.12)');
    strokeRoundRect(ctx, x, y, size, size, radius, 'rgba(255,113,137,0.5)', 1.4);
    const inset = size * 0.3;
    ctx.strokeStyle = COLORS.miss;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + inset, y + inset);
    ctx.lineTo(x + size - inset, y + size - inset);
    ctx.moveTo(x + size - inset, y + inset);
    ctx.lineTo(x + inset, y + size - inset);
    ctx.stroke();
    ctx.lineCap = 'butt';
    return;
  }
  fillRoundRect(ctx, x, y, size, size, radius, 'rgba(255,255,255,0.04)');
  strokeRoundRect(ctx, x, y, size, size, radius, 'rgba(255,255,255,0.08)', 1);
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
}

function drawTableHeader(ctx, model, columns, startIndex) {
  const { table } = CARD;
  const sudden = Boolean(model.sudden);
  text(ctx, 'PK', table.labelX, table.header, { align: 'left', size: 13, weight: 800, color: COLORS.gold });
  if (sudden) {
    setFont(ctx, 13, 800);
    text(ctx, '· SD', table.labelX + ctx.measureText('PK').width + 8, table.header, { align: 'left', size: 11, weight: 700, color: COLORS.muted });
  }
  columns.forEach((index) => {
    const x = table.cellX + (index - startIndex) * (table.cell + table.gap) + table.cell / 2;
    text(ctx, index + 1, x, table.header, { size: 12, weight: 700, color: index >= 5 ? COLORS.gold : COLORS.dim });
  });
}

function drawTableRow(ctx, { side, color, states, columns, y, image }) {
  const { table } = CARD;
  drawFlag(ctx, image, side, table.labelX, y + 14, 30, 20);
  text(ctx, side.code, table.labelX + 38, y + 31, { align: 'left', size: 16, weight: 800, color });
  columns.forEach((index, position) => {
    const x = table.cellX + position * (table.cell + table.gap);
    drawCell(ctx, x, y, table.cell, states[index] || 'none');
  });
}

function drawTable(ctx, model, images = {}) {
  const { table } = CARD;
  const rounds = Math.max(5, Number(model.rounds) || 5);
  const shown = Math.min(rounds, table.max);
  const startIndex = rounds - shown;
  const columns = Array.from({ length: shown }, (_, index) => startIndex + index);

  drawTableHeader(ctx, model, columns, startIndex);
  drawTableRow(ctx, {
    side: model.sides.me,
    color: model.win ? COLORS.gold : COLORS.white,
    states: model.cells.me,
    columns,
    y: table.me,
    image: images.me,
  });
  drawTableRow(ctx, {
    side: model.sides.opp,
    color: model.win ? COLORS.white : COLORS.gold,
    states: model.cells.opp,
    columns,
    y: table.opp,
    image: images.opp,
  });

  if (rounds > shown) {
    const x = table.cellX + shown * (table.cell + table.gap) + 4;
    text(ctx, `+${rounds - shown}`, Math.min(x, 660), table.opp + 30, { align: 'left', size: 13, weight: 700, color: COLORS.muted });
  }
}

function drawFooter(ctx, model) {
  const line = ctx.createLinearGradient(64, 0, 656, 0);
  line.addColorStop(0, 'rgba(255,255,255,0)');
  line.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  line.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(64, 776);
  ctx.lineTo(656, 776);
  ctx.stroke();

  text(ctx, model.date, 64, 806, { align: 'left', size: 15, weight: 600, color: COLORS.muted });
  text(ctx, model.info, 656, 806, { align: 'right', size: 15, weight: 700, color: COLORS.soft });

  spacedText(ctx, model.tags, 360, 852, 0.6, { size: 19, color: '#a9c8ff', weight: 800 });
  spacedText(ctx, model.footer, 360, 876, 3, { size: 10.5, color: 'rgba(160,180,214,0.66)', weight: 600 });
}

/* ------------------------------------------------------------------ *\
 * 公開API
 * ------------------------------------------------------------------ */

/**
 * 結果カードを描く。
 * images … { emblem, me, opp }（HTMLImageElement か、幅・高さを持つ drawImage 可能なもの）
 */
export function drawResultCard(ctx, model, images = {}) {
  if (!ctx || !model) return false;
  ctx.save();
  try {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    drawBackground(ctx, model);
    drawHeader(ctx, model, images);
    drawEyebrow(ctx, model);
    drawHeadline(ctx, model);
    drawScore(ctx, model, images);
    drawTable(ctx, model, images);
    drawFooter(ctx, model);
  } finally {
    ctx.restore();
  }
  return true;
}

/** カード用の Canvas を作る（document が無ければ null） */
export function createCardCanvas(doc = typeof document === 'undefined' ? null : document) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  const canvas = doc.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  return canvas;
}

/** 画像を読み込む。失敗・時間切れは null（描画は文字と色で続ける） */
export function loadImage(src, { doc = typeof document === 'undefined' ? null : document, timeoutMs = 1500 } = {}) {
  if (!doc || typeof doc.createElement !== 'function' || !src) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const image = doc.createElement('img');
    image.onload = () => done(image);
    image.onerror = () => done(null);
    try {
      image.decoding = 'async';
      image.src = src;
      if (typeof image.decode === 'function') image.decode().then(() => done(image)).catch(() => done(null));
    } catch {
      done(null);
    }
    setTimeout(() => done(null), timeoutMs);
  });
}

/** 国旗とエンブレムをまとめて読む（カード1枚ぶん） */
export async function loadCardImages(model, { doc, timeoutMs = 1500 } = {}) {
  const mePath = model?.sides?.me?.flag;
  const oppPath = model?.sides?.opp?.flag;
  const [emblem, me, opp] = await Promise.all([
    loadImage('assets/emblem-512.png', { doc, timeoutMs }),
    loadImage(mePath, { doc, timeoutMs }),
    loadImage(oppPath, { doc, timeoutMs }),
  ]);
  return { emblem, me, opp };
}

/** Canvas → PNG の Blob（toBlob が無い・失敗する環境は dataURL 経由） */
export async function canvasToPngBlob(canvas) {
  if (!canvas) return null;
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        canvas.toBlob((value) => done(value), 'image/png');
      } catch {
        done(null);
      }
      setTimeout(() => done(null), 3000);
    });
    if (blob && blob.type === 'image/png') return blob;
  }
  if (typeof canvas.toDataURL === 'function') {
    try {
      const url = String(canvas.toDataURL('image/png'));
      if (url.startsWith('data:image/png')) return dataUrlToBlob(url);
    } catch {
      /* 失敗したら null */
    }
  }
  return null;
}

/** data:image/png;base64,... → Blob */
export function dataUrlToBlob(url) {
  const [head, body] = String(url).split(',');
  if (!body || !/^data:image\/png;base64$/i.test(head)) return null;
  try {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: 'image/png' });
  } catch {
    return null;
  }
}

/** モデル → canvas → PNG Blob。どこかで失敗したら null（共有は文面だけで続く） */
export async function renderResultCard(model, { doc, images = null, timeoutMs = 1500 } = {}) {
  const canvas = createCardCanvas(doc);
  if (!canvas) return { canvas: null, blob: null, images: {} };
  let loaded = images;
  if (!loaded) {
    try {
      loaded = await loadCardImages(model, { doc, timeoutMs });
    } catch {
      loaded = {};
    }
  }
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) return { canvas, blob: null, images: loaded || {} };
  drawResultCard(ctx, model, loaded || {});
  const blob = await canvasToPngBlob(canvas);
  return { canvas, blob, images: loaded || {} };
}

/** 共有用の File（名前・MIME つき）。Blob が無ければ null */
export function resultCardFile(blob, date = new Date()) {
  if (!blob) return null;
  const name = cardFileName(date);
  try {
    return new File([blob], name, { type: 'image/png' });
  } catch {
    /* File が無い環境（古い WebView）は Blob に名前を付けて代用 */
    try {
      blob.name = name;
    } catch {
      /* 付けられなくても共有は試せる */
    }
    return blob;
  }
}
