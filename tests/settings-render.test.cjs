const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), {spawnSync} = require('node:child_process');
const ctmLibs = require('./helpers/ctm-libs.cjs');
const quarto = process.env.QUARTO_BIN || 'quarto';
const available = !spawnSync(quarto, ['--version']).error;
const skip = available ? false : 'Quarto required';

// Default projects with explicit render lists: website projects render nothing
// inside hidden folders (CI runs this under .feedback-workspace).
function project(pages, quartoYml = 'filters: [ctm-libs]\nai-feedback:\n  mode: api\n  storage: session\n  base-url: https://llm.example.edu/v1\n  model: course-model\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-settings-'));
  ctmLibs.install(dir);
  fs.writeFileSync(path.join(dir, '_quarto.yml'), 'project:\n  type: default\n  render: [' + pages.join(', ') + ']\n' + quartoYml);
  fs.writeFileSync(path.join(dir, 'feedback.yml'), 'ai-feedback:\n  policies:\n    brief:\n      max-words: 80\n    prodpol:\n      max-words: 70\n');
  return dir;
}
const activity = '\n::: {.ai-feedback}\nWrite one sentence.\n:::\n';
function page(dir, file, front, prefix = '') {
  fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
  fs.writeFileSync(path.join(dir, file), prefix + '---\ntitle: t\n' + front + '---\n' + activity);
}
function render(dir, args = []) { return spawnSync(quarto, ['render', ...args], {cwd: dir, encoding: 'utf8', timeout: 180000}); }
function output(dir, file) { return fs.readFileSync(path.join(dir, file.replace(/\.(qmd|ipynb)$/, '.html')), 'utf8'); }
function settings(dir, file) { return JSON.parse(output(dir, file).match(/window\.__aiFeedbackConfig = (.*?);<\/script>/s)[1]); }
function policies(dir, file) { return JSON.parse(output(dir, file).match(/window\.__aiFeedbackPolicies = (.*?);<\/script>/s)[1]); }
const expected = {baseUrl: 'https://llm.example.edu/v1', mode: 'api', model: 'course-model', storage: 'session'};

