// Solara Bay — hand-in program for the make.fun competition gta6-01.
// Copies the built game and its screenshots into the output directory and
// writes dossier.json describing the entry (caps fixed by the contest).

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

async function copyTree(from: string, to: string): Promise<boolean> {
  if (!existsSync(from)) return false;
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true, force: true });
  return true;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  const gameCopied = await copyTree(path.join(HERE, 'game'), path.join(OUT, 'game'));
  await copyTree(path.join(HERE, 'screenshots'), path.join(OUT, 'screenshots'));
  await rm(path.join(OUT, 'dossier.json'), { force: true });

  if (!gameCopied) {
    throw new Error('missing game/ directory next to main.ts');
  }

  const dossier = await buildDossier(OUT, CAPS);
  await writeFile(path.join(OUT, 'dossier.json'), JSON.stringify(dossier, null, 2) + '\n', 'utf8');
  console.log(`dossier written to ${path.join(OUT, 'dossier.json')}`);
}

main().catch((err) => {
  console.error(`build failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
