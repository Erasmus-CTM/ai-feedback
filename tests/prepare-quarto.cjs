// `quarto run` (used by the policy reader during rendering) replaces Quarto's
// cached Deno standard library on its first use after an install or upgrade.
// Test files render in parallel; prepare the caches once so they do not race.
const {spawnSync} = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const quarto = process.env.QUARTO_BIN || 'quarto';
if (spawnSync(quarto, ['--version']).error) process.exit(0);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quarto-run-'));
try {
  fs.writeFileSync(path.join(dir, 'ready.ts'), 'console.log("quarto run ready");\n');
  const result = spawnSync(quarto, ['run', path.join(dir, 'ready.ts')], {encoding: 'utf8', timeout: 180000});
  if (result.status !== 0) { console.error(result.stderr); process.exit(1); }
  // An HTML render compiles the theme once into Quarto's Sass cache (a Deno KV
  // database). Parallel first renders would otherwise all write it at once and
  // fail with "database is locked".
  fs.writeFileSync(path.join(dir, 'ready.qmd'), '---\ntitle: ready\n---\n\nReady.\n');
  const render = spawnSync(quarto, ['render', path.join(dir, 'ready.qmd'), '--to', 'html'], {encoding: 'utf8', timeout: 180000});
  if (render.status !== 0) { console.error(render.stderr); process.exit(1); }
} finally { fs.rmSync(dir, {recursive: true, force: true}); }
