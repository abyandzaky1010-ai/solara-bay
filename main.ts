// Solara Bay — dossier builder.
// Copies game/ and screenshots/ into the output directory, then writes the
// make.fun dossier there with the same vendored buildDossier the scorer runs,
// so the two match byte for byte.
//
//   node main.ts                     # output to $MAKEFUN_OUTPUT_DIR or /output
//   MAKEFUN_OUTPUT_DIR=./out node main.ts
//
// Node 22, standard library only. Runs from the repository root.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DossierError, buildDossier } from './vendor/makefun-game.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** What the gate holds the entry to. */
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
} as const;

/** Where the entry lands: MAKEFUN_OUTPUT_DIR when set, else /output. */
function outputDir(): string {
  const fromEnv = (process.env.MAKEFUN_OUTPUT_DIR ?? '').trim();
  return resolve(fromEnv === '' ? '/output' : fromEnv);
}

/** Copy one directory of the entry into the output, replacing what was there. */
function copyDir(name: string, dest: string): number {
  const from = join(HERE, name);
  if (!existsSync(from) || !statSync(from).isDirectory()) throw new Error(`${name}/: missing from the repository root`);
  const to = join(dest, name);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  return readdirSync(to, { recursive: true }).length;
}

/** Write the dossier and say what it holds. */
function main(): void {
  const out = outputDir();
  mkdirSync(out, { recursive: true });
  const gameEntries = copyDir('game', out);
  const images = copyDir('screenshots', out);
  const dossier = buildDossier(out, CAPS);
  const target = join(out, 'dossier.json');
  writeFileSync(target, dossier);
  const header = /"text":"([^"]*)/.exec(dossier.toString('latin1'))?.[1] ?? '';
  console.log(`Solara Bay: ${gameEntries} game entries, ${images} screenshots, dossier ${dossier.length} bytes -> ${target}`);
  console.log(`dossier text starts: ${header.slice(0, 60).replace(/\\n/g, ' | ')}`);
}

try {
  main();
} catch (error) {
  if (error instanceof DossierError) {
    console.error(`dossier refused${error.limit === null ? '' : ` (${error.limit})`}: ${error.message}`);
  } else {
    console.error(`build failed: ${(error as Error).message}`);
  }
  process.exitCode = 1;
}
