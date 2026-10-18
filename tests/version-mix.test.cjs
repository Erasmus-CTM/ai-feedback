// The explicit ai-feedback filter and a consumer's loader register the same
// global: a page that would combine two ai-feedback versions stops.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), {spawnSync} = require('node:child_process');
const quarto = process.env.QUARTO_BIN || 'quarto';
const skip = spawnSync(quarto, ['--version']).error ? 'Quarto required' : false;
const source = path.join(__dirname, '../_extensions/ai-feedback');

function project(otherVersion) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-mix-'));
  fs.cpSync(source, path.join(dir, '_extensions/ai-feedback'), {recursive: true});
  const other = path.join(dir, '_extensions/other/ai-feedback');
  fs.cpSync(source, other, {recursive: true});
  const manifest = path.join(other, '_extension.yml');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(/\nversion:.*\n/, '\nversion: ' + otherVersion + '\n'));
  // A second filter that loads the other installation, as a consumer's loader would.
  fs.writeFileSync(path.join(dir, 'consumer.lua'), 'local api = dofile(pandoc.path.join({pandoc.path.directory(PANDOC_SCRIPT_FILE), "_extensions", "other", "ai-feedback", "feedback-quarto.lua"}))\nreturn {}\n');
  fs.writeFileSync(path.join(dir, 'page.qmd'), '---\ntitle: t\nfilters: [ai-feedback, consumer.lua]\n---\n\n::: {.ai-feedback}\nWrite.\n:::\n');
  return dir;
}

test('the ai-feedback filter and another installation with a different version stop the page', {skip}, () => {
  const dir = project('9.9.9');
  try {
    const r = spawnSync(quarto, ['render', 'page.qmd'], {cwd: dir, encoding: 'utf8', timeout: 120000});
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /combines filters that use different ai-feedback versions/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('the same version from two installations renders', {skip}, () => {
  const version = fs.readFileSync(path.join(source, '_extension.yml'), 'utf8').match(/\nversion:\s*(\S+)/)[1];
  const dir = project(version);
  try {
    const r = spawnSync(quarto, ['render', 'page.qmd'], {cwd: dir, encoding: 'utf8', timeout: 120000});
    assert.equal(r.status, 0, r.stderr);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
