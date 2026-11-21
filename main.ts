// Solara Bay — hand-in program for the make.fun competition gta6-01.
// Copies game/ and screenshots/ into the output dir and writes dossier.json there.
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

async function copyInto(name) {
  const src = join(HERE, name);
  if (!existsSync(src)) {
    throw new Error(`missing source directory: ${name}/`);
  }
  await cp(src, join(OUT, name), { recursive: true, force: true });
  const entries = await readdir(src, { recursive: true });
  console.log(`copied ${name}/ (${entries.length} entries)`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await copyInto('game');
  await copyInto('screenshots');
  const dossier = await buildDossier(OUT, CAPS);
  await writeFile(join(OUT, 'dossier.json'), JSON.stringify(dossier, null, 2) + '\n', 'utf8');
  console.log(`dossier.json written to ${OUT}`);
}

main().catch((err) => {
  console.error(`build failed: ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
});
