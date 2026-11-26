/**
 * SHOOTOUT 4 — 3Dキャラクター（2種・どちらも手続き型で軽量）
 *
 *   voxel    … 3️⃣ ブロック・ボクセルスポーツ型（無料）。角を少し丸めたブロック。
 *   stylized … 1️⃣ スタイリッシュ・スポーツ型（PRO）。4〜4.5頭身のローポリアスリート。
 *
 * どちらも同じ骨格（腰を支点にした脚・肩を支点にした腕）を持つので、
 * 利き足に応じた自然な蹴りモーション（軸足が残り、蹴り足が前へ振り抜ける）を
 * 共通の関数で動かせる。見た目だけの違いで、能力差はゼロ。
 *
 * ここはジオメトリとポーズだけを担当する（テクスチャ・色は stadium.js が当てる）。
 */

import * as THREE from '../../vendor/three.module.min.js';

export const CHARACTER_STYLES = Object.freeze(['voxel', 'stylized']);

/** PRO 未加入はブロック、PRO はスタイリッシュ */
export function characterStyleFor(entitled) {
  return entitled === true ? 'stylized' : 'voxel';
}

export function isCharacterStyle(value) {
  return CHARACTER_STYLES.includes(value);
}

const SKIN_TONES = ['#dcae87', '#b97e56', '#8a5a3b', '#f0c9a0', '#6b4327', '#c98d63'];
const HAIR_TONES = ['#221a14', '#3a2718', '#120f0d', '#54331d', '#2b2118', '#16120f'];

/**
 * 角を丸めたブロック（BoxGeometry の頂点を内側へ寄せて丸める）。
 * 追加ライブラリ無しで「ポップなブロック」に見せるための最小限の処理。
 */
export function roundedBlock(width, height, depth, radius = 0.05, segments = 2) {
  const geometry = new THREE.BoxGeometry(width, height, depth, segments, segments, segments);
  const position = geometry.attributes.position;
  const ax = Math.max(0, width / 2 - radius);
  const ay = Math.max(0, height / 2 - radius);
  const az = Math.max(0, depth / 2 - radius);
  const point = new THREE.Vector3();
  const core = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i);
    core.set(
      Math.min(ax, Math.max(-ax, point.x)),
      Math.min(ay, Math.max(-ay, point.y)),
      Math.min(az, Math.max(-az, point.z)),
    );
    const dx = point.x - core.x;
    const dy = point.y - core.y;
    const dz = point.z - core.z;
    const length = Math.hypot(dx, dy, dz);
    if (length > 0.0001) {
      const scale = radius / length;
      point.set(core.x + dx * scale, core.y + dy * scale, core.z + dz * scale);
    }
    position.setXYZ(i, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const BOOT_GEOMETRY = {
  classic: new THREE.BoxGeometry(0.15, 0.1, 0.31),
  speed: new THREE.BoxGeometry(0.14, 0.085, 0.33),
  high: new THREE.BoxGeometry(0.16, 0.13, 0.3),
};

function bootMesh(shape, material) {
  const geometry = BOOT_GEOMETRY[shape] || BOOT_GEOMETRY.classic;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function makeMaterials(tone) {
  return {
    shirt: new THREE.MeshStandardMaterial({ roughness: 0.74, metalness: 0.02 }),
    shorts: new THREE.MeshStandardMaterial({ roughness: 0.82 }),
    socks: new THREE.MeshStandardMaterial({ roughness: 0.86 }),
    skin: new THREE.MeshStandardMaterial({ color: SKIN_TONES[tone % SKIN_TONES.length], roughness: 0.72 }),
    hair: new THREE.MeshStandardMaterial({ color: HAIR_TONES[tone % HAIR_TONES.length], roughness: 0.95 }),
    boots: new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.12 }),
    gloves: new THREE.MeshStandardMaterial({ color: 0xf7fbfd, roughness: 0.55 }),
    numbers: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
    eye: new THREE.MeshBasicMaterial({ color: 0x14181f }),
  };
}

