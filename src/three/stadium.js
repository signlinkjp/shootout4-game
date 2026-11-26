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
import { getKit, getBoot } from '../core/skins.js';
import {
  pitchTexture, netTexture, kitTexture, kitTextureFromSpec, numberTexture,
  ballTexture, adTexture, skyTexture, glowTexture, groundTexture,
} from './textures.js';

/* ピッチの寸法（メートル）。ペナルティスポットからゴールまで 11m */
const GOAL_Z = -9;
const GOAL_HALF = 3.66;
const GOAL_HEIGHT = 2.44;
const SPOT = new THREE.Vector3(0, 0.12, 2);
const CAMERAS = {
  shoot: { pos: new THREE.Vector3(0, 2.95, 6.7), look: new THREE.Vector3(0, 1.15, -7.5) },
  keep: { pos: new THREE.Vector3(0, 2.0, -9.6), look: new THREE.Vector3(0, 1.3, 4.8) },
  hero: { pos: new THREE.Vector3(11.5, 7.4, 13.5), look: new THREE.Vector3(0, 1.4, -5) },
  lineup: { pos: new THREE.Vector3(-4.7, 2.45, 8.1), look: new THREE.Vector3(-4.5, 1.05, 3.7) },
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

  const bootGeometry = {
    classic: new THREE.BoxGeometry(0.15, 0.1, 0.31),
    speed: new THREE.BoxGeometry(0.14, 0.085, 0.33),
    high: new THREE.BoxGeometry(0.16, 0.13, 0.3),
  };

  function buildPlayer({ keeper = false, tone = 0 } = {}) {
    const group = new THREE.Group();
    const parts = {};

    const shirt = new THREE.MeshStandardMaterial({ roughness: 0.74, metalness: 0.02 });
    const shorts = new THREE.MeshStandardMaterial({ roughness: 0.82 });
    const socks = new THREE.MeshStandardMaterial({ roughness: 0.86 });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN_TONES[tone % SKIN_TONES.length], roughness: 0.72 });
    const boots = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.12 });
    const gloves = new THREE.MeshStandardMaterial({ color: 0xf7fbfd, roughness: 0.55 });
    const numbers = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });

    /* 胴（ジャージ） */
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.245, 0.58, 22, 1, false), shirt);
    torso.position.y = 1.14;
    torso.castShadow = true;
    group.add(torso);
    parts.torso = torso;

    /* 肩 */
    [-1, 1].forEach((side) => {
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.082, 14, 10), shirt);
      shoulder.position.set(side * 0.178, 1.39, 0);
      shoulder.scale.set(1, 0.86, 0.92);
      group.add(shoulder);
    });

    /* 首・頭 */
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.09, 10), skin);
    neck.position.y = 1.46;
    group.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 16), skin);
    head.position.y = 1.54;
    head.scale.set(0.94, 1.05, 1);
    head.castShadow = true;
    group.add(head);
    parts.head = head;
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.108, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: 0x191f27, roughness: 0.95 }),
    );
    hair.position.y = 1.556;
    group.add(hair);

    /* 腕 */
    parts.arms = [];
    [-1, 1].forEach((side) => {
      const arm = new THREE.Group();
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.055, 0.17, 10), shirt);
      sleeve.position.y = -0.06;
      arm.add(sleeve);
      const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.044, 0.4, 10), skin);
      forearm.position.y = -0.3;
      arm.add(forearm);
      arm.position.set(side * 0.245, 1.37, 0);
      arm.rotation.z = side * (keeper ? 1.15 : 0.14);
      arm.rotation.x = keeper ? -0.22 : 0.1;
      group.add(arm);
      parts.arms.push(arm);
      if (keeper) {
        const glove = new THREE.Mesh(new THREE.SphereGeometry(0.082, 14, 10), gloves);
        glove.scale.set(1, 1.2, 0.66);
        glove.position.y = -0.52;
        arm.add(glove);
      }
    });

    /* パンツ */
    const shortsMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.25, 0.28, 20), shorts);
    shortsMesh.position.y = 0.82;
    shortsMesh.castShadow = true;
    group.add(shortsMesh);
    parts.shorts = shortsMesh;

    /* 脚・ソックス・スパイク */
    parts.legs = [];
    [-1, 1].forEach((side) => {
      const leg = new THREE.Group();
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.07, 0.4, 12), skin);
      thigh.position.y = 0.5;
      leg.add(thigh);
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.05, 0.4, 12), socks);
      sock.position.y = 0.2;
      leg.add(sock);
      const boot = new THREE.Mesh(bootGeometry.classic, boots);
      boot.position.set(0, 0.045, 0.06);
      boot.castShadow = true;
      leg.add(boot);
      parts[side > 0 ? 'bootR' : 'bootL'] = boot;
      leg.position.set(side * 0.1, 0, 0);
      group.add(leg);
      parts.legs.push(leg);
    });

    /* 背番号 */
    const number = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), numbers);
    number.position.set(0, 1.2, 0.243);
    number.rotation.y = Math.PI;
    group.add(number);
    parts.number = number;

    /* 影 */
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.26, 18),
      new THREE.MeshBasicMaterial({ color: 0x05200f, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    group.add(shadow);

    group.userData.parts = parts;
    group.userData.materials = { shirt, shorts, socks, skin, boots, numbers };
    return group;
  }

  function applyKit(group, { kitId, bootId, number, fallbackSpec = null }) {
    const materials = group.userData.materials;
    const kit = fallbackSpec ? null : getKit(kitId);
    const boot = getBoot(bootId);
    const map = fallbackSpec
      ? cacheTexture(`spec:${kitId}`, () => kitTextureFromSpec(fallbackSpec))
      : cacheTexture(`kit:${kit.id}`, () => kitTexture(kit.id));
    materials.shirt.map = map;
    materials.shirt.needsUpdate = true;
    if (kit) {
      materials.shorts.color.set(kit.shorts);
      materials.socks.color.set(kit.socks);
    } else if (fallbackSpec) {
      materials.shorts.color.set(fallbackSpec.primary);
      materials.socks.color.set(fallbackSpec.secondary);
    }
    materials.boots.color.set(boot.color);
    materials.numbers.map = cacheTexture(`num:${number}:${kitId}`, () => numberTexture(number, kit ? kit.id : '__fallback__'));
    materials.numbers.needsUpdate = true;
    const parts = group.userData.parts;
    const geometry = bootGeometry[boot.shape] || bootGeometry.classic;
    [parts.bootL, parts.bootR].forEach((mesh) => {
      if (mesh) mesh.geometry = geometry;
    });
  }

  /* 5人のキッカー（左側に控える）と、蹴る1人 */
  const kickers = [];
  const slots = [
    { x: -7.0, z: 4.3 }, { x: -5.75, z: 4.15 }, { x: -4.5, z: 4.0 }, { x: -3.3, z: 3.9 }, { x: -2.15, z: 3.8 },
  ];
  slots.forEach((slot, index) => {
    const player = buildPlayer({ tone: index });
    player.position.set(slot.x, 0, slot.z);
    player.rotation.y = Math.PI * 0.92;
    player.userData.slot = slot;
    scene.add(player);
    kickers.push(player);
  });

  const keeper = buildPlayer({ keeper: true, tone: 2 });
  keeper.position.set(0, 0, GOAL_Z + 0.85);
  keeper.userData.home = keeper.position.clone();
  scene.add(keeper);

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

  const state = {
    night,
    role: 'shoot',
    myKit: 'chalk',
    myBoot: 'classic-black',
    myNumber: 1,
    oppColors: { primary: '#c8102e', secondary: '#ffffff', accent: '#f2c24b' },
    activeKicker: 0,
    busy: false,
    netWave: { t: 0, x: 0, y: 0, energy: 0 },
    celebration: 0,
    shake: 0,
    cameraBase: CAMERAS.shoot,
  };

  function setCameraNow(preset) {
    const base = CAMERAS[preset] || CAMERAS.shoot;
    camera.position.copy(base.pos);
    camera.lookAt(base.look);
    currentLook.copy(base.look);
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
    moveCamera({ pos: state.cameraBase.pos, look: state.cameraBase.look, duration: 460 });
  }

  function setTeams({ myKit, myBoot, myNumber = 1, oppCountry }) {
    if (myKit) state.myKit = myKit;
    if (myBoot) state.myBoot = myBoot;
    if (myNumber) state.myNumber = myNumber;
    if (oppCountry) state.oppColors = oppCountry;
    paintCrowd([
      parseInt(String(state.oppColors.primary).replace('#', ''), 16),
      parseInt(String(state.oppColors.secondary).replace('#', ''), 16),
    ].filter((value) => Number.isFinite(value) && value >= 0));
    refreshKits();
  }

  function refreshKits() {
    const attackingIsMe = state.role === 'shoot';
    kickers.forEach((player, index) => {
      const number = index + 1;
      if (attackingIsMe) {
        applyKit(player, { kitId: state.myKit, bootId: state.myBoot, number });
      } else {
        applyKit(player, {
          kitId: `opp:${state.oppColors.primary}:${state.oppColors.secondary}`,
          bootId: 'classic-black',
          number,
          fallbackSpec: {
            design: 'stripes',
            primary: state.oppColors.primary,
            secondary: state.oppColors.secondary,
            accent: state.oppColors.accent,
            shorts: state.oppColors.primary,
            socks: state.oppColors.secondary,
            number: state.oppColors.secondary,
          },
        });
      }
    });
    if (attackingIsMe) {
      applyKit(keeper, {
        kitId: `gk:${state.oppColors.accent}`,
        bootId: 'classic-black',
        number: 1,
        fallbackSpec: {
          design: 'solid', primary: '#2fe08a', secondary: '#0d1b2a',
          accent: '#0d1b2a', shorts: '#0d1b2a', socks: '#2fe08a', number: '#0d1b2a',
        },
      });
    } else {
      applyKit(keeper, { kitId: state.myKit, bootId: state.myBoot, number: 1 });
    }
  }

  /* ------------------------------------------------------------------ *\
   * アニメーション
   * ------------------------------------------------------------------ */

  let flight = null;
  let dive = null;
  let resolveKick = null;

  function resetPositions() {
    kickers.forEach((player, index) => {
      const slot = slots[index];
      player.position.set(slot.x, 0, slot.z);
      player.rotation.set(0, Math.PI * 0.92, 0);
      player.userData.parts.legs.forEach((leg) => { leg.rotation.x = 0; });
    });
    keeper.position.copy(keeper.userData.home);
    keeper.rotation.set(0, 0, 0);
    keeper.visible = true;
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

  function prepareKick({ kicker = 1, role = 'shoot', shot }) {
    resetPositions();
    state.activeKicker = Math.min(4, Math.max(0, kicker - 1));
    state.role = role;
    refreshKits();
    const shooter = kickers[state.activeKicker];
    shooter.position.set(-0.82, 0, 3.25);
    shooter.rotation.set(0, Math.PI * 0.95, 0);
    state.cameraBase = role === 'keep' ? CAMERAS.keep : CAMERAS.shoot;
    moveCamera({ pos: state.cameraBase.pos, look: state.cameraBase.look, duration: 420 });
    void shot;
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

  function kick({ shot = 'TL', save = 'BR', goal = true, kicker = 1, role = 'shoot', onImpact } = {}) {
    if (state.busy) return Promise.resolve(false);
    state.busy = true;
    prepareKick({ kicker, role, shot });

    const shotPoint = zonePoint(shot);
    const savePoint = zonePoint(save);
    const target = new THREE.Vector3(shotPoint.x, shotPoint.y, GOAL_Z + 0.4);

    flight = {
      startTime: performance.now(),
      runUp: 300,
      flightTime: 520,
      start: new THREE.Vector3(SPOT.x, SPOT.y, SPOT.z),
      control: new THREE.Vector3(shotPoint.x * 0.4, 1.85, -2.4),
      end: target,
      keeperTarget: new THREE.Vector3(savePoint.x, savePoint.y, GOAL_Z + 0.85),
      goal,
      onImpact,
      impacted: false,
      kicked: false,
    };

    if (role === 'shoot') {
      moveCamera({
        pos: new THREE.Vector3(-0.9, 2.6, 7.6),
        look: new THREE.Vector3(shotPoint.x * 0.7, 1.35, GOAL_Z + 0.5),
        duration: 300 + 520,
      });
    } else {
      moveCamera({
        pos: new THREE.Vector3(0, 2.05, -9.55),
        look: new THREE.Vector3(shotPoint.x * 0.4, 1.3, 3),
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

    if (elapsed < flight.runUp) {
      const p = elapsed / flight.runUp;
      shooter.position.z = lerp(3.25, 2.35, easeOutCubic(p));
      shooter.position.x = lerp(-0.82, -0.4, p);
      shooter.rotation.y = Math.PI * 0.95;
      const swing = Math.sin(p * Math.PI) * 0.65;
      shooter.userData.parts.legs[1].rotation.x = -swing;
      return;
    }
    if (!flight.kicked) {
      flight.kicked = true;
      shooter.userData.parts.legs[1].rotation.x = -1.15;
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
      if (flight.goal) {
        ball.position.z = GOAL_Z - 0.85;
        ball.position.y = Math.max(0.12, flight.end.y - 0.35);
      } else {
        ball.position.z = GOAL_Z + 0.6;
        ball.position.x = flight.keeperTarget.x * 0.9;
        ball.position.y = Math.max(0.15, flight.keeperTarget.y * 0.55);
      }
      impact(flight.goal);
      if (flight.onImpact) flight.onImpact(flight.goal ? 'goal' : 'save');
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
      player.position.y = Math.sin(time * 1.7 + index * 0.9) * 0.012;
      player.rotation.z = Math.sin(time * 1.2 + index * 1.7) * 0.012;
    });
    if (!state.busy && !dive) {
      keeper.position.y = Math.sin(time * 1.9) * 0.012;
      keeper.rotation.z = Math.sin(time * 1.5) * 0.025;
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
    camera.fov = camera.aspect < 0.85 ? 56 : 52;
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
      return {
        available: true,
        night: state.night,
        role: state.role,
        busy: state.busy,
        ball: ball.position.toArray().map((v) => Number(v.toFixed(2))),
        camera: camera.position.toArray().map((v) => Number(v.toFixed(2))),
        crowd: crowdPoints.length,
        kickers: kickers.length,
        kit: state.myKit,
        boot: state.myBoot,
        confetti: confetti.visible,
        netEnergy: Number(state.netWave.energy.toFixed(2)),
      };
    },
  };
}
