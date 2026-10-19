// Legacy consumers (step-1 design §16.3): the components as merged before the
// consolidation (math-exercise bf6caf3, py-exercise c14c5f4) and
// pyodide-interaktiv 1.8 (8a16aa7) keep working with this ctm-libs through
// the ai-feedback alias: their feedback-loader.lua finds
// _extensions/ai-feedback/feedback-quarto.lua, which returns ctm-libs'
// feedback module. An ai-feedback 0.8.1 listed next to ctm-libs still stops.
//
// CTM_LEGACY_SOURCES names a folder with checkouts math-exercise,
// py-exercise, pyodide-interaktiv and ai-feedback-0.8.1 (this repository at
// 79103a6); the workflow legacy-consumers.yml provides them.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const C = require('../helpers/ctm-libs.cjs');
const sources = process.env.CTM_LEGACY_SOURCES;
const skip = !C.hasQuarto ? 'Quarto required' : !sources ? 'CTM_LEGACY_SOURCES not set (see .github/workflows/legacy-consumers.yml)' : false;
const DEPRECATED = /filters: \[ai-feedback\] is deprecated/g;
const v = C.version().replace(/\./g, '\\.');

const math = '## Area\n\nA square has side 3.\n\n```{math-exercise}\n#| label: area\nIts area is _[9].\n```\n';
const py = '## Adding\n\n```{py-exercise}\n#| label: add\n#| task: Write add(a, b).\ndef add(a, b):\n    pass\n## TESTS ##\nassert add(1, 2) == 3\n```\n';
const pyodide = '## Python\n\n```{pyodide-python}\nprint(1)\n```\n';
const activity = '\n::: {.ai-feedback #act}\nExplain your answer.\n:::\n';

function withProject(files, run, {old = false} = {}) {
  const dir = C.tempdir('ctm-legacy-');
  try {
    if (old) {
      // An old standalone ai-feedback 0.8.1 under the owner folder, ctm-libs (without its alias) flat.
      fs.cpSync(path.join(sources, 'ai-feedback-0.8.1', '_extensions', 'ai-feedback'), path.join(dir, '_extensions', 'Erasmus-CTM', 'ai-feedback'), {recursive: true});
      C.install(dir, {withAlias: false});
    } else {
      C.install(dir);
      for (const name of ['math-exercise', 'py-exercise', 'pyodide-interaktiv']) {
        fs.cpSync(path.join(sources, name, '_extensions', name), path.join(dir, '_extensions', name), {recursive: true});
      }
    }
    C.write(dir, files);
    return run(dir);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}
const page = (filters, front, body) => '---\ntitle: t\nfilters: [' + filters + ']\n' + front + '---\n\n' + body;

test('math-exercise 0.9 alone loads ctm-libs\' feedback through the alias', {skip}, () => withProject({
  'page.qmd': page('math-exercise', 'lang: nb\n', math + activity),
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, DEPRECATED);
  const html = C.html(dir, 'page.qmd');
  assert.match(html, new RegExp('ai-feedback-' + v + '/feedback-core\\.js'));
  assert.match(html, /class="ai-feedback-data"/);
  assert.match(html, /math-feedback-btn/);
  assert.match(html, /data-feedback-policy="[^"]*exercise[^"]*area/);
  assert.match(html, /data-context-mode="auto"/);
  assert.match(html, /data-context="[^"]*A square has side 3/);
}));

test('py-exercise 0.3 with feedback: true loads ctm-libs\' feedback through the alias', {skip}, () => withProject({
  'page.qmd': page('py-exercise', 'py-exercise:\n  feedback: true\n', py),
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
  const html = C.html(dir, 'page.qmd');
  assert.match(html, new RegExp('ai-feedback-' + v + '/feedback-core\\.js'));
  assert.match(html, /window\.__pyExerciseConfig = \{[^}]*"feedback":true/);
  assert.match(html, /"policySelection":\{[^}]*"exercise":"add"/);
  assert.match(html, /"feedbackContext":\{[^}]*"mode":"auto"/);
}));

test('pyodide-interaktiv 1.8 loads ctm-libs\' feedback through the alias', {skip}, () => withProject({
  'page.qmd': page('pyodide-interaktiv', '', pyodide),
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
  const html = C.html(dir, 'page.qmd');
  assert.match(html, new RegExp('ai-feedback-' + v + '/feedback-core\\.js'));
  assert.match(html, /qpyodideFeedbackOptions = \{\s*enabled: true/);
}));

test('all old components with filters: [ai-feedback]: one preparation, one deprecation warning', {skip}, () => withProject({
  'page.qmd': page('ai-feedback, math-exercise, py-exercise, pyodide-interaktiv', 'py-exercise:\n  feedback: true\n', math + py + pyodide + activity),
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr.match(DEPRECATED)?.length, 1);
  const html = C.html(dir, 'page.qmd');
  assert.equal(html.match(/feedback-core\.js/g).length, 1);
  assert.equal(html.match(/window\.__aiFeedbackConfig = /g).length, 1);
  assert.equal(html.match(/window\.__aiFeedbackPolicies = /g).length, 1);
  assert.equal(html.match(/class="ai-feedback-data"/g).length, 1);
}));