function addShadow(group) {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.26, 18),
    new THREE.MeshBasicMaterial({ color: 0x05200f, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  group.add(shadow);
  return shadow;
}

/** 脚（腰を支点）: 太もも + 膝から下（靴下・スパイク） */
function buildLeg({ materials, side, hipY, hipX, thigh, kneeY, sock, bootShape, style }) {
  const leg = new THREE.Group();
  leg.position.set(side * hipX, hipY, 0);

  const thighMesh = style === 'voxel'
    ? new THREE.Mesh(roundedBlock(thigh.w, thigh.h, thigh.d, Math.min(0.035, thigh.w * 0.28)), materials.skin)
    : new THREE.Mesh(new THREE.CylinderGeometry(thigh.top, thigh.bottom, thigh.h, 8), materials.skin);
  thighMesh.position.y = -thigh.h / 2;
  thighMesh.castShadow = true;
  leg.add(thighMesh);

  const lower = new THREE.Group();
  lower.position.y = -thigh.h;
  leg.add(lower);

  const sockMesh = style === 'voxel'
    ? new THREE.Mesh(roundedBlock(sock.w, sock.h, sock.d, Math.min(0.03, sock.w * 0.26)), materials.socks)
    : new THREE.Mesh(new THREE.CylinderGeometry(sock.top, sock.bottom, sock.h, 8), materials.socks);
  sockMesh.position.y = -sock.h / 2;
  sockMesh.castShadow = true;
  lower.add(sockMesh);

  const boot = bootMesh(bootShape, materials.boots);
  boot.position.set(0, -sock.h + 0.05, 0.055);
  lower.add(boot);

  return { leg, lower, boot, thighMesh, sockMesh, kneeY };
}

/** 腕（肩を支点） */
function buildArm({ materials, side, shoulderY, shoulderX, style, keeper }) {
  const arm = new THREE.Group();
  arm.position.set(side * shoulderX, shoulderY, 0);

  const sleeve = style === 'voxel'
    ? new THREE.Mesh(roundedBlock(0.13, 0.2, 0.13, 0.03), materials.shirt)
    : new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.055, 0.17, 8), materials.shirt);
  sleeve.position.y = -0.07;
  sleeve.castShadow = true;
  arm.add(sleeve);

  const forearm = style === 'voxel'
    ? new THREE.Mesh(roundedBlock(0.11, 0.3, 0.11, 0.03), materials.skin)
    : new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.042, 0.3, 8), materials.skin);
  forearm.position.y = -0.3;
  forearm.castShadow = true;
  arm.add(forearm);

  arm.rotation.z = side * (keeper ? 1.15 : 0.14);
  arm.rotation.x = keeper ? -0.22 : 0.06;

  if (keeper) {
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.082, 12, 8), materials.gloves);
    glove.scale.set(1, 1.2, 0.66);
    glove.position.y = -0.5;
    arm.add(glove);
  }
  return arm;
}

/**
 * キャラクターを組み立てる。
 *   style  … 'voxel' | 'stylized'
 *   keeper … グローブ・構えの腕
 *   tone   … 肌と髪の色（0〜5）
 *   footed … 'right' | 'left'（蹴り足。3Dの動きにだけ使う）
 */
