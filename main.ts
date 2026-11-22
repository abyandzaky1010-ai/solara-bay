// Solara Bay — make.fun competition gta6-01 hand-in program.
// Copies game/ and screenshots/ to the output directory and writes dossier.json for the entry.

import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.MAKEFUN_OUTPUT_DIR || '/output';

function handIn(repo: string, out: string): void {
  rmSync(join(out, 'game'), { recursive: true, force: true });
  rmSync(join(out, 'screenshots'), { recursive: true, force: true });
  cpSync(join(repo, 'game'), join(out, 'game'), { recursive: true });
  cpSync(join(repo, 'screenshots'), join(out, 'screenshots'), { recursive: true });

  const dossier = buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  });
  writeFileSync(join(out, 'dossier.json'), dossier);

  const games = countFiles(join(out, 'game'));
  const shots = readdirSync(join(out, 'screenshots')).length;
  console.log(`solara-bay: ${games} game files, ${shots} screenshots, dossier.json ${dossier.byteLength} bytes -> ${out}`);
}

function countFiles(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countFiles(join(dir, entry.name));
    else total += 1;
  }
  return total;
}

try {
  mkdirSync(OUT, { recursive: true });
  handIn(HERE, OUT);
} catch (err) {
  console.error(`solara-bay: hand-in failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
