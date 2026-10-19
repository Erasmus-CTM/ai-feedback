// P22: one source builds a site without AI feedback (ai-feedback: enabled:
// false in a profile, or CTM_FEEDBACK=off). Nothing of AI feedback reaches
// the HTML; activities keep their visible task; pages that asked for
// feedback get one build message; policies are validated in both builds.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const C = require('./helpers/ctm-libs.cjs');
const skip = C.hasQuarto ? false : 'Quarto required';
const MARKERS = /CRITERIA_MARKER_4412|STARTER_MARKER_9183|POLICY_MARKER_7731/;
const MESSAGE = /AI feedback is off for this build \(([^)]*\)?)\); left out on this page: ([^\n]*)\./g;

const activity = [
  '## Spanish', '', 'Context prose with $x^2$.', '',
  '::: {#notes .ai-feedback-context}', 'Notes with $y^3$.', ':::', '',
  '::: {.callout-note .ai-feedback-ignore}', 'Hidden note.', ':::', '',
  '::: {.ai-feedback #essay feedback-policy="course" context="notes"}', 'Write two sentences about $z$.', '',
  '::: {.feedback-source}', 'Source with $s$.', ':::', '',
  '::: {.feedback-criteria}', 'CRITERIA_MARKER_4412', ':::', '',
  '::: {.feedback-starter}', 'STARTER_MARKER_9183', ':::', ':::', '',
  '```python', 'print(1)', '```', ''].join('\n');
const probes = C.probe('switch', 'return {ctm.feedback.enabled()}')
  + C.probe('request', 'return ctm.feedback.request("math-exercise", true, "feedback: auto")')
  + C.probe('declined', 'return ctm.feedback.request("py-exercise", false, "feedback: false")')
  + C.probe('selection', 'local b = pandoc.CodeBlock("x", pandoc.Attr("ex1")); return {ctm.feedback.selection(b, {["feedback-policy"] = "course"}), ctm.feedback.context(b, {context = "notes"})}');

