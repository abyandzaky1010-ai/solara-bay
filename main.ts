// SOLARA BAY — hand-in program for the make.fun contest "gta6-01"
// (most complete open-world crime game in a browser).
// Node 22, standard library only: stages the game, then writes dossier.json.

import { buildDossier } from './vendor/makefun-game.ts';
import { cp, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

async function stageFolder(name) {
  const from = path.join(HERE, name);
  if (!existsSync(from)) return false;
  const to = path.join(OUT, name);
  await cp(from, to, { recursive: true, force: true });
  return true;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const gameCopied = await stageFolder('game');
  if (!gameCopied) throw new Error('game/ folder is missing next to main.ts');
  await stageFolder('screenshots');

  const dossier = await buildDossier(OUT, CAPS);
  const info = await stat(path.join(OUT, 'dossier.json'));
  console.log(`dossier.json written (${info.size} bytes) into ${OUT}`);
  if (dossier && typeof dossier === 'object') {
    console.log(`files: ${dossier.files ?? dossier.file_count ?? 'n/a'}`);
  }
}

main().catch((err) => {
  console.error(`main.ts failed: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
