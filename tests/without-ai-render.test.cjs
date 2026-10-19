// A build without AI feedback (P22) and the exercises that only AI feedback
// can assess: .ai-feedback activities, math-exercise in custom mode without a
// checker, py-exercise without tests (where their feedback is on). Without
// ai-feedback: without-ai the build stops with one error naming them all;
// text shows each question without answer box or Check button, self-check is
// text for now, drop removes them. Builds with AI feedback are unchanged.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const {JSDOM} = require('jsdom');
const C = require('./helpers/ctm-libs.cjs');
const skip = C.hasQuarto ? false : 'Quarto required';
const OFF = {CTM_FEEDBACK: 'off'};
const NOTE = 'This exercise has no automatic feedback in this version.';
const ERROR = /AI feedback is off for this build \(CTM_FEEDBACK=off\), and (\S+) has (.*?) that only AI feedback can assess: (.*?)\. Choose what a build without AI feedback does with (?:it|them), under ai-feedback: in _quarto\.yml or in the page's front matter: without-ai: text shows the question without answer box and Check button; without-ai: self-check is the same for now \(self-check comes in a later version\); without-ai: drop removes the exercise from the page \(a last resort\)\./;
const MESSAGE = /AI feedback is off for this build \(([^)]*)\); left out on this page: ([^\n]*)\./g;

// Every kind, also in <details>, a tab and a collapsed callout; hidden and
// statically checked exercises do not count.
const page = (front = '') => '---\ntitle: t\n' + front + '---\n\n' + [
  '## Writing', '',
  '::: {.ai-feedback #essay}', 'Write two sentences.', '', '::: {.feedback-criteria}', 'CRITERIA_MARKER_5520', ':::', ':::', '',
  '<details class="reading-step">', '<summary>Go deeper</summary>', '',
  '::: {.ai-feedback}', 'Explain the hint in your own words, please.', ':::', '', '</details>', '',
  '::: {.panel-tabset}', '### Tab', '',
  '```{math-exercise}', '#| label: sketch', '#| caption: Sketch', '#| mode: custom', 'Draw $y=x^2$ and give its value at 2: _[4]', '```', '', ':::', '',
  '```{py-exercise}', '#| label: free', '#| task: Print anything.', 'print("hello")', '```', '',
  '```{py-exercise}', '#| label: tested', '#| task: Return two.', 'def two():', '    return 0', '## TESTS ##', 'assert two() == 2', '```', '',
  '```{math-exercise}', '#| label: checked', '#| mode: custom', '#| checker: |', '#|   def check(response, symbols):', '#|       return True', 'Any: _[1]', '```', '',
  '::: {.callout-note collapse="true"}', '## Folded', '', '::: {.ai-feedback #folded}', 'Reflect.', ':::', ':::', '',
  '::: {.hidden}', '::: {.ai-feedback #hidden-activity}', 'Hidden.', ':::', ':::', ''].join('\n');
const NAMES = ['essay', '"Explain the hint in your own words,…"', 'sketch', 'free', 'folded'];
const KINDS = ['essay (AI feedback activity)', '"Explain the hint in your own words,…" (AI feedback activity)',
  'sketch (math-exercise in custom mode without a checker)', 'free (py-exercise without tests)', 'folded (AI feedback activity)'];

