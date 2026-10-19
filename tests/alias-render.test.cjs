// The ai-feedback alias (0.9.x): `filters: [ai-feedback]` keeps working with
// one deprecation warning, and the entry older components' loaders look for
// (feedback-quarto.lua) returns the page's ctm-libs feedback module.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const C = require('./helpers/ctm-libs.cjs');
const skip = C.hasQuarto ? false : 'Quarto required';
const activity = '\n::: {.ai-feedback #act}\nWrite one sentence.\n:::\n';

function withProject(setup, run) {
  const dir = C.tempdir('ctm-alias-');
  try { setup(dir); return run(dir); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

test('filters: [ai-feedback] renders activities with one deprecation warning', {skip}, () => withProject(dir => {
  C.install(dir, {owner: 'Erasmus-CTM'});
  C.write(dir, {'page.qmd': '---\ntitle: t\nfilters: [ai-feedback]\n---\n' + activity});
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr.match(/filters: \[ai-feedback\] is deprecated: AI feedback is part of CTM Assessment \(filters: \[ctm-assessment\]\)\. It keeps working in 0\.9\./g)?.length, 1, r.stderr);
  const html = C.html(dir, 'page.qmd');
  assert.match(html, new RegExp('ai-feedback-' + C.version().replace(/\./g, '\\.') + '/feedback-core\\.js'));
  assert.match(html, /<script type="application\/json" class="ai-feedback-data">/);
}));

test('older loaders get the page\'s one feedback module through feedback-quarto.lua', {skip}, () => withProject(dir => {
  C.install(dir);
  // What feedback-loader.lua of math-exercise 0.9 / py-exercise 0.3 / pyodide-interaktiv 1.8 does.
  C.write(dir, {
    'old-consumer.lua': [
      'local chosen = pandoc.path.join({pandoc.path.directory(PANDOC_SCRIPT_FILE), "_extensions", "ai-feedback", "feedback-quarto.lua"})',
      'local shared = dofile(chosen)',
      'assert(shared.selection and shared.context and shared.prepare and shared.markCallout, "incomplete module")',
      'assert(shared == _G.__ctmLibs.feedback, "a second instance")',
      'assert(_G.__ctmAiFeedbackInstallation.version == _G.__ctmLibs.version, "registration")',
      'return {{Pandoc = function(doc) return shared.prepare(doc) end}}', ''].join('\n'),
    'page.qmd': '---\ntitle: t\nfilters: [ctm-libs, old-consumer.lua]\n---\n' + activity,
  });
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
  // prepare ran once (the second call is a no-op).
  assert.equal(C.html(dir, 'page.qmd').match(/class="ai-feedback-data"/g).length, 1);
}));

test('the alias without ctm-libs next to it stops with the install command', {skip}, () => withProject(dir => {
  fs.cpSync(C.alias, path.join(dir, '_extensions', 'ai-feedback'), {recursive: true});
  C.write(dir, {'page.qmd': '---\ntitle: t\nfilters: [ai-feedback]\n---\n' + activity});
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ai-feedback is now part of CTM Assessment, and its library ctm-libs is missing next to .*Install CTM Assessment: quarto add https:\/\/erasmus-ctm\.github\.io\/ctm-assessment\/ctm-assessment\.tar\.gz/s);
}));

test('listing the package filter and the alias together prepares the page once', {skip}, () => withProject(dir => {
  C.install(dir);
  C.write(dir, {'page.qmd': '---\ntitle: t\nfilters: [ctm-libs, ai-feedback]\n---\n' + activity});
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
  const html = C.html(dir, 'page.qmd');
  assert.equal(html.match(/class="ai-feedback-data"/g).length, 1);
  assert.equal(html.match(/window\.__aiFeedbackConfig = /g).length, 1);
  assert.equal(html.match(/feedback-core\.js/g).length, 1);
}));
