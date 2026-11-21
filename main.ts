// Dossier builder for the make.fun competition gta6-01.
// This is an entry's hand-in program: it copies the playable game/ and the four
// screenshots/ beside it into the output directory and writes dossier.json.

import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

async function copyTree(from, to) {
  if (!existsSync(from)) {
    throw new Error(`missing source directory: ${from}`);
  }
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true, force: true });
}

async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).length;
}

async function main() {
  await rm(join(OUT, 'game'), { recursive: true, force: true });
  await rm(join(OUT, 'screenshots'), { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  await copyTree(join(HERE, 'game'), join(OUT, 'game'));
  await copyTree(join(HERE, 'screenshots'), join(OUT, 'screenshots'));

  const dossier = await buildDossier(OUT, CAPS);
  await writeFile(join(OUT, 'dossier.json'), JSON.stringify(dossier, null, 2) + '\n', 'utf8');

  const gameFiles = await listFiles(join(OUT, 'game'));
  console.log(`dossier written to ${join(OUT, 'dossier.json')} (${gameFiles} game files)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
