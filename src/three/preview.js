/**
 * SHOOTOUT 4 — ロッカーの3Dプレビュー（Build 3）
 *
 * ロッカー上部で「いま着ているキットの選手」を斜め正面のアップで見せる。
 * キャラクター（ブロック / スタイリッシュ）を切り替えたときは、その場で
 * 1回転＋小さくジャンプして、違いが一目で分かるようにする。
 *
 * ここは見た目だけ。能力・確率には触らない。
 * WebGL が無い環境では available=false を返し、UI が2Dの並びに切り替える。
 */

import * as THREE from '../../vendor/three.module.min.js';
import {
  buildCharacter, applyLook, resetPose, disposeCharacter,
} from './characters.js';
import { shirtSpec, shortsSpec, socksSpec, bootSpec } from '../core/skins.js';
import { kitTextureFromSpec, numberTexture } from './textures.js';

const SPIN_MS = 900;
const CAMERA = {
  /* 斜め正面・アップ寄り（キャラクターの身長 1.8m に対して約 3m） */
  pos: new THREE.Vector3(1.35, 1.55, 2.55),
  look: new THREE.Vector3(0, 0.92, 0),
  fov: 36,
};

export function createPreview(canvas, { style = 'voxel', kit = null, number = 1, animate = false } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (error) {
    return { available: false, reason: String(error && error.message) };
  }
  if (!renderer.getContext()) return { available: false, reason: 'no-context' };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.05, 40);
  camera.position.copy(CAMERA.pos);
  camera.lookAt(CAMERA.look);

  scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x14283f, 2.1));
  const key = new THREE.DirectionalLight(0xfff3dc, 2.4);
  key.position.set(2.4, 4.2, 3.4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ed4ff, 1.5);
  rim.position.set(-2.6, 2.2, -2.4);
  scene.add(rim);

  /* 台座（下に薄い円盤を置くと、人物が浮いて見えない） */
  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(0.86, 0.92, 0.1, 44),
    new THREE.MeshStandardMaterial({ color: 0x143055, roughness: 0.72, metalness: 0.18 }),
  );
  podium.position.y = -0.05;
  scene.add(podium);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 0.96, 44),
    new THREE.MeshBasicMaterial({ color: 0xf2c24b, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.006;
  scene.add(ring);

  let character = null;
  let textures = [];

  function disposeCharacterTextures() {
    textures.forEach((texture) => texture.dispose?.());
    textures = [];
  }

  function build(next, nextKit) {
    if (character) {
      scene.remove(character);
      disposeCharacter(character);
      disposeCharacterTextures();
    }
    character = buildCharacter({ style: next, tone: 0 });
    const shirt = nextKit ? shirtSpec(nextKit.shirt) : shirtSpec('chalk-home');
    const shorts = nextKit ? shortsSpec(nextKit.shorts) : shortsSpec('navy-shorts');
    const socks = nextKit ? socksSpec(nextKit.socks) : socksSpec('white-socks');
    const boot = nextKit ? bootSpec(nextKit.boots) : bootSpec('classic-black');
    const shirtMap = new THREE.CanvasTexture(kitTextureFromSpec(shirt));
    const numberMap = new THREE.CanvasTexture(numberTexture(number, shirt));
    shirtMap.colorSpace = THREE.SRGBColorSpace;
    numberMap.colorSpace = THREE.SRGBColorSpace;
    textures = [shirtMap, numberMap];
    applyLook(character, {
      shirtMap,
      numberMap,
      shirt: { number: shirt.number },
      shorts,
      socks,
      boot,
    });
    resetPose(character);
    character.position.set(0, 0, 0);
    character.rotation.set(0, -0.32, 0);
    scene.add(character);
    state.style = next;
  }

  const state = { style: 'voxel', spinStart: 0, running: true };
  build(style === 'stylized' ? 'stylized' : 'voxel', kit);
  if (animate) state.spinStart = performance.now();

  function resize() {
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 200;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (renderer.domElement.width !== Math.round(width * ratio) || renderer.domElement.height !== Math.round(height * ratio)) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    }
  }

  const clock = new THREE.Clock();
  function frame() {
    if (!state.running) return;
    resize();
    const delta = Math.min(0.05, clock.getDelta());
    const now = performance.now();
    const time = now / 1000;
    if (character) {
      let yaw = -0.32 + Math.sin(time * 0.7) * 0.06;
      let lift = Math.sin(time * 1.9) * 0.008;
      if (state.spinStart) {
        const t = Math.min(1, (now - state.spinStart) / SPIN_MS);
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        yaw += eased * Math.PI * 2;
        lift += Math.sin(t * Math.PI) * 0.16;
        if (t >= 1) state.spinStart = 0;
      }
      character.rotation.y = yaw;
      character.position.y = lift;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    available: true,
    get character() { return state.style; },
    spin() {
      state.spinStart = performance.now();
      return true;
    },
    setCharacter(next) {
      const normalized = next === 'stylized' ? 'stylized' : 'voxel';
      if (normalized === state.style) return false;
      build(normalized, kit);
      state.spinStart = performance.now();
      return true;
    },
    snapshot() {
      return {
        available: true,
        character: state.style,
        spinning: Boolean(state.spinStart),
        yaw: character ? Number(character.rotation.y.toFixed(3)) : 0,
      };
    },
    dispose() {
      state.running = false;
      if (character) {
        scene.remove(character);
        disposeCharacter(character);
        disposeCharacterTextures();
        character = null;
      }
      podium.geometry.dispose();
      podium.material.dispose();
      ring.geometry.dispose();
      ring.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
