// Runs the main-process checks without launching the app (launching opens the user's real database).
// Each *.checks.ts file is bundled with esbuild — `electron` replaced by electron-stub.js — and run with Electron's own
// Node (ELECTRON_RUN_AS_NODE), because better-sqlite3 is built for Electron's ABI. The checks work on copies of the
// sample databases of the repository root in a temp folder; nothing in the repository is changed.
//
//   npm run test:main                 all checks
//   npm run test:main -- phase-b      only files whose name contains "phase-b"
//   EPL_CHECKS_VERBOSE=1              also print passing checks
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const esbuild = require('esbuild');
const electronPath = require('electron');

const appDir = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(appDir, '..');
const only = process.argv.slice(2);
const files = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.checks.ts') && (!only.length || only.some(o => f.includes(o))))
  .sort();

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epl-main-checks-'));
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: path.join(appDir, 'node_modules'), EPL_CHECKS_REPO: repoRoot };
delete env.NODE_OPTIONS;

let failed = 0;
for (const file of files) {
  const outfile = path.join(outDir, file.replace(/\.ts$/, '.js'));
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, file)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile,
    external: ['better-sqlite3', 'exceljs'],
    alias: { electron: path.join(__dirname, 'electron-stub.js') },
    logLevel: 'warning',
  });
  console.log(`\n=== ${file}`);
  const result = spawnSync(electronPath, [outfile], { stdio: 'inherit', env });
  if (result.status !== 0) failed++;
}

fs.rmSync(outDir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check file(s) failed` : `\nAll ${files.length} check file(s) passed`);
process.exit(failed ? 1 : 0);
