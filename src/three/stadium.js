/**
 * SHOOTOUT 4 — 3Dスタジアム（Three.js は vendor/ に同梱・完全オフライン）
 *
 *  ・明るいデイ / ナイター（フラッドライト・星・光の滲み）
 *  ・傾斜した3段の観客席（2600人）・屋根・広告ボード・フラッドライト4基
 *  ・立体ゴール（ポスト・クロスバー・揺れるネット・サイドネット）
 *  ・3Dキッカー5人（ユニフォーム柄がそのまま出る）と3Dキーパー（グローブ）
 *  ・ボールの回転・軌道・残像、ゴール/セーブのカメラワーク、紙吹雪、衝撃波
 *
 * WebGL が無い環境では available=false を返し、UI が2Dの簡易ピッチに切り替える。
 */

import * as THREE from '../../vendor/three.module.min.js';
import { ZONES } from '../core/rules.js';
import { shirtSpec, shortsSpec, socksSpec, bootSpec } from '../core/skins.js';
import {
  buildCharacter, applyLook, setFooted, poseKick, poseIdle, resetPose,
  characterStyleFor, disposeCharacter, CHARACTER_STYLES,
} from './characters.js';
import {
  pitchTexture, netTexture, kitTextureFromSpec, numberTexture,
  ballTexture, adTexture, skyTexture, glowTexture, groundTexture,
} from './textures.js';

/* ピッチの寸法（メートル）。ペナルティスポットからゴールまで 11m */
const GOAL_Z = -9;
const GOAL_HALF = 3.66;
const GOAL_HEIGHT = 2.44;
const SPOT = new THREE.Vector3(0, 0.12, 2);
/** キーパーが左右に動ける幅（ゴールポストの内側） */
export const KEEPER_RANGE = GOAL_HALF - 0.55;

/**
 * カメラ（役割で明確に分ける）
 *   shoot … ボールの後ろからゴールを見る（蹴る側）
 *   keep  … ゴールの斜め後ろ・高めに引いて、ゴール全体と相手キッカーとボールが
 *           1画面に入る（Build 1 の「近すぎる」を解消）
 */
const CAMERAS = {
  shoot: { pos: new THREE.Vector3(0, 3.3, 7.6), look: new THREE.Vector3(0, 1.2, -7.4), fov: 52 },
  keep: { pos: new THREE.Vector3(5.2, 5.0, -22.0), look: new THREE.Vector3(0, 0.6, -5.0), fov: 60 },
  hero: { pos: new THREE.Vector3(11.5, 7.4, 13.5), look: new THREE.Vector3(0, 1.4, -5), fov: 52 },
  lineup: { pos: new THREE.Vector3(-4.7, 2.45, 8.1), look: new THREE.Vector3(-4.5, 1.05, 3.7), fov: 52 },
};

const SKIN_TONES = ['#dcae87', '#b97e56', '#8a5a3b', '#f0c9a0', '#6b4327', '#c98d63'];

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerp = (a, b, t) => a + (b - a) * t;

function zonePoint(dir) {
  const zone = ZONES[dir] || ZONES.TL;
  return {
    x: zone.x * (GOAL_HALF - 0.22),
    y: zone.y > 0.5 ? GOAL_HEIGHT * 0.8 : GOAL_HEIGHT * 0.28,
  };
}

