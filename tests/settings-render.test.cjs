const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), {spawnSync} = require('node:child_process');
const quarto = process.env.QUARTO_BIN || 'quarto';
const available = !spawnSync(quarto, ['--version']).error;
const resolved = available ? spawnSync(quarto, ['--paths'], {encoding: 'utf8'}) : null;

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-settings-'));
  fs.cpSync(path.join(__dirname, '../_extensions/ai-feedback'), path.join(dir, '_extensions/ai-feedback'), {recursive: true});
  // A default project with an explicit render list: website projects render
  // nothing inside hidden folders (CI runs this under .feedback-workspace).
  fs.writeFileSync(path.join(dir, '_quarto.yml'), 'project:\n  type: default\n  render: [plain.qmd, selected.qmd, override.qmd, bad.qmd]\nfilters: [ai-feedback]\nai-feedback:\n  mode: api\n  storage: session\n  base-url: https://llm.example.edu/v1\n  model: course-model\n');
  fs.writeFileSync(path.join(dir, 'feedback.yml'), 'ai-feedback:\n  policies:\n    brief:\n      max-words: 80\n');
  return dir;
}
function page(dir, name, front) {
  fs.writeFileSync(path.join(dir, name + '.qmd'), '---\ntitle: ' + name + '\n' + front + '---\n\n::: {.ai-feedback #' + name + '-task}\nWrite one sentence.\n:::\n');
}
function settings(dir, name) {
  const html = fs.readFileSync(path.join(dir, name + '.html'), 'utf8');
  return JSON.parse(html.match(/window\.__aiFeedbackConfig = (.*?);<\/script>/s)[1]);
}

test('a page policy keeps project provider, mode and storage defaults', {skip: available ? false : 'Quarto required'}, () => {
  const dir = project();
  try {
    page(dir, 'plain', '');
    page(dir, 'selected', 'ai-feedback:\n  page-policy-files: feedback.yml\n  page-policy: brief\n');
    page(dir, 'override', 'ai-feedback:\n  mode: copy\n');
    page(dir, 'bad', '');
    const r = spawnSync(quarto, ['render'], {cwd: dir, encoding: 'utf8', timeout: 120000});
    assert.equal(r.status, 0, r.stderr);
    const expected = {baseUrl: 'https://llm.example.edu/v1', mode: 'api', model: 'course-model', storage: 'session'};
    assert.deepEqual(settings(dir, 'plain'), expected);
    assert.deepEqual(settings(dir, 'selected'), expected);
    assert.deepEqual(settings(dir, 'override'), {...expected, mode: 'copy'});
    const html = fs.readFileSync(path.join(dir, 'selected.html'), 'utf8');
    const version = fs.readFileSync(path.join(dir, '_extensions/ai-feedback/_extension.yml'), 'utf8').match(/\nversion:\s*(\S+)/)[1];
    assert.match(html, new RegExp('ai-feedback-' + version.replace(/\./g, '\\.') + '/feedback-core\\.js'));
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('credentials, unknown options and invalid values are reported and never published', {skip: available ? false : 'Quarto required'}, () => {
  const dir = project();
  try {
    page(dir, 'bad', 'ai-feedback:\n  api-key: sk-secret-value\n  base_url: https://typo.example\n  mode: API\n');
    const r = spawnSync(quarto, ['render', 'bad.qmd'], {cwd: dir, encoding: 'utf8', timeout: 120000});
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /api-key \(bad\.qmd\) looks like a credential/);
    assert.match(r.stderr, /unknown option base_url \(bad\.qmd\)/);
    assert.match(r.stderr, /mode must be copy or api \(found "API"\)/);
    const html = fs.readFileSync(path.join(dir, 'bad.html'), 'utf8');
    assert.doesNotMatch(html, /sk-secret-value/);
    assert.equal(settings(dir, 'bad').mode, 'copy');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('rendering does not require quarto on PATH (IDE-bundled Quarto)', {skip: available && process.platform !== 'win32' ? false : 'Quarto on a POSIX PATH required'}, () => {
  const dir = project();
  try {
    page(dir, 'plain', '');
    for (const name of ['selected', 'override', 'bad']) page(dir, name, '');
    const which = spawnSync('sh', ['-c', 'command -v ' + quarto], {encoding: 'utf8'}).stdout.trim();
    const real = fs.realpathSync(which);
    const r = spawnSync(real, ['render', 'plain.qmd'], {cwd: dir, encoding: 'utf8', timeout: 120000, env: {...process.env, PATH: '/usr/bin:/bin'}});
    assert.equal(r.status, 0, r.stderr);
    assert.equal(settings(dir, 'plain').mode, 'api');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