function withProject(run) {
  const dir = C.tempdir('ctm-no-ai-');
  try {
    C.installPackage(dir); C.install(dir); C.installProbe(dir);
    C.write(dir, {
      '_quarto.yml': 'project:\n  type: default\n  render: [activity.qmd, asks.qmd, plain.qmd, pyodide.qmd]\nfilters: [ctm-libs, probe]\n'
        + 'ai-feedback:\n  mode: api\n  base-url: https://llm.example.edu/v1\n  model: course-model\n  policy-files: policies.yml\n  project-policy: course\n',
      '_quarto-no-ai.yml': 'ai-feedback:\n  enabled: false\n',
      'policies.yml': 'ai-feedback:\n  policies:\n    course:\n      base-prompt: POLICY_MARKER_7731\n',
      'activity.qmd': '---\ntitle: Activity\n---\n' + activity + probes,
      'asks.qmd': '---\ntitle: Asks\nai-feedback:\n  enabled: true\n---\nText.\n',
      'plain.qmd': '---\ntitle: Plain\n---\nNo feedback here.\n',
      'pyodide.qmd': '---\ntitle: Pyodide\n---\n```{pyodide-python}\nprint(1)\n```\n' + C.probe('pyodide', 'return {meta.pyodide and meta.pyodide.feedback}'),
    });
    return run(dir);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}
function files(dir) {
  return fs.readdirSync(dir, {recursive: true}).map(String).filter(name => !name.startsWith('_extensions'));
}
function checkOff(dir, reason) {
  assert.deepEqual(files(dir).filter(name => /ai-feedback-\d|feedback-core\.js|feedback-dom\.js|ai-feedback\.js|ai-feedback\.css/.test(name)), []);
  for (const page of ['activity.qmd', 'asks.qmd', 'plain.qmd', 'pyodide.qmd']) {
    const html = C.html(dir, page);
    assert.doesNotMatch(html, /window\.__aiFeedbackConfig =|window\.__aiFeedbackPolicies|feedback-core\.js|ai-feedback\.css/, page);
    assert.doesNotMatch(html, /class="ai-feedback-data"|data-ai-feedback-context|data-ai-feedback-tex/, page);
    assert.doesNotMatch(html, MARKERS, page);
  }
  const html = C.html(dir, 'activity.qmd');
  const start = html.indexOf('<div id="essay" class="ai-feedback-task">');
  assert.ok(start > 0, 'the activity is a task');
  const task = html.slice(start, html.indexOf('code-copy-outer-scaffold', start));
  assert.match(task, /Write two sentences about/);
  assert.match(task, /Source with/);
  assert.doesNotMatch(task, /<textarea|<noscript|<button/);
  const p = C.probes(html);
  assert.deepEqual(p.switch, [false, reason]);
  assert.equal(p.request, false);
  assert.equal(p.declined, false);
  assert.deepEqual(p.selection, [{exercise: 'ex1', name: ''}, {mode: 'none', refs: '', text: ''}]);
  assert.deepEqual(C.probes(C.html(dir, 'pyodide.qmd')).pyodide, [false]);
}
function messages(stderr) {
  return [...stderr.matchAll(MESSAGE)].map(m => ({reason: m[1], items: m[2]}));
}

test('a profile with ai-feedback: enabled: false builds the site without AI feedback', {skip}, () => withProject(dir => {
  const r = C.render(dir, ['--profile', 'no-ai']);
  assert.equal(r.status, 0, r.stderr);
  checkOff(dir, 'ai-feedback: enabled: false (_quarto-no-ai.yml)');
  const found = messages(r.stderr);
  assert.deepEqual(found.map(m => m.reason), Array(3).fill('ai-feedback: enabled: false (_quarto-no-ai.yml)'));
  assert.deepEqual(found.map(m => m.items).sort(), [
    '1 AI feedback activity, math-exercise feedback (feedback: auto)',
    'ai-feedback: enabled: true (asks.qmd)',
    'pyodide-interaktiv feedback',
  ]);
}));

test('CTM_FEEDBACK=off does the same without any metadata', {skip}, () => withProject(dir => {
  const r = C.render(dir, [], {CTM_FEEDBACK: 'off'});
  assert.equal(r.status, 0, r.stderr);
  checkOff(dir, 'CTM_FEEDBACK=off');
  assert.equal(messages(r.stderr).length, 2);
}));

test('the normal build keeps AI feedback; an unknown CTM_FEEDBACK value warns', {skip}, () => withProject(dir => {
  const r = C.render(dir, [], {CTM_FEEDBACK: 'maybe'});
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /CTM_FEEDBACK=maybe is not understood \(use off\); AI feedback follows the project's settings\./);
  assert.equal(messages(r.stderr).length, 0);
  const html = C.html(dir, 'activity.qmd');
  assert.match(html, /window\.__aiFeedbackConfig = /);
  assert.match(html, /POLICY_MARKER_7731/);
  assert.match(html, /class="ai-feedback-data"/);
  assert.match(html, /data-ai-feedback-tex/);
  const p = C.probes(html);
  assert.deepEqual(p.switch, [true]);
  assert.equal(p.request, true);
  assert.equal(p.selection[0].name, 'course');
  assert.deepEqual(C.probes(C.html(dir, 'pyodide.qmd')).pyodide, []);  // no pyodide metadata
}));

test('policies and switch values are checked in both builds', {skip}, () => withProject(dir => {
  fs.writeFileSync(path.join(dir, 'policies.yml'), 'ai-feedback:\n  policies:\n    course:\n      prompt: OLD\n');
  let r = C.render(dir, ['--profile', 'no-ai']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /use base-prompt instead of prompt/);
  fs.writeFileSync(path.join(dir, 'policies.yml'), 'ai-feedback:\n  policies:\n    course:\n      max-words: 90\n');
  fs.writeFileSync(path.join(dir, '_quarto-no-ai.yml'), 'ai-feedback:\n  enabled: no-thanks\n');
  r = C.render(dir, ['--profile', 'no-ai']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ai-feedback: enabled \(_quarto-no-ai\.yml\) must be true or false \(found "no-thanks"\)/);
}));
