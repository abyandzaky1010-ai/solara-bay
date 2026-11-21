// Solara Bay — the gta6-01 entry program (Node 22, standard library only, no network).
// It hands the game in: copies game/ and screenshots/ from beside this file into the output
// directory (/output on the grader; MAKEFUN_OUTPUT_DIR locally) and writes dossier.json there
// with buildDossier from the vendored kit library. Run locally:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(root, 'game'), join(out, 'game'), { recursive: true });
if (existsSync(join(root, 'screenshots'))) {
  mkdirSync(join(out, 'screenshots'), { recursive: true });
  cpSync(join(root, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps (reference/gate.json), passed through so a dossier the scorer would
// refuse is never written.
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(out, 'dossier.json'), dossier);
console.log(`dossier.json: ${dossier.length} bytes -> ${join(out, 'dossier.json')}`);