export function createStadium(canvas, { night = false, quality = 'high' } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality !== 'low',
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch (error) {
    return { available: false, reason: String(error && error.message) };
  }
  if (!renderer.getContext()) return { available: false, reason: 'no-context' };

  const maxRatio = quality === 'low' ? 1 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 500);
  const clock = new THREE.Clock();
  const disposables = [];
  const tweens = [];
  const currentLook = CAMERAS.shoot.look.clone();

  /* ------------------------------------------------------------------ *\
   * 空・光
   * ------------------------------------------------------------------ */

  const skyMap = new THREE.CanvasTexture(skyTexture(night));
  skyMap.colorSpace = THREE.SRGBColorSpace;
  skyMap.mapping = THREE.EquirectangularReflectionMapping;
  disposables.push(skyMap);
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(230, 32, 20),
    new THREE.MeshBasicMaterial({ map: skyMap, side: THREE.BackSide, depthWrite: false }),
  );
  scene.add(skyDome);

  /* 星（ナイター） */
  const starGeometry = new THREE.BufferGeometry();
  const starPositions = new Float32Array(700 * 3);
  for (let i = 0; i < 700; i += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.45;
    const radius = 200;
    starPositions[i * 3] = Math.cos(theta) * Math.sin(phi) * radius;
    starPositions[i * 3 + 1] = Math.cos(phi) * radius * 0.85 + 20;
    starPositions[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * radius;
  }
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0xe8f1ff, size: 0.75, transparent: true, opacity: 0.9 }),
  );
  scene.add(stars);

  /* 太陽（デイ） */
  const glowMap = new THREE.CanvasTexture(glowTexture());
  disposables.push(glowMap);
  const sunGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowMap, color: 0xfff4cf, transparent: true, opacity: night ? 0 : 0.75, depthWrite: false, depthTest: false }),
  );
  sunGlow.scale.set(70, 70, 1);
  sunGlow.position.set(-70, 70, 110);
  scene.add(sunGlow);

  const hemi = new THREE.HemisphereLight(0xdceeff, 0x2e5d3a, 1.55);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.18);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff4de, 2.1);
  sun.position.set(-16, 26, 20);
  sun.castShadow = quality !== 'low';
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0007;
  sun.target.position.set(0, 0, -4);
  const fill = new THREE.DirectionalLight(0xdfefff, 0.55);
  fill.position.set(6, 12, 14);
  scene.add(fill);
  scene.add(sun);
  scene.add(sun.target);

  /* ------------------------------------------------------------------ *\
   * ピッチ
   * ------------------------------------------------------------------ */

  const groundMap = new THREE.CanvasTexture(groundTexture());
  groundMap.colorSpace = THREE.SRGBColorSpace;
  groundMap.wrapS = THREE.RepeatWrapping;
  groundMap.wrapT = THREE.RepeatWrapping;
  groundMap.repeat.set(16, 16);
  disposables.push(groundMap);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260),
    new THREE.MeshStandardMaterial({ map: groundMap, color: 0x7f9c80, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.04;
  ground.receiveShadow = true;
  scene.add(ground);

  const pitchMap = new THREE.CanvasTexture(pitchTexture());
  pitchMap.colorSpace = THREE.SRGBColorSpace;
  pitchMap.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  disposables.push(pitchMap);
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 32),
    new THREE.MeshStandardMaterial({ map: pitchMap, roughness: 0.98, metalness: 0 }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, 0, 1.5);
  pitch.receiveShadow = true;
  scene.add(pitch);

  /* ランニングトラック */
  const track = new THREE.Mesh(
    new THREE.RingGeometry(24.4, 27.6, 88),
    new THREE.MeshStandardMaterial({ color: 0x8f4034, roughness: 0.96 }),
  );
  track.rotation.x = -Math.PI / 2;
  track.scale.set(1.5, 1, 1);
  track.position.set(0, -0.01, 1.5);
  scene.add(track);
  const laneLine = new THREE.Mesh(
    new THREE.RingGeometry(25.8, 26.02, 88),
    new THREE.MeshBasicMaterial({ color: 0xefe3d8, transparent: true, opacity: 0.45 }),
  );
  laneLine.rotation.x = -Math.PI / 2;
  laneLine.scale.set(1.5, 1, 1);
  laneLine.position.set(0, 0.006, 1.5);
  scene.add(laneLine);

  /* ------------------------------------------------------------------ *\
   * 観客席（傾斜した3段のボウル）
   * ------------------------------------------------------------------ */

  const standGroup = new THREE.Group();
  scene.add(standGroup);

  /** 内側→外側へせり上がるリング（観客席の斜面） */
  function rakedStand({ inner, outer, yInner, yOuter, segments = 112, color = 0x36445c }) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const slope = Math.atan2(yOuter - yInner, outer - inner);
      /* 内側の点 */
      positions.push(cos * inner * 1.5, yInner, sin * inner);
      positions.push(cos * outer * 1.5, yOuter, sin * outer);
      const normal = new THREE.Vector3(-cos * Math.sin(slope), Math.cos(slope), -sin * Math.sin(slope)).normalize();
      normals.push(normal.x, normal.y, normal.z, normal.x, normal.y, normal.z);
      uvs.push(0, i / segments * 8, 1, i / segments * 8);
      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.04, side: THREE.DoubleSide });
    return new THREE.Mesh(geometry, material);
  }

  const tiers = [
    { inner: 25.2, outer: 30.4, yInner: 1.2, yOuter: 4.5, color: 0x445269, rows: 9, cols: 132 },
    { inner: 30.8, outer: 36.6, yInner: 4.8, yOuter: 8.6, color: 0x3c4a60, rows: 9, cols: 148 },
    { inner: 37.0, outer: 43.6, yInner: 8.9, yOuter: 13.2, color: 0x344156, rows: 10, cols: 164 },
  ];
  const crowdPoints = [];
  tiers.forEach((tier, tierIndex) => {
    standGroup.add(rakedStand(tier));
    for (let row = 0; row < tier.rows; row += 1) {
      const t = (row + 0.6) / tier.rows;
      const radius = lerp(tier.inner, tier.outer, t);
      const y = lerp(tier.yInner, tier.yOuter, t) + 0.24;
      for (let seat = 0; seat < tier.cols; seat += 1) {
        if (Math.random() < 0.06) continue; /* 空席 */
        if (seat % 30 < 2) continue; /* 通路（階段） */
        const angle = ((seat + (row % 2) * 0.5) / tier.cols) * Math.PI * 2 + (Math.random() - 0.5) * 0.012;
        crowdPoints.push({
          x: Math.cos(angle) * radius * 1.5,
          y,
          z: Math.sin(angle) * radius,
          angle,
          tier: tierIndex,
        });
      }
    }
    /* 段の前端の壁（段差を見せる） */
    const front = new THREE.Mesh(
      new THREE.CylinderGeometry(tier.inner, tier.inner, tier.yInner + 0.5, 100, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x52627c, roughness: 0.85, side: THREE.DoubleSide }),
    );
    front.scale.set(1.5, 1, 1);
    front.position.y = (tier.yInner + 0.5) / 2;
    standGroup.add(front);

    /* 段の前端（白い手すり） */
    const rail = new THREE.Mesh(
      new THREE.TorusGeometry(tier.inner, 0.09, 6, 120),
      new THREE.MeshStandardMaterial({ color: 0xdfe9f5, roughness: 0.5, metalness: 0.3 }),
    );
    rail.rotation.x = Math.PI / 2;
    rail.scale.set(1.5, 1, 1);
    rail.position.y = tier.yInner + 0.55;
    standGroup.add(rail);
  });

  /* 観客（インスタンス） */
  const crowdGeometry = new THREE.BoxGeometry(0.27, 0.44, 0.27);
  const crowdMaterial = new THREE.MeshStandardMaterial({ roughness: 0.82 });
  const crowd = new THREE.InstancedMesh(crowdGeometry, crowdMaterial, crowdPoints.length);
  crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  crowd.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const crowdBase = crowdPoints.map(() => 0.86 + Math.random() * 0.28);
  crowdPoints.forEach((point, index) => {
    dummy.position.set(point.x, point.y, point.z);
    dummy.rotation.set(0, -point.angle + Math.PI / 2, 0);
    dummy.scale.set(1, crowdBase[index], 1);
    dummy.updateMatrix();
    crowd.setMatrixAt(index, dummy.matrix);
  });
  crowd.instanceMatrix.needsUpdate = true;
  standGroup.add(crowd);

  const CROWD_NEUTRAL = [0xdfe6f0, 0x1b2f6b, 0x2b3f6b, 0x8f9db5, 0xc8102e, 0xe6ebf5, 0x4a5d80, 0x14224a, 0xf2c24b];
  let crowdPaletteKey = '';
  function paintCrowd(colors) {
    const key = colors.join(',');
    if (key === crowdPaletteKey) return;
    crowdPaletteKey = key;
    const palette = colors.concat(CROWD_NEUTRAL);
    crowdPoints.forEach((point, index) => {
      const pick = Math.random();
      const hex = pick < 0.16 ? palette[Math.floor(Math.random() * 2)] : palette[Math.floor(Math.random() * palette.length)];
      crowd.setColorAt(index, color.setHex(hex));
    });
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  }
  paintCrowd([]);

  /* 最上段の外壁（低く。その上は空） */
  const topWall = new THREE.Mesh(
    new THREE.CylinderGeometry(43.7, 43.9, 2.6, 100, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x3d4b63, roughness: 0.85, side: THREE.DoubleSide }),
  );
  topWall.scale.set(1.5, 1, 1);
  topWall.position.y = 14.4;
  standGroup.add(topWall);
  const topRail = new THREE.Mesh(
    new THREE.TorusGeometry(43.7, 0.16, 6, 120),
    new THREE.MeshStandardMaterial({ color: 0xe8f1fb, roughness: 0.4, metalness: 0.4 }),
  );
  topRail.rotation.x = Math.PI / 2;
  topRail.scale.set(1.5, 1, 1);
  topRail.position.y = 15.7;
  standGroup.add(topRail);

  /* フラッドライト4基 */
  const floodlights = [];
  const towers = [[-36, -40], [36, -40], [-36, 42], [36, 42]];
  towers.forEach(([x, z], index) => {
    const tower = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.5, 26, 10),
      new THREE.MeshStandardMaterial({ color: 0x39465c, roughness: 0.55, metalness: 0.5 }),
    );
    pole.position.y = 13;
    tower.add(pole);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(5, 3, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x0e1522, roughness: 0.5, metalness: 0.6 }),
    );
    head.position.set(0, 27, 0);
    head.lookAt(new THREE.Vector3(-x, 2, -z));
    tower.add(head);

    const lampMaterial = new THREE.MeshBasicMaterial({ color: night ? 0xfffbe2 : 0xe6f2ff });
    for (let i = 0; i < 8; i += 1) {
      const lamp = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), lampMaterial);
      const col = i % 4;
      const row = i < 4 ? 0 : 1;
      lamp.position.set(-1.7 + col * 1.13, 27 + (row ? -0.62 : 0.62), 0.26);
      head.add(lamp);
    }

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowMap, color: 0xfff7dd, transparent: true, opacity: night ? 0.95 : 0.35, depthWrite: false }),
    );
    glow.scale.set(18, 18, 1);
    glow.position.y = 27;
    tower.add(glow);

    tower.position.set(x, 0, z);
    scene.add(tower);
    floodlights.push({ glow, index });
  });

  const spotLights = [];
  if (night) {
    [[-42, -42], [42, -42]].forEach(([x, z]) => {
      const light = new THREE.SpotLight(0xfdf6e3, 300, 110, Math.PI / 5, 0.5, 1.5);
      light.position.set(x, 30, z);
      light.target.position.set(0, 0, -2);
      scene.add(light);
      scene.add(light.target);
      spotLights.push(light);
    });
  }

  /* 広告ボード */
  const adMap = new THREE.CanvasTexture(adTexture('IPKSF  •  SHOOTOUT 4  •  WORLD ARENA'));
  adMap.colorSpace = THREE.SRGBColorSpace;
  adMap.wrapS = THREE.RepeatWrapping;
  adMap.repeat.set(2, 1);
  disposables.push(adMap);
  const adMaterial = new THREE.MeshStandardMaterial({
    map: adMap,
    color: 0x9fb4d8,
    emissive: 0x0d2246,
    emissiveMap: adMap,
    emissiveIntensity: night ? 0.95 : 0.22,
    roughness: 0.7,
  });
  [
    { x: 0, z: -12.6, w: 24, rot: 0 },
    { x: -18.4, z: 1.5, w: 22, rot: Math.PI / 2 },
    { x: 18.4, z: 1.5, w: 22, rot: -Math.PI / 2 },
    { x: 0, z: 15.6, w: 24, rot: Math.PI },
  ].forEach((board) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(board.w, 0.95, 0.18), adMaterial);
    mesh.position.set(board.x, 0.48, board.z);
    mesh.rotation.y = board.rot;
    scene.add(mesh);
  });

  /* ------------------------------------------------------------------ *\
   * ゴール
   * ------------------------------------------------------------------ */

  const postMaterial = new THREE.MeshStandardMaterial({ color: 0xfbfdff, roughness: 0.28, metalness: 0.2 });
  const postGeometry = new THREE.CylinderGeometry(0.072, 0.072, GOAL_HEIGHT, 16);
  [-GOAL_HALF, GOAL_HALF].forEach((x) => {
    const post = new THREE.Mesh(postGeometry, postMaterial);
    post.position.set(x, GOAL_HEIGHT / 2, GOAL_Z);
    post.castShadow = true;
    scene.add(post);
  });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, GOAL_HALF * 2, 16), postMaterial);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, GOAL_HEIGHT, GOAL_Z);
  bar.castShadow = true;
  scene.add(bar);

  const netMap = new THREE.CanvasTexture(netTexture(20));
  netMap.wrapS = THREE.RepeatWrapping;
  netMap.wrapT = THREE.RepeatWrapping;
  disposables.push(netMap);
  function makeNet(width, height, repeatX, repeatY) {
    const map = netMap.clone();
    map.needsUpdate = true;
    map.repeat.set(repeatX, repeatY);
    const material = new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      opacity: 0.56,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 1,
      color: 0xffffff,
      emissive: 0x2b3a4d,
      emissiveIntensity: 0.2,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 20, 14), material);
    mesh.position.z = 0;
    return mesh;
  }
  const backNet = makeNet(GOAL_HALF * 2, GOAL_HEIGHT, 3, 1.1);
  backNet.position.set(0, GOAL_HEIGHT / 2, GOAL_Z - 1.8);
  scene.add(backNet);
  const topNet = makeNet(GOAL_HALF * 2, 1.8, 3, 0.7);
  topNet.rotation.x = -Math.PI / 2;
  topNet.position.set(0, GOAL_HEIGHT, GOAL_Z - 0.9);
  scene.add(topNet);
  [-1, 1].forEach((side) => {
    const sideNet = makeNet(1.8, GOAL_HEIGHT, 1, 1.4);
    sideNet.rotation.y = Math.PI / 2;
    sideNet.position.set(side * GOAL_HALF, GOAL_HEIGHT / 2, GOAL_Z - 0.9);
    scene.add(sideNet);
  });

  /* ゴール裏の低い壁（キーパー視点の背景） */
  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(30, 2.2, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x1b2740, roughness: 0.9 }),
  );
  backWall.position.set(0, 1.1, GOAL_Z - 8);
  scene.add(backWall);

  /* ------------------------------------------------------------------ *\
   * ボール・残像・影
   * ------------------------------------------------------------------ */

  const ballMap = new THREE.CanvasTexture(ballTexture());
  ballMap.colorSpace = THREE.SRGBColorSpace;
  disposables.push(ballMap);
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 28, 20),
    new THREE.MeshStandardMaterial({ map: ballMap, roughness: 0.42, metalness: 0.03 }),
  );
  ball.castShadow = true;
  ball.position.copy(SPOT);
  scene.add(ball);

  const ballShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.17, 18),
    new THREE.MeshBasicMaterial({ color: 0x05210f, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.position.set(SPOT.x, 0.014, SPOT.z);
  scene.add(ballShadow);

  const trailGeometry = new THREE.BufferGeometry();
  const trailPositions = new Float32Array(26 * 3);
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  const trail = new THREE.Line(
    trailGeometry,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
  );
  trail.frustumCulled = false;
  scene.add(trail);

  /* ------------------------------------------------------------------ *\
   * 選手
   * ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ *\
   * 状態（選手を作る前に用意する）
   * ------------------------------------------------------------------ */

  const state = {
    night,
    role: 'shoot',
    style: 'voxel',
    footed: 'right',
    keeperFooted: 'right',
    keeperOffset: 0,
    remoteKeeperOffset: 0,
    activeKicker: 0,
    busy: false,
    netWave: { t: 0, x: 0, y: 0, energy: 0 },
    celebration: 0,
    shake: 0,
    cameraBase: CAMERAS.shoot,
  };

  const textureCache = new Map();
  function cacheTexture(key, factory) {
    if (!textureCache.has(key)) {
      const map = new THREE.CanvasTexture(factory());
      map.colorSpace = THREE.SRGBColorSpace;
      disposables.push(map);
      textureCache.set(key, map);
    }
    return textureCache.get(key);
  }

  /* ------------------------------------------------------------------ *\
   * 選手（2種類のキャラクター・4部位の見た目）
   * ------------------------------------------------------------------ */

  const skin = {
    shirt: 'chalk-home',
    shorts: 'navy-shorts',
    socks: 'white-socks',
    boots: 'classic-black',
  };
  const look = {
    style: 'voxel',
    footed: 'right',
    oppFooted: 'right',
    oppShirt: { design: 'solid', primary: '#c8102e', secondary: '#ffffff', accent: '#f2c24b', number: '#ffffff' },
    oppShorts: { color: '#c8102e', trim: '#ffffff' },
    oppSocks: { color: '#ffffff', band: '#c8102e' },
  };

  /** 仕様（純粋データ）から1人ぶんの見た目を当てる */
  function applySpecLook(group, { number, shirt, shorts, socks, boot, key }) {
    const shirtMap = cacheTexture(`shirt:${key}`, () => kitTextureFromSpec(shirt));
    const numberMap = cacheTexture(`num:${key}:${number}`, () => numberTexture(number, shirt));
    applyLook(group, {
      shirtMap,
      numberMap,
      shirt: { number: shirt.number },
      shorts,
      socks,
      boot,
    });
  }

  function myLook(number) {
    return {
      number,
      shirt: shirtSpec(skin.shirt),
      shorts: shortsSpec(skin.shorts),
      socks: socksSpec(skin.socks),
      boot: bootSpec(skin.boots),
      key: `my:${skin.shirt}:${skin.shorts}:${skin.socks}`,
    };
  }

  const GK_SPEC = Object.freeze({
    design: 'solid', primary: '#2fe08a', secondary: '#0d1b2a', accent: '#0d1b2a', number: '#0d1b2a',
  });

  /* 5人のキッカー（左側に控える）と、蹴る1人 */
  const kickers = [];
  const slots = [
    { x: -7.0, z: 4.3 }, { x: -5.75, z: 4.15 }, { x: -4.5, z: 4.0 }, { x: -3.3, z: 3.9 }, { x: -2.15, z: 3.8 },
  ];
  /* 助走の開始と、ボールの真横（軸足を置く位置）。右利きは左から、左利きは右から */
  const SHOOT_START = { x: 1.2, z: 3.4 };
  const SHOOT_BALL = { x: 0.55, z: 2.55 };

  function buildKickers(style) {
    kickers.forEach((player) => {
      scene.remove(player);
      disposeCharacter(player);
    });
    kickers.length = 0;
    slots.forEach((slot, index) => {
      const player = buildCharacter({ style, tone: index, footed: 'right' });
      player.position.set(slot.x, 0, slot.z);
      player.rotation.y = Math.PI * 0.92;
      player.userData.slot = slot;
      scene.add(player);
      kickers.push(player);
    });
  }

  function buildKeeper(style) {
    const next = buildCharacter({ style, keeper: true, tone: 2 });
    next.position.set(keeperBase.x + state.keeperOffset * KEEPER_RANGE, 0, keeperBase.z);
    next.userData.home = keeperBase.clone();
    scene.add(next);
    return next;
  }

  const keeperBase = new THREE.Vector3(0, 0, GOAL_Z + 0.85);

  buildKickers(look.style);
  let keeper = buildKeeper(look.style);

  /**
   * キャラクターの種類を切り替える（PRO で 1️⃣ スタイリッシュ）。
   * 選手の能力には一切影響しない（見た目だけ）。
   */
  function setStyle(style) {
    const next = style === 'stylized' ? 'stylized' : 'voxel';
    if (next === look.style) return;
    look.style = next;
    const shooterIndex = state.activeKicker;
    const shooterPos = kickers[shooterIndex] ? kickers[shooterIndex].position.clone() : null;
    const keeperWasVisible = keeper.visible;
    scene.remove(keeper);
    disposeCharacter(keeper);
    buildKickers(next);
    keeper = buildKeeper(next);
    keeper.visible = keeperWasVisible;
    refreshKits();
    if (shooterPos && kickers[shooterIndex]) {
      kickers[shooterIndex].position.copy(shooterPos);
    }
  }

  /* ------------------------------------------------------------------ *\
   * 紙吹雪・衝撃波
   * ------------------------------------------------------------------ */

  const confettiCount = 180;
  const confetti = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.065, 0.12),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    confettiCount,
  );
  confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  confetti.frustumCulled = false;
  const confettiColors = [0xf2c24b, 0xffffff, 0xc8102e, 0x2f6fe4, 0x37dd9c, 0xe84a3a, 0xffe6a3];
  const confettiState = [];
  for (let i = 0; i < confettiCount; i += 1) {
    confettiState.push({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      rotation: new THREE.Euler(),
      spin: new THREE.Vector3(),
      life: 0,
    });
    confetti.setColorAt(i, new THREE.Color(confettiColors[i % confettiColors.length]));
  }
  if (confetti.instanceColor) confetti.instanceColor.needsUpdate = true;
  confetti.visible = false;
  scene.add(confetti);

  const shockwave = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.46, 40),
    new THREE.MeshBasicMaterial({ color: 0xffe76a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  shockwave.visible = false;
  scene.add(shockwave);

  /* ------------------------------------------------------------------ *\
   * 状態・カメラ
   * ------------------------------------------------------------------ */


  function applyFov(preset) {
    const base = CAMERAS[preset] || CAMERAS.shoot;
    const aspect = camera.aspect || 0.5;
    /* 縦長の画面では横が狭い。キーパー視点はゴール全体が入るよう画角を広げる */
    const widen = aspect < 0.85 ? (preset === 'keep' ? 1.16 : 1.07) : 1;
    camera.fov = base.fov * widen;
    camera.updateProjectionMatrix();
  }

  function setCameraNow(preset) {
    const base = CAMERAS[preset] || CAMERAS.shoot;
    camera.position.copy(base.pos);
    camera.lookAt(base.look);
    currentLook.copy(base.look);
    applyFov(preset);
  }

  function moveCamera({ pos, look, duration = 520, ease = easeInOut }) {
    tweens.length = 0;
    tweens.push({
      fromPos: camera.position.clone(),
      toPos: pos.clone(),
      fromLook: currentLook.clone(),
      toLook: look.clone(),
      start: performance.now(),
      duration,
      ease,
    });
  }

  setCameraNow('shoot');

  function setRole(role) {
    state.role = role === 'keep' ? 'keep' : 'shoot';
    state.cameraBase = state.role === 'keep' ? CAMERAS.keep : CAMERAS.shoot;
    applyFov(state.role);
    moveCamera({ pos: state.cameraBase.pos, look: state.cameraBase.look, duration: 460 });
    placeKeeper();
  }

  /**
   * 見た目の設定（4部位 + キャラクターの種類 + 利き足）。
   * ここに入る値はすべて「見た目」。能力・確率には触らない。
   */
  function setTeams({ skin: nextSkin, entitled, myNumber = 1, oppCountry, footed, opponentFooted }) {
    if (nextSkin) {
      skin.shirt = nextSkin.shirt || skin.shirt;
      skin.shorts = nextSkin.shorts || skin.shorts;
      skin.socks = nextSkin.socks || skin.socks;
      skin.boots = nextSkin.boots || skin.boots;
    }
    if (myNumber) state.myNumber = myNumber;
    if (oppCountry) {
      look.oppShirt = {
        design: 'solid',
        primary: oppCountry.primary,
        secondary: oppCountry.secondary,
        accent: oppCountry.accent,
        number: oppCountry.secondary,
      };
      look.oppShorts = { color: oppCountry.primary, trim: oppCountry.secondary };
      look.oppSocks = { color: oppCountry.secondary, band: oppCountry.primary };
      paintCrowd([
        parseInt(String(oppCountry.primary).replace('#', ''), 16),
        parseInt(String(oppCountry.secondary).replace('#', ''), 16),
      ].filter((value) => Number.isFinite(value) && value >= 0));
    }
    if (footed) look.footed = footed === 'left' ? 'left' : 'right';
    if (opponentFooted) look.oppFooted = opponentFooted === 'left' ? 'left' : 'right';
    state.keeperFooted = look.oppFooted;
    /* PRO でも「3️⃣ ブロック / 1️⃣ スタイリッシュ」を選べる（未加入はブロック固定） */
    const chosen = nextSkin && CHARACTER_STYLES.includes(nextSkin.character)
      ? nextSkin.character
      : state.style;
    const style = entitled === true ? chosen : characterStyleFor(false);
    state.style = style;
    setStyle(style);
    refreshKits();
  }

  function refreshKits() {
    const attackingIsMe = state.role === 'shoot';
    kickers.forEach((player, index) => {
      const number = index + 1;
      if (attackingIsMe) {
        applySpecLook(player, myLook(number));
        setFooted(player, look.footed);
      } else {
        /* 相手（CPU）はラウンドごとに利き足が変わる */

        applySpecLook(player, {
          number,
          shirt: look.oppShirt,
          shorts: look.oppShorts,
          socks: look.oppSocks,
          boot: { shape: 'classic', color: '#14181f', sole: '#c9ced8' },
          key: `opp:${look.oppShirt.primary}:${look.oppShirt.secondary}`,
        });
        setFooted(player, look.oppFooted);
      }
    });
    if (attackingIsMe) {
      applySpecLook(keeper, {
        number: 1,
        shirt: GK_SPEC,
        shorts: { color: '#0d1b2a', trim: '#2fe08a' },
        socks: { color: '#2fe08a', band: '#0d1b2a' },
        boot: { shape: 'classic', color: '#14181f', sole: '#c9ced8' },
        key: 'gk',
      });
    } else {
      applySpecLook(keeper, myLook(1));
      setFooted(keeper, look.footed);
    }
  }

  /* ------------------------------------------------------------------ *\
   * キーパーの左右（駆け引き）
   * ------------------------------------------------------------------ */

  function placeKeeper() {
    const offset = state.role === 'keep' ? state.keeperOffset : state.remoteKeeperOffset;
    keeper.position.x = keeperBase.x + offset * KEEPER_RANGE;
  }

  /** 自分のキーパーを左右へ（-1〜1）。決定（4択）とは別物。 */
  function setKeeperOffset(value) {
    const next = Math.max(-1, Math.min(1, Number(value) || 0));
    state.keeperOffset = next;
    if (state.role === 'keep' && !state.busy) placeKeeper();
    return next;
  }

  /** 通信相手のキーパーの左右位置（自分が蹴る番のときに見える） */
  function setRemoteKeeperOffset(value) {
    const next = Math.max(-1, Math.min(1, Number(value) || 0));
    state.remoteKeeperOffset = next;
    if (state.role === 'shoot' && !state.busy) placeKeeper();
    return next;
  }

  /* ------------------------------------------------------------------ *\
   * アニメーション
   * ------------------------------------------------------------------ */

  let flight = null;
  let dive = null;
  let resolveKick = null;
  let shotApproach = false;

  function resetPositions() {
    kickers.forEach((player, index) => {
      const slot = slots[index];
      player.position.set(slot.x, 0, slot.z);
      player.rotation.set(0, Math.PI * 0.92, 0);
      resetPose(player);
    });
    keeper.position.copy(keeper.userData.home);
    keeper.position.x = keeperBase.x + (state.role === 'keep' ? state.keeperOffset : state.remoteKeeperOffset) * KEEPER_RANGE;
    keeper.rotation.set(0, 0, 0);
    keeper.visible = true;
    resetPose(keeper);
    ball.position.copy(SPOT);
    ball.rotation.set(0, 0, 0);
    ballShadow.position.set(SPOT.x, 0.014, SPOT.z);
    ballShadow.scale.set(1, 1, 1);
    trail.material.opacity = 0;
    shockwave.visible = false;
    confetti.visible = false;
    state.netWave.energy = 0;
    state.celebration = 0;
    state.busy = false;
  }

  function prepareKick({ kicker = 1, role = 'shoot', footed }) {
    resetPositions();
    state.activeKicker = Math.min(4, Math.max(0, kicker - 1));
    state.role = role;
    if (footed) {
      if (role === 'shoot') look.footed = footed === 'left' ? 'left' : 'right';
      else look.oppFooted = footed === 'left' ? 'left' : 'right';
    }
    refreshKits();
    const shooter = kickers[state.activeKicker];
    const kickFoot = role === 'shoot' ? look.footed : look.oppFooted;
    /* 右利きはボールの左から、左利きは右から助走する（軸足が自然に残る向き） */
    const side = kickFoot === 'left' ? 1 : -1;
    shooter.position.set(side * SHOOT_START.x, 0, SHOOT_START.z);
    shooter.rotation.set(0, Math.PI * (kickFoot === 'left' ? 0.05 : 0.95), 0);
    state.cameraBase = role === 'keep' ? CAMERAS.keep : CAMERAS.shoot;
    applyFov(role === 'keep' ? 'keep' : 'shoot');
    moveCamera({ pos: state.cameraBase.pos, look: state.cameraBase.look, duration: 420 });
    void footed;
  }

  function startConfetti(origin) {
    confetti.visible = true;
    confettiState.forEach((item) => {
      item.position.set(origin.x + (Math.random() - 0.5) * 8, 1.5 + Math.random() * 4, origin.z + 1 + Math.random() * 4);
      item.velocity.set((Math.random() - 0.5) * 5, 2.2 + Math.random() * 3.6, (Math.random() - 0.2) * 4);
      item.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      item.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      item.life = 1.8 + Math.random() * 1.2;
    });
  }

  function updateConfetti(delta) {
    if (!confetti.visible) return;
    let alive = false;
    confettiState.forEach((item, index) => {
      if (item.life <= 0) {
        dummy.position.set(0, -60, 0);
        dummy.updateMatrix();
        confetti.setMatrixAt(index, dummy.matrix);
        return;
      }
      alive = true;
      item.life -= delta;
      item.velocity.y -= 9.2 * delta;
      item.position.addScaledVector(item.velocity, delta);
      if (item.position.y < 0.06) {
        item.position.y = 0.06;
        item.velocity.y *= -0.3;
        item.velocity.x *= 0.72;
        item.velocity.z *= 0.72;
      }
      item.rotation.x += item.spin.x * delta;
      item.rotation.y += item.spin.y * delta;
      item.rotation.z += item.spin.z * delta;
      dummy.position.copy(item.position);
      dummy.rotation.copy(item.rotation);
      dummy.scale.setScalar(Math.min(1, item.life));
      dummy.updateMatrix();
      confetti.setMatrixAt(index, dummy.matrix);
    });
    confetti.instanceMatrix.needsUpdate = true;
    if (!alive) confetti.visible = false;
  }

  /**
   * 1本のキック。shot は 'TL' などの4方向か、時間切れの 'OUT'（枠外）。
   * footed は蹴る選手の利き足（モーションだけに使う）。
   */
  function kick({ shot = 'TL', save = 'BR', goal = true, kicker = 1, role = 'shoot', footed, onImpact } = {}) {
    if (state.busy) return Promise.resolve(false);
    state.busy = true;
    prepareKick({ kicker, role, footed });

    const miss = shot === 'OUT';
    const shotPoint = zonePoint(miss ? (role === 'shoot' ? 'TR' : 'TL') : shot);
    const savePoint = zonePoint(save === 'CENTER' ? 'TL' : save);
    /* 枠外はゴールの外（クロスバーの上・ポストの外）へ飛ばす */
    const target = miss
      ? new THREE.Vector3((shotPoint.x >= 0 ? 1 : -1) * (GOAL_HALF + 1.6), GOAL_HEIGHT + 1.5, GOAL_Z + 0.2)
      : new THREE.Vector3(shotPoint.x, shotPoint.y, GOAL_Z + 0.4);

    flight = {
      startTime: performance.now(),
      runUp: 300,
      flightTime: 520,
      start: new THREE.Vector3(SPOT.x, SPOT.y, SPOT.z),
      control: new THREE.Vector3(target.x * 0.4, 2.5, -2.4),
      end: target,
      keeperTarget: new THREE.Vector3(savePoint.x, savePoint.y, GOAL_Z + 0.85),
      goal,
      miss,
      onImpact,
      impacted: false,
      kicked: false,
    };
    shotApproach = true;

    const footSide = (role === 'shoot' ? look.footed : look.oppFooted) === 'left' ? 1 : -1;

    if (role === 'shoot') {
      moveCamera({
        pos: new THREE.Vector3(footSide * -0.85, 2.9, 8.0),
        look: new THREE.Vector3(shotPoint.x * 0.7, 1.35, GOAL_Z + 0.5),
        duration: 300 + 520,
      });
    } else {
      /* キーパー視点は引いたまま。ボールの行き先へ少しだけ寄る */
      moveCamera({
        pos: new THREE.Vector3(footSide * 4.8, 4.4, -21.5),
        look: new THREE.Vector3(shotPoint.x * 0.5, 1.25, 1.5),
        duration: 300 + 520,
      });
    }

    return new Promise((resolve) => {
      resolveKick = resolve;
    });
  }

  function impact(goal) {
    const hit = new THREE.Vector3(ball.position.x, ball.position.y, GOAL_Z + 0.25);
    if (goal) {
      state.netWave = { t: 0, x: hit.x, y: hit.y, energy: 1 };
      state.celebration = 1.8;
      startConfetti(hit);
      shockwave.position.copy(hit);
      shockwave.visible = true;
      shockwave.material.opacity = 0.9;
      shockwave.scale.setScalar(1);
      state.shake = 0.6;
      moveCamera({
        pos: new THREE.Vector3(hit.x > 0 ? 5.6 : -5.6, 3.1, GOAL_Z + 8.4),
        look: new THREE.Vector3(hit.x * 0.7, 1.5, GOAL_Z + 1.2),
        duration: 620,
        ease: easeOutCubic,
      });
    } else {
      state.celebration = 0.8;
      shockwave.position.copy(ball.position);
      shockwave.visible = true;
      shockwave.material.opacity = 0.65;
      shockwave.scale.setScalar(0.8);
      state.shake = 0.35;
      moveCamera({
        pos: new THREE.Vector3(keeper.position.x + 2.6, 2.7, GOAL_Z + 7.2),
        look: new THREE.Vector3(keeper.position.x, 1.25, GOAL_Z + 0.8),
        duration: 560,
        ease: easeOutCubic,
      });
    }
  }

  function updateFlight(now, delta) {
    if (!flight || flight.impacted) return;
    const elapsed = now - flight.startTime;
    const shooter = kickers[state.activeKicker];

    const footSide = (state.role === 'shoot' ? look.footed : look.oppFooted) === 'left' ? 1 : -1;
    const startX = footSide * SHOOT_START.x;
    const endX = footSide * SHOOT_BALL.x;
    const pose = Math.min(1, elapsed / (flight.runUp + 260));
    poseKick(shooter, pose);

    if ((elapsed < flight.runUp || !flight.kicked) && shotApproach) {
      const p = Math.min(1, elapsed / flight.runUp);
      shooter.position.z = lerp(SHOOT_START.z, SHOOT_BALL.z, easeOutCubic(p));
      shooter.position.x = lerp(startX, endX, p);
      shooter.rotation.y = Math.PI * (footSide === 1 ? 0.05 : 0.95);
    }
    if (!flight.kicked) {
      flight.kicked = true;
      if (flight.onImpact) flight.onImpact('kick');
    }

    const t = Math.min(1, (elapsed - flight.runUp) / flight.flightTime);
    const u = 1 - t;
    ball.position.x = u * u * flight.start.x + 2 * u * t * flight.control.x + t * t * flight.end.x;
    ball.position.y = u * u * flight.start.y + 2 * u * t * flight.control.y + t * t * flight.end.y;
    ball.position.z = u * u * flight.start.z + 2 * u * t * flight.control.z + t * t * flight.end.z;
    ball.rotation.x -= delta * 22;
    ball.rotation.z -= delta * 7;
    ballShadow.position.set(ball.position.x, 0.014, ball.position.z);
    ballShadow.scale.setScalar(Math.max(0.4, 1 - ball.position.y * 0.3));

    const positions = trail.geometry.attributes.position.array;
    for (let i = 0; i < 26; i += 1) {
      const tt = Math.max(0, t - (26 - i) * 0.011);
      const uu = 1 - tt;
      positions[i * 3] = uu * uu * flight.start.x + 2 * uu * tt * flight.control.x + tt * tt * flight.end.x;
      positions[i * 3 + 1] = uu * uu * flight.start.y + 2 * uu * tt * flight.control.y + tt * tt * flight.end.y;
      positions[i * 3 + 2] = uu * uu * flight.start.z + 2 * uu * tt * flight.control.z + tt * tt * flight.end.z;
    }
    trail.geometry.attributes.position.needsUpdate = true;
    trail.material.opacity = 0.6 * (1 - t * 0.45);

    if (!dive && elapsed > flight.runUp + 110) {
      dive = {
        start: now,
        duration: 430,
        from: keeper.position.clone(),
        to: new THREE.Vector3(flight.keeperTarget.x, 0, GOAL_Z + 0.85),
        side: flight.keeperTarget.x >= 0 ? 1 : -1,
        high: flight.keeperTarget.y > 1.2,
      };
    }

    if (t >= 1) {
      flight.impacted = true;
      if (flight.miss) {
        /* 枠外: そのまま外へ抜けていく */
        ball.position.copy(flight.end);
      } else if (flight.goal) {
        ball.position.z = GOAL_Z - 0.85;
        ball.position.y = Math.max(0.12, flight.end.y - 0.35);
      } else {
        ball.position.z = GOAL_Z + 0.6;
        ball.position.x = flight.keeperTarget.x * 0.9;
        ball.position.y = Math.max(0.15, flight.keeperTarget.y * 0.55);
      }
      if (!flight.miss) impact(flight.goal);
      else {
        state.celebration = 0;
        state.shake = 0.2;
      }
      if (flight.onImpact) {
        flight.onImpact(flight.miss ? 'miss' : (flight.goal ? 'goal' : 'save'));
      }
      setTimeout(() => {
        const done = resolveKick;
        resolveKick = null;
        flight = null;
        state.busy = false;
        if (done) done(true);
      }, 200);
    }
  }

  function updateDive(now) {
    if (!dive) return;
    const t = Math.min(1, (now - dive.start) / dive.duration);
    const eased = easeOutCubic(t);
    keeper.position.x = lerp(dive.from.x, dive.to.x, eased);
    keeper.position.y = Math.sin(eased * Math.PI) * (dive.high ? 0.85 : 0.4);
    keeper.rotation.z = dive.side * eased * (dive.high ? 1.4 : 1.1);
    keeper.rotation.x = -eased * 0.3;
    if (t >= 1) dive = null;
  }

  function animateKickers(time) {
    kickers.forEach((player, index) => {
      if (player === kickers[state.activeKicker] && state.busy) return;
      poseIdle(player, time, index);
    });
    if (!state.busy && !dive) {
      keeper.position.y = Math.sin(time * 1.9) * 0.012;
      keeper.rotation.z = Math.sin(time * 1.5) * 0.025;
      /* 左右の駆け引き位置は保ったまま、小さく揺れる */
      placeKeeper();
      keeper.userData.parts.arms.forEach((arm, index) => {
        arm.rotation.z = (index ? 1 : -1) * (1.15 + Math.sin(time * 2.2) * 0.06);
      });
    }
  }

  function updateNet(delta) {
    const wave = state.netWave;
    if (wave.energy > 0.001) {
      wave.t += delta;
      const decay = Math.exp(-wave.t * 2.4);
      const offset = Math.sin(wave.t * 24) * decay * 0.34 * wave.energy;
      backNet.position.z = GOAL_Z - 1.8 - Math.abs(offset) * 1.5;
      backNet.position.x = (wave.x / GOAL_HALF) * 0.06 + offset * 0.14;
      backNet.position.y = GOAL_HEIGHT / 2 + ((wave.y - GOAL_HEIGHT / 2) / GOAL_HEIGHT) * 0.06;
      backNet.scale.set(1 + offset * 0.3, 1 - offset * 0.16, 1);
      backNet.rotation.z = offset * 0.05;
      if (decay < 0.02) {
        wave.energy = 0;
        backNet.position.set(0, GOAL_HEIGHT / 2, GOAL_Z - 1.8);
        backNet.scale.set(1, 1, 1);
        backNet.rotation.z = 0;
      }
    }
    if (shockwave.visible) {
      shockwave.scale.multiplyScalar(1 + delta * 7);
      shockwave.material.opacity = Math.max(0, shockwave.material.opacity - delta * 2.4);
      if (shockwave.material.opacity <= 0.01) shockwave.visible = false;
    }
  }

  function updateCrowd(time, delta) {
    if (state.celebration <= 0) return;
    state.celebration -= delta;
    const bounce = Math.abs(Math.sin(time * 10)) * 0.13 * Math.max(0, state.celebration);
    crowd.position.y = bounce * 1.1;
  }

  function updateCamera(now) {
    if (!tweens.length) return;
    const tween = tweens[0];
    const t = Math.min(1, (now - tween.start) / tween.duration);
    const eased = tween.ease(t);
    camera.position.lerpVectors(tween.fromPos, tween.toPos, eased);
    currentLook.lerpVectors(tween.fromLook, tween.toLook, eased);
    if (state.shake > 0) {
      state.shake = Math.max(0, state.shake - 0.028);
      camera.position.x += (Math.random() - 0.5) * state.shake * 0.4;
      camera.position.y += (Math.random() - 0.5) * state.shake * 0.3;
    }
    camera.lookAt(currentLook);
    if (t >= 1) tweens.length = 0;
  }

  function resize() {
    const width = canvas.clientWidth || 360;
    const height = canvas.clientHeight || 300;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    applyFov(state.role === 'keep' ? 'keep' : 'shoot');
    camera.updateProjectionMatrix();
  }

  let raf = 0;
  let disposed = false;
  function loop() {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const delta = Math.min(0.05, clock.getDelta());
    const now = performance.now();
    const time = now / 1000;
    updateCamera(now);
    if (flight) updateFlight(now, delta);
    animateKickers(time);
    updateDive(now);
    updateNet(delta);
    updateCrowd(time, delta);
    updateConfetti(delta);
    if (!state.busy) ball.rotation.y += delta * 0.4;
    if (night) {
      floodlights.forEach(({ glow }, index) => {
        glow.material.opacity = 0.88 + Math.sin(time * 2 + index) * 0.07;
      });
    }
    sunGlow.material.opacity = night ? 0 : 0.7 + Math.sin(time * 0.6) * 0.05;
    renderer.render(scene, camera);
  }

  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    resizeObserver?.disconnect();
    window.removeEventListener('resize', resize);
    disposables.forEach((item) => item.dispose?.());
    scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach((material) => material.dispose?.());
      }
    });
    renderer.dispose();
  }

  function setNight(value) {
    state.night = Boolean(value);
    const map = new THREE.CanvasTexture(skyTexture(state.night));
    map.colorSpace = THREE.SRGBColorSpace;
    skyDome.material.map = map;
    skyDome.material.needsUpdate = true;
    disposables.push(map);
    stars.visible = state.night;
    sunGlow.material.opacity = state.night ? 0 : 0.7;
    hemi.intensity = state.night ? 0.62 : 1.55;
    hemi.color.set(state.night ? 0x9bb8ff : 0xdceeff);
    ambient.intensity = state.night ? 0.1 : 0.18;
    sun.intensity = state.night ? 0.5 : 2.1;
    sun.color.set(state.night ? 0xd6e3ff : 0xfff4de);
    renderer.toneMappingExposure = state.night ? 1.22 : 1.08;
    floodlights.forEach(({ glow }) => { glow.material.opacity = state.night ? 0.95 : 0.35; });
    spotLights.forEach((light) => { light.visible = state.night; });
    setCameraNow(state.role === 'keep' ? 'keep' : 'shoot');
    moveCamera({ pos: state.cameraBase.pos, look: state.cameraBase.look, duration: 300 });
  }

  function setHeroCamera() {
    moveCamera({ pos: CAMERAS.hero.pos, look: CAMERAS.hero.look, duration: 900 });
  }

  /* 初期化 */
  setRole('shoot');
  setNight(night);
  stars.visible = night;
  refreshKits();
  resize();
  loop();

  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  resizeObserver?.observe(canvas);
  window.addEventListener('resize', resize);

  return {
    available: true,
    scene,
    camera,
    renderer,
    setRole,
    setTeams,
    setStyle,
    setKeeperOffset,
    setRemoteKeeperOffset,
    setNight,
    setHeroCamera,
    debugHide(what) {
      if (what === 'nets') { backNet.visible = false; topNet.visible = false; }
    },
    debugCamera(pos, look) {
      camera.position.set(pos[0], pos[1], pos[2]);
      currentLook.set(look[0], look[1], look[2]);
      camera.lookAt(currentLook);
      tweens.length = 0;
    },
    prepareKick,
    kick,
    reset: resetPositions,
    resize,
    dispose,
    state,
    snapshot() {
      const keeperDistance = Number(camera.position.distanceTo(keeper.position).toFixed(2));
      return {
        available: true,
        night: state.night,
        role: state.role,
        style: state.style,
        footed: look.footed,
        oppFooted: look.oppFooted,
        keeperFooted: state.keeperFooted,
        busy: state.busy,
        ball: ball.position.toArray().map((v) => Number(v.toFixed(2))),
        camera: camera.position.toArray().map((v) => Number(v.toFixed(2))),
        cameraFov: Number(camera.fov.toFixed(1)),
        keeper: keeper.position.toArray().map((v) => Number(v.toFixed(2))),
        keeperOffset: state.keeperOffset,
        remoteKeeperOffset: state.remoteKeeperOffset,
        keeperDistance,
        crowd: crowdPoints.length,
        kickers: kickers.length,
        kit: { ...skin },
        skin: { ...skin },
        confetti: confetti.visible,
        netEnergy: Number(state.netWave.energy.toFixed(2)),
        meshes: (() => {
          let count = 0;
          scene.traverse((object) => { if (object.isMesh) count += 1; });
          return count;
        })(),
      };
    },
  };
}
