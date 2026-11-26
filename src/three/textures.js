/**
 * SHOOTOUT 4 — 3D用のテクスチャを canvas で描く（画像ファイルを持たない）
 *
 * すべて普通の <canvas> なので、ネットワークも外部アセットも使わない。
 * 色はキットの指定から作るため、ロッカーで選んだ柄がそのまま3Dに出る。
 */

import { shirtSpec } from '../core/skins.js';

function canvas(width, height) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return element;
}

function shade(hex, amount) {
  const value = hex.replace('#', '');
  const num = parseInt(value.length === 3 ? value.split('').map((c) => c + c).join('') : value, 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 255) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 255) + amount));
  const b = Math.min(255, Math.max(0, (num & 255) + amount));
  return `rgb(${r},${g},${b})`;
}

/** 芝生: 縦縞の刈り跡・土のムラ・白線（ペナルティエリア・アーク・スポット） */
export function pitchTexture() {
  const width = 1024;
  const height = 680;
  const el = canvas(width, height);
  const ctx = el.getContext('2d');

  ctx.fillStyle = '#1d6f3a';
  ctx.fillRect(0, 0, width, height);

  /* 刈り跡（縦縞） */
  const bands = 20;
  for (let i = 0; i < bands; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? '#277c45' : '#1f653a';
    ctx.fillRect((width / bands) * i, 0, width / bands + 1, height);
  }

  /* 細かいムラ */
  for (let i = 0; i < 2600; i += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)';
    ctx.fillRect(x, y, 2 + Math.random() * 5, 12 + Math.random() * 30);
  }

  /* ゴール前のライン（奥がゴール） */
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 12, width - 16, height - 20);

  /* ペナルティエリア（奥） */
  const boxWidth = width * 0.62;
  const boxHeight = height * 0.42;
  ctx.strokeRect((width - boxWidth) / 2, 6, boxWidth, boxHeight);
  /* ゴールエリア */
  const smallWidth = width * 0.28;
  const smallHeight = height * 0.17;
  ctx.strokeRect((width - smallWidth) / 2, 6, smallWidth, smallHeight);
  /* ペナルティスポット */
  const spotY = height * 0.56;
  ctx.beginPath();
  ctx.arc(width / 2, spotY, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  /* アーク */
  ctx.beginPath();
  ctx.arc(width / 2, spotY, height * 0.24, Math.PI * 0.18, Math.PI * 0.82);
  ctx.stroke();

  return el;
}

/** ゴールネット: 透明地に白い網。alphaTest で抜く */
export function netTexture(cell = 26) {
  const el = canvas(512, 512);
  const ctx = el.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2.4;
  for (let x = 0; x <= 512; x += cell) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }
  for (let y = 0; y <= 512; y += cell) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  return el;
}

/** ユニフォームの柄（色の指定から描く。キットIDでも相手国でも使う） */
export function kitTextureFromSpec(spec) {
  const el = canvas(512, 512);
  const ctx = el.getContext('2d');

  const base = ctx.createLinearGradient(0, 0, 0, 512);
  base.addColorStop(0, shade(spec.primary, 18));
  base.addColorStop(0.55, spec.primary);
  base.addColorStop(1, shade(spec.primary, -22));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);

  const stripe = (color) => {
    ctx.fillStyle = color;
  };

  switch (spec.design) {
    case 'stripes': {
      stripe(spec.secondary);
      for (let i = 0; i < 6; i += 1) ctx.fillRect(i * 88 + 10, 0, 40, 512);
      break;
    }
    case 'hoops': {
      stripe(spec.secondary);
      for (let i = 0; i < 5; i += 1) ctx.fillRect(0, i * 104 + 24, 512, 46);
      break;
    }
    case 'sash': {
      ctx.save();
      ctx.translate(256, 256);
      ctx.rotate(-Math.PI / 5);
      ctx.fillStyle = spec.secondary;
      ctx.fillRect(-330, -58, 660, 116);
      ctx.fillStyle = spec.accent;
      ctx.fillRect(-330, 58, 660, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(-330, -70, 660, 12);
      ctx.restore();
      break;
    }
    case 'bicolor': {
      ctx.fillStyle = spec.secondary;
      ctx.fillRect(256, 0, 256, 512);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(250, 0, 8, 512);
      break;
    }
    case 'gradient': {
      const fade = ctx.createLinearGradient(0, 0, 0, 512);
      fade.addColorStop(0, spec.primary);
      fade.addColorStop(1, spec.secondary);
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, 512, 512);
      break;
    }
    case 'gold': {
      ctx.fillStyle = spec.secondary;
      ctx.fillRect(0, 128, 512, 54);
      ctx.fillStyle = spec.accent;
      ctx.fillRect(0, 186, 512, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(0, 118, 512, 8);
      break;
    }
    case 'checker': {
      const size = 64;
      for (let y = 0; y < 512 / size; y += 1) {
        for (let x = 0; x < 512 / size; x += 1) {
          ctx.fillStyle = (x + y) % 2 === 0 ? spec.primary : spec.secondary;
          ctx.fillRect(x * size, y * size, size, size);
        }
      }
      break;
    }
    default:
      break;
  }

  /* 襟と袖口（どの柄でも同じ位置に入る） */
  ctx.fillStyle = spec.accent;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(0, 0, 512, 26);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, 504, 504);
  /* 布の陰影 */
  const cloth = ctx.createLinearGradient(0, 0, 512, 0);
  cloth.addColorStop(0, 'rgba(0,0,0,0.22)');
  cloth.addColorStop(0.35, 'rgba(255,255,255,0.06)');
  cloth.addColorStop(0.7, 'rgba(0,0,0,0.04)');
  cloth.addColorStop(1, 'rgba(0,0,0,0.24)');
  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, 512, 512);

  return el;
}

