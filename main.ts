// The Lantern Garden — make.fun entry build script.
//
// Copies game/ and screenshots/ from this repository into the output
// directory and writes the dossier buildDossier produces from them.
// Run with Node 22: `node main.ts` (no flags, no build, no install).
// The output directory is MAKEFUN_OUTPUT_DIR, or /output when unset.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoDir = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyTree(name: string): void {
  const src = join(repoDir, name);
  const dst = join(outDir, name);
  if (!existsSync(src)) throw new Error(`main.ts: missing ${name}/ in ${repoDir}`);
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
}

mkdirSync(outDir, { recursive: true });
copyTree('game');
copyTree('screenshots');

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
const dossierBytes = dossier.length;
console.log(`Lantern Garden: wrote ${join(outDir, 'dossier.json')} (${dossierBytes} bytes)`);
