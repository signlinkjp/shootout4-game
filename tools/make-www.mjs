/**
 * 配布用の www/ を作る（Capacitor の webDir）
 *
 * アプリ本体はリポジトリ直下（index.html / styles.css / src / assets）に置き、
 * iOS へ渡すときだけ www/ に写す。`npx cap sync ios` は www → ios/App/App/public
 * をコピーするので、public/ はリポジトリに入れない（古い写しを焼き付けない）。
 *
 *   node tools/make-www.mjs
 */

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = resolve(ROOT, 'www');
const COPY = ['index.html', 'styles.css', 'src', 'assets', 'vendor'];

export async function makeWww() {
  await rm(WWW, { recursive: true, force: true });
  await mkdir(WWW, { recursive: true });
  for (const entry of COPY) {
    const from = resolve(ROOT, entry);
    const to = resolve(WWW, entry);
    const info = await stat(from);
    if (info.isDirectory()) await cp(from, to, { recursive: true });
    else await cp(from, to);
  }
  const files = await readdir(WWW);
  return { dir: WWW, entries: files };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const { dir, entries } = await makeWww();
  console.log(`www/ → ${entries.join(' ')}`);
  void dir;
}
