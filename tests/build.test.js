import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { CONFIG } from '../src/config.js';
import { KEEPER_SYNC_MS } from '../src/net/online.js';
import { CHARACTERS } from '../src/core/skins.js';
import { COUNTRIES, FREE_COUNTRIES, PRO_COUNTRIES } from '../src/core/countries.js';
import { makeWww } from '../tools/make-www.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

function pngHeader(path) {
  const bytes = readFileSync(resolve(ROOT, path));
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}

test('Build 8 / v1.0.0 に全ファイルのビルド番号が揃っている', () => {
  assert.equal(CONFIG.version, '1.0.0');
  assert.equal(CONFIG.build, 8);

  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  const builds = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => match[1]);
  assert.deepEqual(builds, ['8', '8']);
  assert.equal((pbx.match(/MARKETING_VERSION = 1\.0\.0;/g) || []).length, 2);

  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, '1.0.0');
  assert.match(pkg.description, /Build 8/);

  assert.match(read('src/config.js'), /build: 8/);
  assert.match(read('src/ui/home.js'), /V\$\{CONFIG\.version\} · BUILD \$\{CONFIG\.build\}/);
  assert.match(read('src/ui/misc.js'), /BUILD \$\{CONFIG\.build\}/);
  assert.match(read('README.md'), /Build 7/);
  assert.match(read('docs/testflight-setup.md'), /\*\*8\*\*/);
});

test('アイコンは IPKSF 公式エンブレムで、iOS と assets が同一（旧アイコンが残っていない）', () => {
  const master = pngHeader('assets/icon-1024.png');
  const ios = pngHeader('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
  for (const header of [master, ios]) {
    assert.ok(header, 'PNG であること');
    assert.equal(header.width, 1024);
    assert.equal(header.height, 1024);
    assert.equal(header.bitDepth, 8);
    assert.equal(header.colorType, 2, 'アルファ無しの RGB');
  }
  assert.equal(master.hash, ios.hash, 'iOS の AppIcon が assets と同じ絵');

  const icons = readdirSync(resolve(ROOT, 'assets/icons')).filter((name) => name.endsWith('.png'));
  assert.ok(icons.length >= 11, `iOS サイズ: ${icons.length}`);
  for (const name of ['icon-20@2x.png', 'icon-60@3x.png', 'icon-1024.png']) {
    const header = pngHeader(`assets/icons/${name}`);
    assert.equal(header.colorType, 2, name);
  }
  /* 全サイズが同じ絵から作られている（正方形・RGB） */
  for (const name of icons) {
    const header = pngHeader(`assets/icons/${name}`);
    assert.equal(header.width, header.height, name);
    assert.equal(header.colorType, 2, name);
  }
});

test('配布用 www/ が作れて、ビルド8のアイコンとコードが同期している', async () => {
  await makeWww();
  const wwwIcon = pngHeader('www/assets/icon-1024.png');
  assert.equal(wwwIcon.hash, pngHeader('assets/icon-1024.png').hash);
  assert.match(read('www/src/config.js'), /build: 8/);
  assert.match(read('www/src/three/characters.js'), /buildCharacter/);
  assert.match(read('www/src/core/registration.js'), /IPKSF/);
  assert.match(read('www/src/core/ranking.js'), /pointsFor/);
  for (const path of ['www/index.html', 'www/src/main.js', 'www/src/three/stadium.js', 'www/assets/flags/uy-96.png']) {
    assert.equal(existsSync(resolve(ROOT, path)), true, path);
  }
});

test('32か国ぶんの国旗（96x64）が同梱されている', () => {
  for (const country of COUNTRIES) {
    const path = resolve(ROOT, country.flag);
    assert.equal(existsSync(path), true, country.flag);
    const header = pngHeader(country.flag);
    assert.equal(header.width, 96, country.flag);
    assert.equal(header.height, 64, country.flag);
    assert.ok(statSync(path).size > 80, country.flag);
  }
  assert.equal(FREE_COUNTRIES.length, 16);
  assert.equal(PRO_COUNTRIES.length, 16);
});

test('演出の間合い: 交代は1.2〜1.5秒、キーパー同期は80〜120ms', () => {
  assert.ok(CONFIG.handoverMs >= 1200 && CONFIG.handoverMs <= 1500, `${CONFIG.handoverMs}ms`);
  assert.ok(KEEPER_SYNC_MS >= 80 && KEEPER_SYNC_MS <= 120, `${KEEPER_SYNC_MS}ms`);
  assert.equal(CONFIG.roundSeconds, 7);
});

test('キャラクターは2種類（無料ブロック / PRO スタイリッシュ）', () => {
  assert.equal(CHARACTERS.length, 2);
  assert.deepEqual(CHARACTERS.map((item) => item.id).sort(), ['stylized', 'voxel']);
  assert.equal(CHARACTERS.find((item) => item.id === 'voxel').pro, false);
  assert.equal(CHARACTERS.find((item) => item.id === 'stylized').pro, true);
});

test('キーパー視点は「引いた斜め後ろ」で、キッカー視点と別のカメラ', () => {
  const stadium = read('src/three/stadium.js');
  const keep = stadium.match(/keep: \{ pos: new THREE\.Vector3\(([-\d.]+), ([-\d.]+), ([-\d.]+)\), look: new THREE\.Vector3\(([-\d.]+), ([-\d.]+), ([-\d.]+)\), fov: (\d+)/);
  assert.ok(keep, 'keep カメラ定義');
  const [, x, y, z, , , , fov] = keep.map(Number);
  assert.ok(z < -18, `ゴール裏へ引く: z=${z}`);
  assert.ok(x > 3, `斜め: x=${x}`);
  assert.ok(y > 3.3, `高い: y=${y}`);
  assert.ok(fov >= 56, `画角: ${fov}`);
  assert.match(stadium, /setKeeperOffset/);
  assert.match(stadium, /setRemoteKeeperOffset/);
});
