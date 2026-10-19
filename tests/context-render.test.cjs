// A5 (P19): explicit context also sends the exercise's own section prose,
// without context blocks (the listed ones are sent on their own, the others
// belong to other exercises); the 1500-character cap counts that prose only.
// The section is the innermost heading or tab, in both modes; <details>
// content (solutions, reading steps, hints) is never prose.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {JSDOM} = require('jsdom');
const C = require('./helpers/ctm-libs.cjs');
const skip = C.hasQuarto ? false : 'Quarto required';

const LONG = 'Long note ' + 'x'.repeat(1600) + '.';
const source = [
  '## Section', '', 'Prose one.', '',
  '::: {#notes .ai-feedback-context}', 'Note text $n_1$.', ':::', '',
  'Prose two.', '',
  '::: {.ai-feedback #auto}', 'Task A.', ':::', '',
  '::: {.ai-feedback #explicit context="notes, jsxgraph:board"}', 'Task B.', ':::', '',
  '::: {.ai-feedback #elsewhere context="faraway"}', 'Task C.', ':::', '',
  '::: {.ai-feedback #off context="none"}', 'Task D.', ':::', '',
  '```{.python #listed}', '#| context: notes', 'print(1)', '```', '',
  '```{.python #plain}', 'print(2)', '```', '',
  '```{.pyodide-python #pyodide}', '#| context: setup', 'print(3)', '```', '',
  '```{.pyodide-python #pyodide-feedback}', '#| context: setup', '#| feedback-context: notes', 'print(4)', '```', '',
  '## Long', '', 'Short prose.', '',
  '::: {#long .ai-feedback-context}', LONG, ':::', '',
  '::: {.ai-feedback #capped-explicit context="long"}', 'Task E.', ':::', '',
  '::: {.ai-feedback #capped-auto}', 'Task F.', ':::', '',
  '## Other', '',
  '::: {#faraway .ai-feedback-context}', 'Far away.', ':::', ''].join('\n');
const cells = C.probe('cells', [
  'local out = {}',
  'doc.blocks:walk({CodeBlock = function(b) if b.identifier ~= "" and not b.classes:includes("ctm-probe") then out[b.identifier] = b.attributes["data-ai-feedback-context"] or "<none>" end end})',
  'return out'].join('\n'));