test('a page policy keeps project provider, mode and storage; _metadata merges key by key', {skip}, () => {
  const dir = project(['plain.qmd', 'selected.qmd', 'override.qmd', 'sub/nested.qmd']);
  try {
    page(dir, 'plain.qmd', '');
    page(dir, 'selected.qmd', 'ai-feedback:\n  page-policy-files: feedback.yml\n  page-policy: brief\n');
    page(dir, 'override.qmd', 'ai-feedback:\n  mode: copy\n');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub/_metadata.yml'), 'ai-feedback:\n  model: chapter-model\n');
    page(dir, 'sub/nested.qmd', 'ai-feedback:\n  page-policy-files: feedback.yml\n  page-policy: brief\n');
    const r = render(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(settings(dir, 'plain.qmd'), expected);
    assert.deepEqual(settings(dir, 'selected.qmd'), expected);
    assert.deepEqual(settings(dir, 'override.qmd'), {...expected, mode: 'copy'});
    assert.deepEqual(settings(dir, 'sub/nested.qmd'), {...expected, model: 'chapter-model'});
    const version = ctmLibs.version();
    assert.match(output(dir, 'selected.qmd'), new RegExp('ai-feedback-' + version.replace(/\./g, '\\.') + '/feedback-core\\.js'));
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('profile files take part in the merge, for settings and project-policy', {skip}, () => {
  const dir = project(['plain.qmd', 'selected.qmd'], 'filters: [ctm-libs]\nai-feedback:\n  mode: copy\n  model: course-model\n  policy-files: feedback.yml\n  project-policy: brief\n');
  try {
    fs.writeFileSync(path.join(dir, '_quarto-prod.yml'), 'ai-feedback:\n  mode: api\n  base-url: https://prod.example/v1\n  project-policy: prodpol\n');
    page(dir, 'plain.qmd', '');
    page(dir, 'selected.qmd', 'ai-feedback:\n  page-policy: brief\n');
    const r = render(dir, ['--profile', 'prod']);
    assert.equal(r.status, 0, r.stderr);
    for (const file of ['plain.qmd', 'selected.qmd']) {
      assert.deepEqual(settings(dir, file), {baseUrl: 'https://prod.example/v1', mode: 'api', model: 'course-model'}, file);
      assert.equal(policies(dir, file).projectPolicy, 'prodpol', file);
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('several profiles: the first listed wins, as in Quarto; _quarto.yml.local applies; unset storage is not emitted', {skip}, () => {
  const dir = project(['plain.qmd', 'selected.qmd'], 'filters: [ctm-libs]\nai-feedback:\n  model: course-model\n  policy-files: feedback.yml\n');
  try {
    fs.writeFileSync(path.join(dir, 'feedback.yml'), 'ai-feedback:\n  policies:\n    apol:\n      max-words: 70\n    bpol:\n      max-words: 60\n    brief:\n      max-words: 80\n');
    fs.writeFileSync(path.join(dir, '_quarto-a.yml'), 'ai-feedback:\n  model: from-a\n  project-policy: apol\n');
    fs.writeFileSync(path.join(dir, '_quarto-b.yml'), 'ai-feedback:\n  model: from-b\n  project-policy: bpol\n');
    fs.writeFileSync(path.join(dir, '_quarto.yml.local'), 'ai-feedback:\n  mode: api\n  base-url: http://localhost:8080/v1\n');
    page(dir, 'plain.qmd', '');
    page(dir, 'selected.qmd', 'ai-feedback:\n  page-policy: brief\n');
    const r = render(dir, ['--profile', 'a,b']);
    assert.equal(r.status, 0, r.stderr);
    for (const file of ['plain.qmd', 'selected.qmd']) {
      assert.deepEqual(settings(dir, file), {baseUrl: 'http://localhost:8080/v1', mode: 'api', model: 'from-a'}, file);
      assert.equal(policies(dir, file).projectPolicy, 'apol', file);
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test("Quarto's own metadata wins where the reader cannot see it (notebooks, late front matter, format scope)", {skip}, () => {
  const dir = project(['late.qmd', 'nb.ipynb', 'scoped.qmd'], 'filters: [ctm-libs]\nai-feedback:\n  mode: api\n  model: proj-model\n');
  try {
    page(dir, 'late.qmd', 'ai-feedback:\n  mode: copy\n  model: page-model\n', '<!-- comment -->\n\n');
    const notebook = {cells: [
      {cell_type: 'raw', metadata: {}, source: ['---\n', 'title: nb\n', 'ai-feedback:\n', '  mode: copy\n', '  model: page-model\n', '---']},
      {cell_type: 'markdown', metadata: {}, source: activity.split('\n').map(line => line + '\n')}],
      metadata: {}, nbformat: 4, nbformat_minor: 5};
    fs.writeFileSync(path.join(dir, 'nb.ipynb'), JSON.stringify(notebook));
    page(dir, 'scoped.qmd', 'format:\n  html:\n    ai-feedback:\n      mode: copy\n      model: format-model\n');
    const r = render(dir);
    assert.equal(r.status, 0, r.stderr);
    for (const file of ['late.qmd', 'nb.ipynb']) {
      assert.deepEqual(settings(dir, file), {baseUrl: '', mode: 'copy', model: 'page-model'}, file);
    }
    assert.equal(settings(dir, 'scoped.qmd').model, 'format-model');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('unknown options and invalid values are reported, never published or echoed', {skip}, () => {
  const dir = project(['bad.qmd', 'date.qmd', 'url.qmd']);
  try {
    page(dir, 'bad.qmd', 'ai-feedback:\n  base_url: https://typo.example\n  mode: API\n');
    page(dir, 'date.qmd', 'ai-feedback:\n  model: 2024-08-06\n');
    page(dir, 'url.qmd', 'ai-feedback:\n  base-url: https://course:sk-proj-SECRET123@llm.example.edu/v1?api-key=sk-QUERYSECRET\n');
    const r = render(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /unknown option base_url \(bad\.qmd\) is ignored; this becomes an error in CTM Assessment 1\.0\./);
    assert.match(r.stderr, /mode \(bad\.qmd\) must be copy or api \(found "API"\)/);
    assert.match(r.stderr, /base-url https:\/\/llm\.example\.edu\/v1 \(url\.qmd\) contains a user name or password, contains a query/);
    assert.doesNotMatch(r.stderr + output(dir, 'url.qmd') + output(dir, 'bad.qmd'), /SECRET123|QUERYSECRET/);
    assert.equal(settings(dir, 'bad.qmd').mode, 'copy');
    assert.equal(settings(dir, 'url.qmd').baseUrl, '');
    assert.equal(settings(dir, 'date.qmd').model, '2024-08-06');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a credential in the metadata stops the render without showing its value (A1)', {skip}, () => {
  const dir = project(['bad.qmd']);
  try {
    page(dir, 'bad.qmd', 'ai-feedback:\n  api-key: sk-secret-value\n');
    const r = render(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ai-feedback: api-key in bad\.qmd looks like a credential\. Remove it: Quarto metadata is published with the site; learners enter their own key in the Feedback settings\./);
    // (Quarto itself may print the page's metadata when a render fails; the message never holds the value.)
    assert.doesNotMatch(r.stderr.split('\n').filter(line => /credential/.test(line)).join('\n'), /sk-secret-value/);
    assert.equal(fs.existsSync(path.join(dir, 'bad.html')), false);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('rendering does not require quarto on PATH (IDE-bundled Quarto)', {skip: available && process.platform !== 'win32' ? false : 'Quarto on a POSIX PATH required'}, (t) => {
  const restricted = '/usr/bin:/bin';
  if (!spawnSync('sh', ['-c', 'command -v quarto'], {env: {PATH: restricted}}).status) return t.skip('quarto is installed in ' + restricted);
  const dir = project(['plain.qmd']);
  try {
    page(dir, 'plain.qmd', '');
    const which = spawnSync('sh', ['-c', 'command -v ' + quarto], {encoding: 'utf8'}).stdout.trim();
    const r = spawnSync(fs.realpathSync(which), ['render', 'plain.qmd'], {cwd: dir, encoding: 'utf8', timeout: 120000, env: {...process.env, PATH: restricted}});
    assert.equal(r.status, 0, r.stderr);
    assert.equal(settings(dir, 'plain.qmd').mode, 'api');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test("a project's own Deno or npm configuration does not reach the policy reader", {skip}, () => {
  const dir = project(['plain.qmd']);
  try {
    page(dir, 'plain.qmd', '');
    fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "course", "workspaces": [');            // malformed
    fs.writeFileSync(path.join(dir, 'deno.json'), '{ "workspace": ["./tools"], "nodeModulesDir": "auto" }');
    const r = render(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(settings(dir, 'plain.qmd').mode, 'api');
    assert.equal(fs.existsSync(path.join(dir, 'node_modules')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
