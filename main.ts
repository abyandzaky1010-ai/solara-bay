// Solara Bay — hand-in program for the make.fun competition gta6-01.
// Copies the game and its screenshots beside this file into the output directory
// and writes the build dossier that the contest reads.

import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const REPO = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

async function place(src, dest) {
  try {
    await cp(join(REPO, src), join(OUT, dest), { recursive: true });
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

async function handIn() {
  await mkdir(OUT, { recursive: true });
  const hasGame = await place('game', 'game');
  if (!hasGame) throw new Error('game/ directory is missing');
  await place('screenshots', 'screenshots');

  const dossier = await buildDossier(OUT, CAPS);
  await writeFile(join(OUT, 'dossier.json'), JSON.stringify(dossier, null, 2) + '\n', 'utf8');
  return dossier;
}

handIn()
  .then((dossier) => {
    console.log(`dossier ready at ${join(OUT, 'dossier.json')}`);
    if (dossier && Array.isArray(dossier.files)) console.log(`${dossier.files.length} files listed`);
  })
  .catch((err) => {
    console.error(`build failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