const activities = html => Object.fromEntries([...html.matchAll(/<div id="([^"]+)" class="ai-feedback-activity">[\s\S]*?<script type="application\/json" class="ai-feedback-data">([\s\S]*?)<\/script>/g)].map(m => [m[1], JSON.parse(m[2])]));

test('explicit context: context blocks are left out of the section prose, which is kept', {skip}, () => {
  const dir = C.tempdir('ctm-context-');
  try {
    C.installPackage(dir); C.install(dir); C.installProbe(dir);
    C.write(dir, {'page.qmd': '---\ntitle: t\nfilters: [ctm-libs, probe]\n---\n\n' + source + cells});
    const r = C.render(dir, ['page.qmd']);
    assert.equal(r.status, 0, r.stderr);
    const html = C.html(dir, 'page.qmd');
    const data = activities(html);
    const all = 'Section\nProse one.\nNote text \\(n_1\\).\nProse two.';
    const own = 'Section\nProse one.\nProse two.';
    assert.equal(data.auto.context, all);
    assert.equal(data.explicit.context, own);
    assert.equal(data.explicit.contextMode, 'explicit');
    assert.equal(data.elsewhere.context, own, 'another exercise\'s context block is not prose either');
    assert.equal(data.off.context, '');
    assert.equal(data['capped-explicit'].context, 'Long\nShort prose.', 'the cap counts the section prose only');
    // Unchanged for automatic context: whole blocks up to 1500 characters, from the latest back; an oversized latest block ends it.
    assert.equal(data['capped-auto'].context, '');
    assert.deepEqual(C.probes(html).cells, {listed: own, plain: all, pyodide: all, 'pyodide-feedback': own});
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// A tab starts a section, as a heading does (nested tabsets too); after a
// tabset its enclosing section goes on without the tabs' prose. Closed
// <details> (solution-block, reading-step, learning-hint), code and other
// activities are no prose in either mode.
const tabsets = [
  '## Section', '', 'Section prose.', '',
  '::: {.panel-tabset}', '### Tab one', '', 'Prose of tab one.', '',
  '::: {#ctx-one .math-exercise-context}', 'Context block of tab one.', ':::', '',
  '```{.python}', 'CODE_MARKER = 1', '```', '',
  '<details class="solution-block">', '<summary>Solution</summary>', '', 'SOLUTION_MARKER of tab one.', '', '</details>', '',
  '::: {.ai-feedback #auto-one}', 'Task one.', ':::', '',
  '::: {.ai-feedback #explicit-one context="ctx-one"}', 'Task one, explicit.', ':::', '',
  '### Tab two', '',
  '::: {.panel-tabset}', '#### Inner A', '', 'Inner A prose.', '',
  '<details class="reading-step">', '<summary>Read on</summary>', '', 'READING_MARKER.', '', '</details>', '',
  '::: {.ai-feedback #auto-inner}', 'Task inner.', ':::', '',
  '#### Inner B', '', 'Inner B prose.', ':::', '',
  'Tab two prose after the inner tabset.', '',
  '::: {#ctx-other .math-exercise-context}', 'Context block of another exercise.', ':::', '',
  '::: {.ai-feedback #other-two context="ctx-other"}', 'Task other.', ':::', '',
  '::: {#ctx-two .math-exercise-context}', 'Context block of tab two.', ':::', '',
  '::: {.ai-feedback #explicit-two context="ctx-two"}', 'Task two.', ':::', '',
  '```{.python #cell-two}', '#| context: ctx-two', 'print(2)', '```', '',
  '::: {.ai-feedback #auto-two}', 'Task two, auto.', ':::', '',
  ':::', '',
  'Section prose after the tabset.', '',
  '<details class="learning-hint">', '<summary>Hint</summary>', '', 'HINT_MARKER.', '', '</details>', '',
  '::: {.ai-feedback #auto-after}', 'Task after.', ':::', '',
  '```{.python #cell-after}', 'print(3)', '```', ''].join('\n');

test('a tab is a section of its own, nested too; <details> content is no prose (explicit and auto)', {skip}, () => {
  const dir = C.tempdir('ctm-context-tabs-');
  try {
    C.installPackage(dir); C.install(dir); C.installProbe(dir);
    C.write(dir, {'page.qmd': '---\ntitle: t\nfilters: [ctm-libs, probe]\n---\n\n' + tabsets + cells});
    let r = C.render(dir, ['page.qmd']);
    assert.equal(r.status, 0, r.stderr);
    let html = C.html(dir, 'page.qmd');
    const data = activities(html);
    const tabOne = 'Tab one\nProse of tab one.';
    const tabTwo = 'Tab two\nTab two prose after the inner tabset.';
    const after = 'Section\nSection prose.\nSection prose after the tabset.';
    assert.deepEqual(Object.fromEntries(Object.entries(data).map(([id, d]) => [id, d.context])), {
      'auto-one': tabOne + '\nContext block of tab one.',
      'explicit-one': tabOne,
      'auto-inner': 'Inner A\nInner A prose.',
      'other-two': tabTwo,
      'explicit-two': tabTwo,
      'auto-two': tabTwo + '\nContext block of another exercise.\nContext block of tab two.',
      'auto-after': after,
    });
    assert.deepEqual(C.probes(html).cells, {'cell-two': tabTwo, 'cell-after': after});
    // The tabs are still rendered whole.
    for (const text of ['Inner B prose.', 'SOLUTION_MARKER', 'READING_MARKER', 'HINT_MARKER', '>Inner A<', '>Tab two<']) assert.ok(html.includes(text), text);
    // Without AI feedback (P22) the activities in tabs become tasks as well.
    r = C.render(dir, ['page.qmd'], {CTM_FEEDBACK: 'off'});
    assert.equal(r.status, 0, r.stderr);
    html = C.html(dir, 'page.qmd');
    for (const id of Object.keys(data)) assert.match(html, new RegExp('<div id="' + id + '" class="ai-feedback-task">'), id);
    assert.doesNotMatch(html, /class="ai-feedback-data"|data-ai-feedback-context/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// Closed material (<details>, collapsed callouts) is a scope: an exercise in
// it gets the section's prose and its block's prose; nothing after the block
// sees it, also when a <details> is left open.
const closed = [
  '## Closed', '', 'Outer prose.', '',
  '<details class="reading-step">', '<summary>Go deeper</summary>', '', 'Inner instructions.', '',
  '::: {.ai-feedback #inside-details}', 'Task inside.', ':::', '',
  '```{.python #cell-inside}', 'print(1)', '```', '',
  '#### A heading in the block', '', 'DETAILS_TAIL_MARKER.', '',
  '</details>', '',
  '::: {.ai-feedback #after-details}', 'Task after the block.', ':::', '',
  '::: {.callout-tip collapse="true"}', '## Worked solution', '', 'CALLOUT_SOLUTION_MARKER.', '',
  '::: {.ai-feedback #inside-callout}', 'Task in the callout.', ':::', ':::', '',
  '::: {.callout-note}', '## Open note', '', 'Open note prose.', ':::', '',
  '::: {.ai-feedback #after-callout}', 'Task after the callout.', ':::', '',
  '::: {.ai-feedback #explicit-after context="elsewhere"}', 'Task with an explicit context.', ':::', '',
  '::: {.wrapper}', '```{=html}', '<details>', '```', '', 'UNCLOSED_MARKER.', ':::', '',
  '::: {.ai-feedback #after-unclosed}', 'Task after the unclosed block.', ':::', '',
  '## Elsewhere', '', '::: {#elsewhere .ai-feedback-context}', 'Far.', ':::', ''].join('\n');

test('closed material is a scope: exercises in it get its prose, nothing after it does', {skip}, () => {
  const dir = C.tempdir('ctm-context-closed-');
  try {
    C.installPackage(dir); C.install(dir); C.installProbe(dir);
    C.write(dir, {'page.qmd': '---\ntitle: t\nfilters: [ctm-libs, probe]\n---\n\n' + closed + cells});
    let r = C.render(dir, ['page.qmd']);
    assert.equal(r.status, 0, r.stderr);
    let html = C.html(dir, 'page.qmd');
    const outer = 'Closed\nOuter prose.', inside = outer + '\nGo deeper\nInner instructions.', open = outer + '\nOpen note\nOpen note prose.';
    assert.deepEqual(Object.fromEntries(Object.entries(activities(html)).map(([id, d]) => [id, d.context])), {
      'inside-details': inside,
      'after-details': outer,
      'inside-callout': outer + '\nWorked solution\nCALLOUT_SOLUTION_MARKER.',
      'after-callout': open,
      'explicit-after': open,
      'after-unclosed': open,
    });
    assert.deepEqual(C.probes(html).cells, {'cell-inside': inside});
    // Without AI feedback (P22) the activities in closed material become tasks as well.
    r = C.render(dir, ['page.qmd'], {CTM_FEEDBACK: 'off'});
    assert.equal(r.status, 0, r.stderr);
    html = C.html(dir, 'page.qmd');
    for (const id of ['inside-details', 'inside-callout', 'after-unclosed']) assert.match(html, new RegExp('<div id="' + id + '" class="ai-feedback-task">'), id);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('contextMaterials: listed blocks first, then the section prose; auto and none unchanged', () => {
  const w = new JSDOM('<main><div id="notes" class="ai-feedback-context">Listed note.</div></main>', {url: 'https://example.invalid/', runScripts: 'outside-only'}).window;
  for (const file of ['feedback-core.js', 'feedback-dom.js', 'ai-feedback.js']) w.eval(fs.readFileSync(path.join(C.feedback, file), 'utf8'));
  const F = w.AIFeedback;
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(F.contextMaterials({mode: 'explicit', refs: 'notes', text: 'Section prose.'})), [
    {id: 'notes', role: 'context', text: 'Listed note.'}, {id: 'section-context', role: 'context', text: 'Section prose.'}]);
  assert.deepEqual(plain(F.contextMaterials({mode: 'explicit', refs: 'notes', text: ''})), [{id: 'notes', role: 'context', text: 'Listed note.'}]);
  assert.deepEqual(plain(F.contextMaterials({mode: 'auto', refs: '', text: 'Section prose.'})), [{id: 'section-context', role: 'context', text: 'Section prose.'}]);
  assert.deepEqual(plain(F.contextMaterials({mode: 'none', refs: 'notes', text: 'Section prose.'})), []);
  w.close();
});