export function buildCharacter({ style = 'voxel', keeper = false, tone = 0, footed = 'right' } = {}) {
  const group = new THREE.Group();
  const materials = makeMaterials(tone);
  const parts = { legs: [], arms: [] };
  const isVoxel = style === 'voxel';
  let hipY = 0.7;

  if (isVoxel) {
    /* 3️⃣ ブロック・ボクセル: 面が広く、角が少し丸い */
    const torso = new THREE.Mesh(roundedBlock(0.42, 0.5, 0.26, 0.06), materials.shirt);
    torso.position.y = 0.96;
    torso.castShadow = true;
    group.add(torso);
    parts.torso = torso;

    [-1, 1].forEach((side) => {
      const shoulder = new THREE.Mesh(roundedBlock(0.13, 0.12, 0.2, 0.04), materials.shirt);
      shoulder.position.set(side * 0.235, 1.17, 0);
      group.add(shoulder);
    });

    const neck = new THREE.Mesh(roundedBlock(0.12, 0.08, 0.12, 0.03), materials.skin);
    neck.position.y = 1.24;
    group.add(neck);

    const head = new THREE.Mesh(roundedBlock(0.4, 0.38, 0.36, 0.075), materials.skin);
    head.position.y = 1.46;
    head.castShadow = true;
    group.add(head);
    parts.head = head;

    /* 髪（ブロックを重ねる） */
    const hairTop = new THREE.Mesh(roundedBlock(0.42, 0.13, 0.38, 0.05), materials.hair);
    hairTop.position.set(0, 1.64, -0.005);
    group.add(hairTop);
    const fringe = new THREE.Mesh(roundedBlock(0.4, 0.07, 0.09, 0.03), materials.hair);
    fringe.position.set(0, 1.59, 0.17);
    group.add(fringe);
    [-1, 1].forEach((side) => {
      const sideburn = new THREE.Mesh(roundedBlock(0.06, 0.13, 0.2, 0.025), materials.hair);
      sideburn.position.set(side * 0.2, 1.53, 0.02);
      group.add(sideburn);
    });

    /* 目（正面 = ローカル +z） */
    [-1, 1].forEach((side) => {
      const eye = new THREE.Mesh(roundedBlock(0.075, 0.1, 0.02, 0.012), materials.eye);
      eye.position.set(side * 0.09, 1.47, 0.185);
      group.add(eye);
      const brow = new THREE.Mesh(roundedBlock(0.1, 0.028, 0.02, 0.01), materials.hair);
      brow.position.set(side * 0.09, 1.545, 0.185);
      group.add(brow);
    });

    const shortsMesh = new THREE.Mesh(roundedBlock(0.44, 0.28, 0.3, 0.05), materials.shorts);
    shortsMesh.position.y = 0.62;
    shortsMesh.castShadow = true;
    group.add(shortsMesh);
    parts.shorts = shortsMesh;

    hipY = 0.6;
    const hipX = 0.115;
    [-1, 1].forEach((side) => {
      const built = buildLeg({
        materials,
        side,
        hipY,
        hipX,
        thigh: { w: 0.17, h: 0.3, d: 0.18, top: 0.09, bottom: 0.08 },
        sock: { w: 0.16, h: 0.26, d: 0.17, top: 0.075, bottom: 0.06 },
        bootShape: 'classic',
        style,
      });
      group.add(built.leg);
      parts.legs.push(built);
    });

    [-1, 1].forEach((side) => {
      const arm = buildArm({ materials, side, shoulderY: 1.15, shoulderX: 0.27, style, keeper });
      group.add(arm);
      parts.arms.push(arm);
    });
  } else {
    /* 1️⃣ スタイリッシュ: 4〜4.5頭身のローポリ（平らな面で陰影） */
    const flat = (material) => {
      material.flatShading = true;
      return material;
    };
    flat(materials.shirt);
    flat(materials.shorts);
    flat(materials.socks);
    flat(materials.skin);
    flat(materials.hair);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.245, 0.56, 10), materials.shirt);
    torso.position.y = 1.04;
    torso.castShadow = true;
    group.add(torso);
    parts.torso = torso;

    [-1, 1].forEach((side) => {
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.082, 10, 8), materials.shirt);
      shoulder.position.set(side * 0.178, 1.29, 0);
      shoulder.scale.set(1, 0.86, 0.92);
      group.add(shoulder);
    });

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.09, 8), materials.skin);
    neck.position.y = 1.36;
    group.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.175, 12, 10), materials.skin);
    head.position.y = 1.54;
    head.scale.set(0.92, 1.02, 0.96);
    head.castShadow = true;
    group.add(head);
    parts.head = head;

    /* 髪: とがったローポリ */
    const hair = new THREE.Mesh(new THREE.IcosahedronGeometry(0.185, 0), materials.hair);
    hair.position.set(0, 1.66, -0.01);
    hair.scale.set(1, 0.68, 1);
    group.add(hair);
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 5), materials.hair);
    tuft.position.set(0.03, 1.79, 0.02);
    tuft.rotation.z = -0.3;
    group.add(tuft);
    [-1, 1].forEach((side) => {
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.05), materials.hair);
      jaw.position.set(side * 0.155, 1.55, -0.02);
      group.add(jaw);
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.055, 0.02), materials.eye);
      eye.position.set(side * 0.072, 1.55, 0.16);
      group.add(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.02, 0.02), materials.hair);
      brow.position.set(side * 0.075, 1.615, 0.155);
      brow.rotation.z = side * -0.16;
      group.add(brow);
    });

    const shortsMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.25, 0.3, 10), materials.shorts);
    shortsMesh.position.y = 0.73;
    shortsMesh.castShadow = true;
    group.add(shortsMesh);
    parts.shorts = shortsMesh;

    hipY = 0.7;
    const hipX = 0.1;
    [-1, 1].forEach((side) => {
      const built = buildLeg({
        materials,
        side,
        hipY,
        hipX,
        thigh: { w: 0.15, h: 0.4, d: 0.15, top: 0.082, bottom: 0.068 },
        sock: { w: 0.13, h: 0.36, d: 0.13, top: 0.062, bottom: 0.05 },
        bootShape: 'classic',
        style,
      });
      group.add(built.leg);
      parts.legs.push(built);
    });

    [-1, 1].forEach((side) => {
      const arm = buildArm({ materials, side, shoulderY: 1.24, shoulderX: 0.235, style, keeper });
      group.add(arm);
      parts.arms.push(arm);
    });
  }

  /* 背番号（背中側） */
  const number = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), materials.numbers);
  number.position.set(0, isVoxel ? 0.98 : 1.06, isVoxel ? 0.14 : 0.2);
  number.rotation.y = Math.PI;
  group.add(number);
  parts.number = number;

  parts.shadow = addShadow(group);

  group.userData.parts = parts;
  group.userData.materials = materials;
  group.userData.style = style;
  group.userData.keeper = Boolean(keeper);
  group.userData.footed = footed === 'left' ? 'left' : 'right';
  /* 蹴り足: legs[0] = 左, legs[1] = 右 */
  group.userData.kickLeg = group.userData.footed === 'left' ? 0 : 1;
  group.userData.supportLeg = group.userData.kickLeg === 0 ? 1 : 0;
  group.userData.base = {
    hipY,
  };
  return group;
}

