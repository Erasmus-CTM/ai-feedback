// Step 3 (§18.2): pyodide-interaktiv's `pyodide:` options are a section of
// the settings reader on HTML pages: combined key by key across the levels
// (F-79), credential-like keys stop the render (A1), and settings.bool's
// `digits` option keeps the meaning of 1 and 0 (and of true/false in any
// case) that these options had before.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const C = require('./helpers/ctm-libs.cjs');
const skip = C.hasQuarto ? false : 'Quarto required';
const DEV = {CTM_COMPONENT_DEV: '1'};

function withProject(files, run) {
  const dir = C.tempdir('ctm-pyodide-settings-');
  try { C.install(dir); C.installProbe(dir); C.write(dir, files); return run(dir); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}
const READ = 'local s = ctm.settings\n'
  + 'local function b(key, default) local v = s.bool("pyodide", key, {loose = true, digits = true, default = default}); return v end\n'
  + 'return {feedback = b("feedback", true), startup = b("show-startup-message", true), hints = b("feedback-hints", true),'
  + ' storage = b("local-storage", false), lang = s.string("pyodide", "lang"), packages = s.list("pyodide", "packages"),'
  + ' base = s.string("pyodide", "base-url"), origin = select(2, s.get("pyodide", "feedback"))}';

test('pyodide: options combine key by key across the project and the page', {skip}, () => withProject({
  '_quarto.yml': 'project:\n  type: default\n  render: [page.qmd, plain.qmd]\nfilters: [probe]\npyodide:\n  feedback: false\n  packages: [sympy, networkx]\n  base-url: https://example.org/pyodide/v0.27.2/\n',
  'page.qmd': '---\ntitle: t\npyodide:\n  lang: de\n  show-startup-message: 0\n---\n' + C.probe('values', READ),
  'plain.qmd': '---\ntitle: t\n---\n' + C.probe('values', READ),
}, dir => {
  const r = C.render(dir, [], DEV);
  assert.equal(r.status, 0, r.stderr);
  // 1.8 replaced the project's map by the page's: feedback came back on and the packages were gone.
  assert.deepEqual(C.probes(C.html(dir, 'page.qmd')).values, {feedback: false, startup: false, hints: true, storage: false, lang: 'de',
    packages: ['sympy', 'networkx'], base: 'https://example.org/pyodide/v0.27.2/', origin: '_quarto.yml'});
  assert.deepEqual(C.probes(C.html(dir, 'plain.qmd')).values, {feedback: false, startup: true, hints: true, storage: false,
    packages: ['sympy', 'networkx'], base: 'https://example.org/pyodide/v0.27.2/', origin: '_quarto.yml'});
}));

test('digits: 1 and 0 (numbers or strings) and true/false in any case keep their meaning; other values warn once', {skip}, () => withProject({
  '_quarto.yml': 'project:\n  type: default\n  render: [one.qmd, other.qmd]\nfilters: [probe]\n',
  'one.qmd': '---\ntitle: t\npyodide:\n  feedback: 0\n  show-startup-message: "1"\n  feedback-hints: "FALSE"\n  local-storage: 1\n---\n' + C.probe('values', READ),
  'other.qmd': '---\ntitle: t\npyodide:\n  feedback: yes please\n  local-storage: maybe\n---\n' + C.probe('values', READ) + C.probe('again', 'return (ctm.settings.bool("pyodide", "feedback", {loose = true, digits = true, default = true}))'),
}, dir => {
  const r = C.render(dir, [], DEV);
  assert.equal(r.status, 0, r.stderr);
  const one = C.probes(C.html(dir, 'one.qmd')).values;
  assert.deepEqual([one.feedback, one.startup, one.hints, one.storage], [false, true, false, true]);
  const other = C.probes(C.html(dir, 'other.qmd'));
  assert.deepEqual([other.values.feedback, other.values.storage, other.again], [true, false, true]);
  const stderr = r.stderr.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(stderr.match(/pyodide: feedback must be true or false \(or 1 or 0\) \(found yes please in other\.qmd\); using true\./g).length, 1, stderr);
  assert.match(stderr, /pyodide: local-storage must be true or false \(or 1 or 0\) \(found maybe in other\.qmd\); using false\./);
  assert.doesNotMatch(stderr, /one\.qmd\)/);
}));

test('without digits, 1 and 0 are no booleans (other sections keep their stricter rule)', {skip}, () => withProject({
  'page.qmd': '---\ntitle: t\nfilters: [probe]\npy-exercise:\n  feedback: 1\n---\n' + C.probe('value', 'return (ctm.settings.bool("py-exercise", "feedback", {loose = true, default = false}))'),
}, dir => {
  const r = C.render(dir, ['page.qmd'], DEV);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(C.probes(C.html(dir, 'page.qmd')).value, false);
  assert.match(r.stderr, /py-exercise: feedback must be true or false \(found 1 in page\.qmd\)/);
}));

test('a credential-like key under pyodide: stops the render (A1)', {skip}, () => withProject({
  'page.qmd': '---\ntitle: t\nfilters: [probe]\npyodide:\n  api-key: sk-test\n---\n' + C.probe('value', 'return (ctm.settings.string("pyodide", "lang"))'),
}, dir => {
  const r = C.render(dir, ['page.qmd'], DEV);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /pyodide: api-key in page\.qmd looks like a credential/);
  assert.doesNotMatch(r.stderr.split('\n').filter(line => /credential/.test(line)).join('\n'), /sk-test/);
}));