/** ユニフォームの柄（キットIDから） */

/** 背番号（透明地） */
export function numberTexture(number, shirt) {
  const spec = typeof shirt === 'string' ? shirtSpec(shirt) : (shirt || shirtSpec('chalk-home'));
  const el = canvas(256, 256);
  const ctx = el.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.font = 'bold 170px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 16;
  ctx.strokeStyle = spec.number;
  ctx.strokeText(String(number), 128, 132);
  ctx.fillStyle = spec.number;
  ctx.fillText(String(number), 128, 132);
  return el;
}

/** ボール（白地に黒い五角形） */
export function ballTexture() {
  const el = canvas(512, 512);
  const ctx = el.getContext('2d');
  ctx.fillStyle = '#f7f8f5';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#151b22';
  const pentagon = (cx, cy, radius, rotation = 0) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i += 1) {
      const angle = rotation + (i / 5) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };
  pentagon(128, 120, 52, 0.1);
  pentagon(384, 120, 52, 0.5);
  pentagon(70, 330, 46, 0.9);
  pentagon(256, 300, 56, 0.2);
  pentagon(440, 330, 46, 0.7);
  pentagon(180, 470, 44, 0.4);
  pentagon(350, 470, 44, 0.8);
  /* 継ぎ目 */
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 220);
  ctx.bezierCurveTo(150, 260, 360, 180, 512, 230);
  ctx.stroke();
  return el;
}

/** 広告ボード（IPKSF / SHOOTOUT 4 / WORLD ARENA） */
export function adTexture(label = 'IPKSF', accent = '#f2c24b') {
  const el = canvas(1024, 128);
  const ctx = el.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 1024, 0);
  bg.addColorStop(0, '#0b1a3a');
  bg.addColorStop(0.5, '#123a7a');
  bg.addColorStop(1, '#0b1a3a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 1024, 6);
  ctx.fillRect(0, 122, 1024, 6);
  ctx.font = 'bold 44px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 512, 66);
  return el;
}

/** 空（デイ/ナイター） */
export function skyTexture(night) {
  const el = canvas(64, 512);
  const ctx = el.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 512);
  if (night) {
    sky.addColorStop(0, '#04060f');
    sky.addColorStop(0.45, '#0a1530');
    sky.addColorStop(0.8, '#12294f');
    sky.addColorStop(1, '#1b3b63');
  } else {
    sky.addColorStop(0, '#3aa0ea');
    sky.addColorStop(0.55, '#8fd0f5');
    sky.addColorStop(1, '#dff2ff');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 64, 512);
  return el;
}

/** フラッドライトの光（radial gradient スプライト） */
export function glowTexture(color = 'rgba(255,255,240,1)') {
  const el = canvas(128, 128);
  const ctx = el.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, 'rgba(255,255,230,0.42)');
  grad.addColorStop(1, 'rgba(255,255,220,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return el;
}

/** 芝生の外側（タッチラインの外の地面） */
export function groundTexture() {
  const el = canvas(512, 512);
  const ctx = el.getContext('2d');
  ctx.fillStyle = '#14532c';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 3, 3);
  }
  return el;
}