export function setFooted(character, footed) {
  if (!character) return;
  character.userData.footed = footed === 'left' ? 'left' : 'right';
  character.userData.kickLeg = character.userData.footed === 'left' ? 0 : 1;
  character.userData.supportLeg = character.userData.kickLeg === 0 ? 1 : 0;
}

/** 見た目（テクスチャ・色・スパイクの形）を当てる */
export function applyLook(character, { shirtMap, numberMap, shirt, shorts, socks, boot }) {
  const materials = character.userData.materials;
  if (shirtMap) {
    materials.shirt.map = shirtMap;
    materials.shirt.needsUpdate = true;
  }
  if (numberMap) {
    materials.numbers.map = numberMap;
    materials.numbers.needsUpdate = true;
  }
  if (shirt && shirt.number) materials.numbers.color?.set(shirt.number);
  if (shorts && shorts.color) materials.shorts.color.set(shorts.color);
  if (socks && socks.color) materials.socks.color.set(socks.color);
  if (boot && boot.color) materials.boots.color.set(boot.color);
  if (boot && boot.shape) {
    const geometry = BOOT_GEOMETRY[boot.shape] || BOOT_GEOMETRY.classic;
    character.userData.parts.legs.forEach((leg) => {
      if (leg.boot) leg.boot.geometry = geometry;
    });
  }
  character.userData.look = { shirt, shorts, socks, boot };
}

/** 脚のポーズ（run-up とフォロースルーを自然につなぐ） */
export function poseLeg(character, index, { hip = 0, knee = 0 } = {}) {
  const leg = character.userData.parts.legs[index];
  if (!leg) return;
  leg.leg.rotation.x = hip;
  leg.lower.rotation.x = knee;
}

/** 待機中の小さな揺れ（全員が同じ動きにならないようにする） */
export function poseIdle(character, time, index = 0) {
  const parts = character.userData.parts;
  character.position.y = Math.sin(time * 1.7 + index * 0.9) * 0.012;
  character.rotation.z = Math.sin(time * 1.2 + index * 1.7) * 0.012;
  parts.legs.forEach((leg, legIndex) => {
    leg.lower.rotation.x = 0.04 + Math.sin(time * 1.6 + legIndex + index) * 0.02;
  });
}

/**
 * 蹴りモーション。t = 0（助走開始）〜1（フォロースルー完了）。
 * 軸足（supportLeg）は地面に残し、蹴り足だけが後ろ→前へ振り抜ける。
 */
export function poseKick(character, t) {
  const parts = character.userData.parts;
  const kick = character.userData.kickLeg;
  const support = character.userData.supportLeg;
  const clamped = Math.min(1, Math.max(0, t));
  /* 0〜0.45: 後ろへ引く / 0.45: インパクト / 0.45〜0.75: 振り抜き / 0.75〜1: 戻す */
  let hip = 0;
  let knee = 0;
  if (clamped < 0.45) {
    const p = clamped / 0.45;
    hip = 0.62 * Math.sin(p * Math.PI * 0.5);
    knee = 0.85 * p;
  } else if (clamped < 0.72) {
    const p = (clamped - 0.45) / 0.27;
    hip = 0.62 - 1.7 * p;
    knee = 0.85 * (1 - p) - 0.05;
  } else {
    const p = (clamped - 0.72) / 0.28;
    hip = -1.08 * (1 - p);
    knee = -0.05 * (1 - p);
  }
  poseLeg(character, kick, { hip, knee });
  /* 軸足は軽く曲げて残す（跳ね上がらない） */
  poseLeg(character, support, { hip: -0.08, knee: 0.14 });

  /* 腕は反対側を前へ（蹴り足と逆） */
  parts.arms.forEach((arm, index) => {
    const side = index === 0 ? -1 : 1;
    const swing = (index === kick ? 1 : -1) * 0.5 * Math.sin(clamped * Math.PI);
    arm.rotation.x = 0.06 + swing * 0.7;
    arm.rotation.z = side * 0.2;
  });
}

/** 待機の姿勢へ戻す（脚・腕） */
export function resetPose(character) {
  const parts = character.userData.parts;
  parts.legs.forEach((leg) => {
    leg.leg.rotation.x = 0;
    leg.lower.rotation.x = 0;
  });
  parts.arms.forEach((arm, index) => {
    const side = index === 0 ? -1 : 1;
    arm.rotation.x = character.userData.keeper ? -0.22 : 0.06;
    arm.rotation.z = side * (character.userData.keeper ? 1.15 : 0.14);
  });
}

export function disposeCharacter(character) {
  character.traverse((object) => {
    object.geometry?.dispose?.();
  });
}
