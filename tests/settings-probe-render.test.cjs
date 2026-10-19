// ctm.settings across every CTM section (F-79, §3 of the step-1 design):
// keys combine one by one across _quarto.yml, profiles, _quarto.yml.local,
// _metadata.yml and the page; Quarto's merged metadata covers what the reader
// cannot see; shared keys fall back to ctm-assessment; typed getters.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const C = require('./helpers/ctm-libs.cjs');
const skip = C.hasQuarto ? false : 'Quarto required';

function withProject(files, run) {
  const dir = C.tempdir('ctm-settings-');
  try {
    C.installPackage(dir); C.install(dir); C.installProbe(dir);
    C.write(dir, files);
    return run(dir);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}
const project = (pages, extra = '') => 'project:\n  type: default\n  render: [' + pages.join(', ') + ']\nfilters: [ctm-libs, probe]\n' + extra;
const page = (front, ...probes) => '---\ntitle: t\n' + front + '---\n' + probes.join('');
const get = (name, section, key, opts = '{}') => C.probe(name, 'local v, o = ctm.settings.get("' + section + '", "' + key + '", ' + opts + ')\nreturn {value = v, origin = o}');

test('a page that sets one key of a component section keeps the project\'s other keys', {skip}, () => withProject({
  '_quarto.yml': project(['page.qmd', 'plain.qmd'], 'math-exercise:\n  feedback: false\n  stop-after: 7\npy-exercise:\n  forbidden-imports: [os, sys]\n  submission-key: course\nctm-assessment:\n  lang: de\n'),
  'page.qmd': page('math-exercise:\n  lang: nb\npy-exercise:\n  submission: true\n',
    get('feedback', 'math-exercise', 'feedback'), get('lang', 'math-exercise', 'lang'),
    C.probe('stop', 'return ctm.runtime.stopAfter("math-exercise")'),
    C.probe('imports', 'return (ctm.settings.list("py-exercise", "forbidden-imports"))'),
    get('key', 'py-exercise', 'submission-key'), C.probe('submission', 'return (ctm.settings.bool("py-exercise", "submission", {default = false}))'),
    get('shared', 'py-exercise', 'lang', '{shared = true}'), get('unshared', 'py-exercise', 'lang')),
  'plain.qmd': page('', C.probe('stop', 'return ctm.runtime.stopAfter("py-exercise")'), get('feedback', 'math-exercise', 'feedback')),
}, dir => {
  const r = C.render(dir);
  assert.equal(r.status, 0, r.stderr);
  const p = C.probes(C.html(dir, 'page.qmd'));
  assert.deepEqual(p.feedback, {value: false, origin: '_quarto.yml'});
  assert.deepEqual(p.lang, {value: 'nb', origin: 'page.qmd'});
  assert.equal(p.stop, 7);
  assert.deepEqual(p.imports, ['os', 'sys']);
  assert.deepEqual(p.key, {value: 'course', origin: '_quarto.yml'});
  assert.equal(p.submission, true);
  assert.deepEqual(p.shared, {value: 'de', origin: '_quarto.yml'});
  assert.deepEqual(p.unshared, []);  // nothing: an empty Lua table
  const plain = C.probes(C.html(dir, 'plain.qmd'));
  assert.equal(plain.stop, 20);
  assert.deepEqual(plain.feedback, {value: false, origin: '_quarto.yml'});
}));

test('ctm-assessment: stop-after reaches every component; a component spelling wins at any level', {skip}, () => withProject({
  '_quarto.yml': project(['a.qmd', 'b.qmd'], 'ctm-assessment:\n  stop-after: 9\npy-exercise:\n  stop-after: 5\n'),
  'a.qmd': page('math-exercise:\n  lang: nb\n', C.probe('math', 'return {ctm.runtime.stopAfter("math-exercise")}')),
  'b.qmd': page('ctm-assessment:\n  stop-after: 11\n', C.probe('py', 'return {ctm.runtime.stopAfter("py-exercise")}'), C.probe('math', 'return {ctm.runtime.stopAfter("math-exercise")}')),
}, dir => {
  const r = C.render(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(C.probes(C.html(dir, 'a.qmd')).math, [9]);
  const b = C.probes(C.html(dir, 'b.qmd'));
  assert.deepEqual(b.py, [5]);
  assert.deepEqual(b.math, [11]);
}));

test('profiles (first listed wins), _quarto.yml.local and the _metadata chain take part', {skip}, () => withProject({
  '_quarto.yml': project(['sub/page.qmd'], 'py-exercise:\n  submission-key: project\n  show-test-hints: true\n'),
  '_quarto-a.yml': 'py-exercise:\n  submission-key: from-a\n',
  '_quarto-b.yml': 'py-exercise:\n  submission-key: from-b\nmath-exercise:\n  stop-after: 3\n',
  '_quarto.yml.local': 'py-exercise:\n  show-test-hints: false\n',
  'sub/_metadata.yml': 'math-exercise:\n  lang: de\n',
  'sub/page.qmd': page('math-exercise:\n  feedback: true\n', get('key', 'py-exercise', 'submission-key'), get('hints', 'py-exercise', 'show-test-hints'),
    get('lang', 'math-exercise', 'lang'), get('feedback', 'math-exercise', 'feedback'), C.probe('stop', 'return ctm.runtime.stopAfter("math-exercise")')),
}, dir => {
  const r = C.render(dir, ['--profile', 'a,b']);
  assert.equal(r.status, 0, r.stderr);
  const p = C.probes(C.html(dir, 'sub/page.qmd'));
  assert.deepEqual(p.key, {value: 'from-a', origin: '_quarto-a.yml'});
  assert.deepEqual(p.hints, {value: false, origin: '_quarto.yml.local'});
  assert.deepEqual(p.lang, {value: 'de', origin: 'sub/_metadata.yml'});
  assert.deepEqual(p.feedback, {value: true, origin: 'sub/page.qmd'});
  assert.equal(p.stop, 3);
}));

test("Quarto's merged metadata wins where the reader cannot see the page's own value", {skip}, () => withProject({
  '_quarto.yml': project(['scoped.qmd', 'late.qmd'], 'math-exercise:\n  lang: en\n'),
  'scoped.qmd': page('format:\n  html:\n    math-exercise:\n      lang: de\n', get('lang', 'math-exercise', 'lang')),
  'late.qmd': '<!-- before the front matter -->\n\n' + page('math-exercise:\n  lang: nb\n', get('lang', 'math-exercise', 'lang')),
}, dir => {
  const r = C.render(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(C.probes(C.html(dir, 'scoped.qmd')).lang, {value: 'de', origin: 'document metadata'});
  assert.deepEqual(C.probes(C.html(dir, 'late.qmd')).lang, {value: 'nb', origin: 'document metadata'});
}));

test('typed getters: values that were accepted loosely warn, invalid numbers and choices stop with key and origin', {skip}, () => withProject({
  '_quarto.yml': project(['loose.qmd', 'number.qmd', 'zero.qmd', 'choice.qmd', 'strict.qmd'], 'py-exercise:\n  show-test-hints: maybe\n  forbidden-keywords: "for,  while ,"\n'),
  'loose.qmd': page('', C.probe('hints', 'return (ctm.settings.bool("py-exercise", "show-test-hints", {default = true, loose = true}))'),
    C.probe('keywords', 'return (ctm.settings.list("py-exercise", "forbidden-keywords"))'),
    C.probe('absent', 'return {(ctm.settings.list("py-exercise", "forbidden-imports")), (ctm.settings.choice("math-exercise", "feedback", {"auto", "true", "false"}, {default = "auto"}))}')),
  'number.qmd': page('math-exercise:\n  stop-after: soon\n', C.probe('stop', 'return ctm.runtime.stopAfter("math-exercise")')),
  'zero.qmd': page('ctm-assessment:\n  stop-after: 0\n', C.probe('stop', 'return ctm.runtime.stopAfter("py-exercise")')),
  'choice.qmd': page('math-exercise:\n  feedback: maybe\n', C.probe('choice', 'return ctm.settings.choice("math-exercise", "feedback", {"auto", "true", "false"})')),
  'strict.qmd': page('py-exercise:\n  submission: perhaps\n', C.probe('strict', 'return ctm.settings.bool("py-exercise", "submission")')),
}, dir => {
  let r = C.render(dir, ['loose.qmd']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /py-exercise: show-test-hints must be true or false \(found maybe in _quarto\.yml\); using true\. This becomes an error in CTM Assessment 1\.0\./);
  const p = C.probes(C.html(dir, 'loose.qmd'));
  assert.equal(p.hints, true);
  assert.deepEqual(p.keywords, ['for', 'while']);
  assert.deepEqual(p.absent, [[], 'auto']);
  for (const [file, pattern] of [['number.qmd', /math-exercise: stop-after must be a number of seconds greater than 0 \(found soon in number\.qmd\)/],
    ['zero.qmd', /ctm-assessment: stop-after must be a number of seconds greater than 0 \(found 0 in zero\.qmd\)/],
    ['choice.qmd', /math-exercise: feedback must be auto, true or false \(found maybe in choice\.qmd\)/],
    ['strict.qmd', /py-exercise: submission must be true or false \(found perhaps in strict\.qmd\)/]]) {
    r = C.render(dir, [file]);
    assert.notEqual(r.status, 0, file);
    assert.match(r.stderr, pattern, file);
  }
}));

test('a component section that is not a mapping warns and is ignored', {skip}, () => withProject({
  '_quarto.yml': project(['page.qmd'], 'py-exercise: true\n'),
  'page.qmd': page('', get('submission', 'py-exercise', 'submission')),
}, dir => {
  const r = C.render(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /py-exercise in _quarto\.yml must be a mapping of options; it is ignored\./);
  assert.deepEqual(C.probes(C.html(dir, 'page.qmd')).submission, []);  // nothing: an empty Lua table
}));

test('pages without a CTM section never start the reader; values are their defaults', {skip}, () => withProject({
  '_quarto.yml': project(['plain.qmd', 'section.qmd']),
  'plain.qmd': page('', C.probe('stop', 'return ctm.runtime.stopAfter("math-exercise")'), C.probe('policies', 'return ctm.settings.policies().json')),
  'section.qmd': page('math-exercise:\n  lang: nb\n', C.probe('stop', 'return ctm.runtime.stopAfter("math-exercise")')),
}, dir => {
  // Without the reader file, only a page with a CTM section can fail.
  fs.renameSync(path.join(dir, '_extensions', 'ctm-libs', 'read-settings.ts'), path.join(dir, '_extensions', 'ctm-libs', 'moved.ts'));
  let r = C.render(dir, ['plain.qmd']);
  assert.equal(r.status, 0, r.stderr);
  const p = C.probes(C.html(dir, 'plain.qmd'));
  assert.equal(p.stop, 20);
  assert.deepEqual(JSON.parse(p.policies), {layers: [], pageLayers: []});
  r = C.render(dir, ['section.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ctm-libs: the settings reader failed/);
}));