test('package order without AI feedback: pyodide-interaktiv 1.8 is switched off by the Meta pass', {skip}, () => withProject({
  'page.qmd': page('ctm-libs, math-exercise, py-exercise, pyodide-interaktiv', 'pyodide:\n  feedback: true\n', math + pyodide + activity),
}, dir => {
  const r = C.render(dir, ['page.qmd'], {CTM_FEEDBACK: 'off'});
  assert.equal(r.status, 0, r.stderr);
  const html = C.html(dir, 'page.qmd');
  assert.doesNotMatch(html, /feedback-core\.js|window\.__aiFeedbackConfig =|class="ai-feedback-data"/);
  assert.match(html, /qpyodideFeedbackOptions = \{\s*enabled: false/);
  const messages = [...r.stderr.matchAll(/AI feedback is off for this build \(CTM_FEEDBACK=off\); left out on this page: ([^\n]*)\./g)].map(m => m[1]);
  assert.deepEqual(messages, ['1 AI feedback activity, pyodide-interaktiv feedback']);
}));

// Without AI feedback (P22) outside the package order, the old components do
// not know the switch: they keep their Feedback buttons, which their own
// scripts disable with a note, because nothing of AI feedback is loaded.
test('without AI feedback, pyodide-interaktiv 1.8 listed before ai-feedback keeps its (then disabled) Feedback', {skip}, () => withProject({
  'page.qmd': page('pyodide-interaktiv, ai-feedback', '', pyodide),
}, dir => {
  const r = C.render(dir, ['page.qmd'], {CTM_FEEDBACK: 'off'});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr.match(DEPRECATED)?.length, 1);
  const html = C.html(dir, 'page.qmd');
  assert.match(html, /qpyodideFeedbackOptions = \{\s*enabled: true/);
  assert.doesNotMatch(html, /feedback-core\.js|window\.__aiFeedbackConfig =|window\.__aiFeedbackPolicies =/);
  assert.doesNotMatch(r.stderr, /AI feedback is off for this build/, 'no build message names an older component');
}));

test('without AI feedback, math-exercise 0.9 and py-exercise 0.3 alone keep Feedback buttons that their scripts disable', {skip}, () => withProject({
  'math.qmd': page('math-exercise', '', math),
  'py.qmd': page('py-exercise', 'py-exercise:\n  feedback: true\n', py),
}, dir => {
  let r = C.render(dir, ['math.qmd'], {CTM_FEEDBACK: 'off'});
  assert.equal(r.status, 0, r.stderr);
  let html = C.html(dir, 'math.qmd');
  assert.match(html, /math-feedback-btn/);
  assert.match(html, /math-reconfig-btn/);
  assert.match(html, /data-feedback-policy="[^"]*exercise[^"]*area[^"]*name&quot;:&quot;&quot;/);
  assert.match(html, /Math feedback requires ai-feedback 0\.5\.0 or later/);
  assert.doesNotMatch(html, /feedback-core\.js|window\.__aiFeedbackConfig =/);
  assert.doesNotMatch(r.stderr, /AI feedback is off for this build/);
  r = C.render(dir, ['py.qmd'], {CTM_FEEDBACK: 'off'});
  assert.equal(r.status, 0, r.stderr);
  html = C.html(dir, 'py.qmd');
  assert.match(html, /window\.__pyExerciseConfig = \{[^}]*"feedback":true/);
  // Its own feedback fields stay; ctm-libs' parts of them are empty.
  assert.match(html, /"task":"Write add\(a, b\)\."/);
  assert.match(html, /"policySelection":\{[^}]*"name":""/);
  assert.match(html, /"feedbackContext":\{[^}]*"mode":"none"/);
  assert.match(html, /Python feedback requires ai-feedback 0\.5\.0 or later/);
  assert.doesNotMatch(html, /feedback-core\.js|window\.__aiFeedbackConfig =/);
  assert.doesNotMatch(r.stderr, /AI feedback is off for this build/);
}));

test('an old standalone ai-feedback 0.8.1 next to ctm-libs stops the page, in either order', {skip}, () => withProject({
  'before.qmd': page('ai-feedback, ctm-libs', '', activity),
  'after.qmd': page('ctm-libs, ai-feedback', '', activity),
}, dir => {
  for (const file of ['before.qmd', 'after.qmd']) {
    const r = C.render(dir, [file]);
    assert.notEqual(r.status, 0, file);
    assert.match(r.stderr, /This page combines filters that use different ai-feedback versions: .*\(0\.8\.1\) and .*\(0\.9\.0\)|This page combines filters that use different ai-feedback versions: .*\(0\.9\.0\) and .*\(0\.8\.1\)/s, file);
  }
}, {old: true}));