function withProject(files, run, {end = true} = {}) {
  const dir = C.tempdir('ctm-without-ai-');
  try {
    C.installPackage(dir); C.install(dir); C.installProbe(dir);
    C.write(dir, {'_quarto.yml': 'project:\n  type: default\n  render: [page.qmd]\nfilters: [ctm-libs, probe'
      + (end ? ', _extensions/ctm-libs/ctm-libs-end.lua' : '') + ']\npy-exercise:\n  feedback: true\n', ...files});
    return run(dir);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}
const setting = value => 'ai-feedback:\n  without-ai: ' + value + '\n';
const messages = stderr => [...stderr.matchAll(MESSAGE)].map(m => m[2]);

test('unset: the build stops with one error that names every such exercise of the page', {skip}, () => {
  // With the end filter (the package) and without it (development builds): the same one error.
  for (const end of [true, false]) withProject({'page.qmd': page()}, dir => {
    const r = C.render(dir, ['page.qmd'], OFF);
    assert.notEqual(r.status, 0, 'end filter: ' + end);
    const found = r.stderr.match(ERROR);
    assert.ok(found, r.stderr);
    assert.equal(found[1], 'page.qmd');
    assert.equal(found[2], '5 exercises');
    assert.equal(found[3], KINDS.join(', '));
    assert.equal(r.stderr.match(/only AI feedback can assess/g).length, 1, 'one error');
    assert.doesNotMatch(r.stderr, /left out on this page/);
  }, {end});
});

test('text: the questions stay, without answer box or Check button, with a note; one build message', {skip}, () => withProject({
  '_quarto.yml': 'project:\n  type: default\n  render: [page.qmd]\nfilters: [ctm-libs, probe, _extensions/ctm-libs/ctm-libs-end.lua]\npy-exercise:\n  feedback: true\n' + setting('text'),
  'page.qmd': page(),
}, dir => {
  const r = C.render(dir, ['page.qmd'], OFF);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(messages(r.stderr), ['5 exercises only AI feedback can assess, shown as text (without-ai: text in _quarto.yml): ' + NAMES.join(', ')]);
  const html = C.html(dir, 'page.qmd');
  assert.doesNotMatch(html, /CRITERIA_MARKER_5520|class="ai-feedback-data"|<textarea/);
  const doc = new JSDOM(html).window.document;
  const tasks = [...doc.querySelectorAll('.ai-feedback-task')];
  assert.deepEqual(tasks.map(t => t.id), ['essay', 'ai-feedback-2', 'folded']);
  for (const task of tasks) assert.equal(task.querySelector('.ctm-without-ai').textContent.trim(), NOTE);
  assert.match(doc.querySelector('#essay').textContent, /Write two sentences\./);
  assert.ok(doc.querySelector('details .ai-feedback-task'), 'the activity in <details> stays there');
  const math = doc.querySelector('.math-exercise-text');
  assert.match(math.textContent, /Sketch/);
  assert.match(math.textContent, /give its value at 2: …/);
  assert.equal(math.querySelector('.ctm-without-ai').textContent.trim(), NOTE);
  assert.ok(doc.querySelector('.tab-content .math-exercise-text'), 'in its tab');
  const py = doc.querySelector('.py-exercise-text');
  assert.equal(py.querySelector('code').textContent, 'print("hello")');
  assert.equal(py.querySelector('.ctm-without-ai').textContent.trim(), NOTE);
  // Statically checked exercises stay for their component; hidden blocks are untouched.
  assert.match(html, /return 0/);
  assert.match(html, /def check\(response, symbols\)/);
  assert.equal(doc.querySelectorAll('.ctm-without-ai').length, 5);
}));

test('self-check is text for now; drop removes the exercises; the page overrides the project', {skip}, () => withProject({
  '_quarto.yml': 'project:\n  type: default\n  render: [page.qmd, drop.qmd]\nfilters: [ctm-libs, probe, _extensions/ctm-libs/ctm-libs-end.lua]\npy-exercise:\n  feedback: true\n' + setting('self-check'),
  'page.qmd': page(),
  'drop.qmd': page(setting('drop')),
}, dir => {
  const r = C.render(dir, [], OFF);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(messages(r.stderr).sort(), [
    '5 exercises only AI feedback can assess, removed (without-ai: drop in drop.qmd): ' + NAMES.join(', '),
    '5 exercises only AI feedback can assess, shown as text (without-ai: self-check in _quarto.yml; self-check comes in a later version): ' + NAMES.join(', '),
  ]);
  const text = new JSDOM(C.html(dir, 'page.qmd')).window.document;
  assert.equal(text.querySelectorAll('.ctm-without-ai').length, 5);
  const dropped = C.html(dir, 'drop.qmd');
  assert.doesNotMatch(dropped, /Write two sentences|Explain the hint|give its value|print\(&quot;hello&quot;\)|print\("hello"\)|Reflect\.|ctm-without-ai|ai-feedback-task/);
  assert.match(dropped, /Go deeper/, 'the <details> block itself stays');
  assert.match(dropped, /return 0/, 'checked exercises stay');
}));

test('the language of the note follows the page; unset component feedback counts no component exercise', {skip}, () => withProject({
  '_quarto.yml': 'project:\n  type: default\n  render: [page.qmd]\nfilters: [ctm-libs, probe, _extensions/ctm-libs/ctm-libs-end.lua]\n' + setting('text'),
  'page.qmd': page('lang: nb\nmath-exercise:\n  feedback: false\n'),
}, dir => {
  const r = C.render(dir, ['page.qmd'], OFF);
  assert.equal(r.status, 0, r.stderr);
  // py-exercise: feedback is not set and math-exercise: feedback is false: only the activities count.
  assert.deepEqual(messages(r.stderr), ['3 exercises only AI feedback can assess, shown as text (without-ai: text in _quarto.yml): essay, "Explain the hint in your own words,…", folded']);
  const doc = new JSDOM(C.html(dir, 'page.qmd')).window.document;
  assert.deepEqual([...doc.querySelectorAll('.ctm-without-ai')].map(n => n.textContent.trim()),
    Array(3).fill('Denne oppgaven har ingen automatisk tilbakemelding i denne versjonen.'));
}));

test('an unknown value stops both builds, naming the allowed values; AI feedback builds are unchanged', {skip}, () => withProject({
  'page.qmd': page(setting('hide')),
}, dir => {
  for (const env of [OFF, {}]) {
    const r = C.render(dir, ['page.qmd'], env);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ai-feedback: without-ai must be text, self-check or drop \(found hide in page\.qmd\)/);
  }
  fs.writeFileSync(require('node:path').join(dir, 'page.qmd'), page());
  const r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /only AI feedback can assess|AI feedback is off/);
  const html = C.html(dir, 'page.qmd');
  assert.equal(new JSDOM(html).window.document.querySelectorAll('.ai-feedback-activity').length, 3);
  assert.doesNotMatch(html, /ctm-without-ai|ai-feedback-task/);
  assert.match(html, /mode: custom/, 'the component blocks are left to the components');
}));
