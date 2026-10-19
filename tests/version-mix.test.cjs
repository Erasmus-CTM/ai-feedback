// The explicit filter and an older component's loader register the same
// global: a page that would combine two ai-feedback versions stops.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), {spawnSync} = require('node:child_process');
const ctmLibs = require('./helpers/ctm-libs.cjs');
const quarto = process.env.QUARTO_BIN || 'quarto';
const skip = spawnSync(quarto, ['--version']).error ? 'Quarto required' : false;

function project(otherVersion) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-mix-'));
  ctmLibs.install(dir);
  // A second installation (ctm-libs with its alias) under an owner folder.
  const other = ctmLibs.install(dir, {owner: 'other'});
  for (const name of ['ctm-libs', 'ai-feedback']) {
    const manifest = path.join(other, name, '_extension.yml');
    fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(/\nversion:.*\n/, '\nversion: ' + otherVersion + '\n'));
  }
  // A second filter that loads the other installation, as an older component's loader would.
  fs.writeFileSync(path.join(dir, 'consumer.lua'), 'local api = dofile(pandoc.path.join({pandoc.path.directory(PANDOC_SCRIPT_FILE), "_extensions", "other", "ai-feedback", "feedback-quarto.lua"}))\nreturn {}\n');
  fs.writeFileSync(path.join(dir, 'page.qmd'), '---\ntitle: t\nfilters: [ctm-libs, consumer.lua]\n---\n\n::: {.ai-feedback}\nWrite.\n:::\n');
  return dir;
}

test('the ctm-libs filter and another installation with a different version stop the page', {skip}, () => {
  const dir = project('9.9.9');
  try {
    const r = spawnSync(quarto, ['render', 'page.qmd'], {cwd: dir, encoding: 'utf8', timeout: 120000});
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /combines filters that use different ai-feedback versions/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('the same version from two installations renders', {skip}, () => {
  const dir = project(ctmLibs.version());
  try {
    const r = spawnSync(quarto, ['render', 'page.qmd'], {cwd: dir, encoding: 'utf8', timeout: 120000});
    assert.equal(r.status, 0, r.stderr);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
