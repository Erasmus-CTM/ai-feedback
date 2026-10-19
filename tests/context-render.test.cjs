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
// Their builds without AI feedback (P22) show the activities as text.
const WITHOUT_AI = 'ai-feedback:\n  without-ai: text\n';
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
    C.write(dir, {'page.qmd': '---\ntitle: t\nfilters: [ctm-libs, probe]\n' + WITHOUT_AI + '---\n\n' + tabsets + cells});
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
// sees it, also when a <details> is left open. Explicit context leaves out
// context blocks without an id too; a tabset marked .ai-feedback-ignore is
// passed over like any ignored block.
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
  '::: {.ai-feedback-context}', 'Context block without an id.', ':::', '',
  '::: {.ai-feedback #after-callout}', 'Task after the callout.', ':::', '',
  '::: {.ai-feedback #explicit-after context="elsewhere"}', 'Task with an explicit context.', ':::', '',
  '::: {.wrapper}', '```{=html}', '<details>', '```', '', 'UNCLOSED_MARKER.', ':::', '',
  '::: {.ai-feedback #after-unclosed}', 'Task after the unclosed block.', ':::', '',
  '::: {.panel-tabset .ai-feedback-ignore}', '### Ignored tab', '', 'Ignored tab prose.', '',
  '::: {.ai-feedback #in-ignored-tabset}', 'Task in an ignored tabset.', ':::', ':::', '',
  '## Elsewhere', '', '::: {#elsewhere .ai-feedback-context}', 'Far.', ':::', ''].join('\n');

test('closed material is a scope: exercises in it get its prose, nothing after it does', {skip}, () => {
  const dir = C.tempdir('ctm-context-closed-');
  try {
    C.installPackage(dir); C.install(dir); C.installProbe(dir);
    C.write(dir, {'page.qmd': '---\ntitle: t\nfilters: [ctm-libs, probe]\n' + WITHOUT_AI + '---\n\n' + closed + cells});
    let r = C.render(dir, ['page.qmd']);
    assert.equal(r.status, 0, r.stderr);
    let html = C.html(dir, 'page.qmd');
    const outer = 'Closed\nOuter prose.', inside = outer + '\nGo deeper\nInner instructions.', open = outer + '\nOpen note\nOpen note prose.';
    assert.deepEqual(Object.fromEntries(Object.entries(activities(html)).map(([id, d]) => [id, d.context])), {
      'inside-details': inside,
      'after-details': outer,
      'inside-callout': outer + '\nWorked solution\nCALLOUT_SOLUTION_MARKER.',
      'after-callout': open + '\nContext block without an id.',
      'explicit-after': open,
      'after-unclosed': open + '\nContext block without an id.',
    });
    assert.deepEqual(C.probes(html).cells, {'cell-inside': inside});
    assert.doesNotMatch(r.stderr, /cannot read the tabs/);
    // Without AI feedback (P22) the activities in closed material become tasks as well.
    r = C.render(dir, ['page.qmd'], {CTM_FEEDBACK: 'off'});
    assert.equal(r.status, 0, r.stderr);
    html = C.html(dir, 'page.qmd');
    for (const id of ['inside-details', 'inside-callout', 'after-unclosed']) assert.match(html, new RegExp('<div id="' + id + '" class="ai-feedback-task">'), id);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// Reveals (lua/ui.lua) become <details> tags around a Div that holds their
// content: the AI context of every exercise is that of the same page written
// with raw <details>, byte for byte, also with headings inside the blocks
// (which the raw form cannot render, but the context walk reads alike).
function revealPage(form) {
  const block = (kind, rawClass, title, body) => form === 'raw'
    ? ['<details' + (rawClass ? ' class="' + rawClass + '"' : '') + '>', '<summary>' + title + '</summary>', '', ...body, '', '</details>']
    : ['::: {.' + kind + (title ? ' title="' + title.replace(/\\/g, '\\\\') + '"' : '') + '}', ...body, ':::'];
  const indent = lines => lines.map(line => line ? '  ' + line : line);
  return ['## Reveals', '', 'Section prose.', '',
    ...block('reading-step', 'reading-step', 'Gå i dybden: *skaler* $x^2$', ['Step prose.', '', '```{.python #cell-step-top}', 'print(0)', '```', '', '#### A heading in the step', '', 'Prose under it.', '',
      '::: {.ai-feedback #in-step}', 'Task in the step.', ':::', '', '```{.python #cell-in-step}', 'print(1)', '```']), '',
    '::: {.ai-feedback #after-step}', 'Task after the step.', ':::', '',
    '::: {.panel-tabset}', '### Tab one', '', 'Tab one prose.', '',
    ...block('hint', 'learning-hint', 'Hint', ['Hint prose.', '', '##### Hint heading', '', '::: {.ai-feedback #in-hint}', 'Task in the hint.', ':::']), '',
    '::: {.ai-feedback #after-hint}', 'Task after the hint.', ':::', '',
    '### Tab two', '',
    ...block('solution', 'solution-block', form === 'raw' ? 'Løsningsforslag' : '', ['Solution prose.', '', '```{.python #cell-in-solution}', 'print(2)', '```']), '',
    '```{.python #cell-tab-two}', 'print(3)', '```', ':::', '',
    'Prose after the tabset.', '',
    '- An item', '', ...indent(block('hint', 'learning-hint', 'Item hint', ['Item hint prose.', '', '::: {.ai-feedback #in-item}', 'Task in the item.', ':::'])), '',
    ...block('details', '', 'SciPy-oppslag: $\\mathbf{A}$', ['```{.python #cell-details-top}', 'print(5)', '```', '', '#### Lookup', '', 'Lookup prose.', '', '::: {.ai-feedback #in-details}', 'Task in the details.', ':::']), '',
    '::: {.ai-feedback #at-end}', 'Task at the end.', ':::', '',
    '```{.python #cell-at-end}', 'print(4)', '```', ''].join('\n');
}

test('reveals give the AI context of raw <details>, byte for byte, headings inside them included', {skip}, () => {
  const dir = C.tempdir('ctm-context-reveals-');
  try {
    C.installPackage(dir); C.install(dir); C.installProbe(dir);
    const front = '---\ntitle: t\nlang: nb\nfilters: [ctm-libs, probe]\n---\n\n';
    C.write(dir, {'raw.qmd': front + revealPage('raw') + cells, 'reveal.qmd': front + revealPage('reveal') + cells});
    const r = C.render(dir, ['raw.qmd']);
    assert.equal(r.status, 0, r.stderr);
    const s = C.render(dir, ['reveal.qmd']);
    assert.equal(s.status, 0, s.stderr);
    const raw = C.html(dir, 'raw.qmd'), reveal = C.html(dir, 'reveal.qmd');
    assert.equal((reveal.match(/<details class="ctm-reveal /g) || []).length, 5, 'the reveal page has five reveals');
    const contexts = html => ({
      activities: Object.fromEntries(Object.entries(activities(html)).map(([id, d]) => [id, d.context])),
      cells: C.probes(html).cells,
      attributes: [...html.matchAll(/data-ai-feedback-context="([^"]*)"/g)].map(m => m[1]),
    });
    const expected = contexts(raw);
    assert.deepEqual(Object.keys(expected.activities), ['in-step', 'after-step', 'in-hint', 'after-hint', 'in-item', 'in-details', 'at-end']);
    // A heading inside a block starts a section there; after the block the outer section goes on.
    assert.equal(expected.activities['in-step'], 'A heading in the step\nProse under it.');
    assert.equal(expected.activities['after-step'], 'Reveals\nSection prose.');
    assert.equal(expected.activities['in-details'], 'Lookup\nLookup prose.');
    assert.equal(expected.activities['at-end'], 'Reveals\nSection prose.\nProse after the tabset.\nAn item');
    // Titles with Markdown and mathematics (backslashes doubled in title=) read alike.
    assert.equal(expected.cells['cell-step-top'], 'Reveals\nSection prose.\nGå i dybden: skaler \\(x^2\\)\nStep prose.');
    assert.equal(expected.cells['cell-details-top'], 'Reveals\nSection prose.\nProse after the tabset.\nAn item\nSciPy-oppslag: \\(\\mathbf{A}\\)');
    assert.equal(expected.cells['cell-in-solution'], 'Tab two\nLøsningsforslag\nSolution prose.', 'the default title, in the page\'s language');
    assert.deepEqual(contexts(reveal), expected);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a tabset whose tabs cannot be read is walked whole, with one warning', {skip}, () => {
  const dir = C.tempdir('ctm-context-unreadable-');
  try {
    C.installPackage(dir); C.install(dir); C.installProbe(dir);
    // Two Tabset nodes whose data Quarto does not hold (as if a Quarto version kept them from filters).
    const fake = ['local attrs = {__quarto_custom = "true", __quarto_custom_type = "Tabset", __quarto_custom_context = "Block", __quarto_custom_id = "unreadable"}',
      'local function node() return pandoc.Div({pandoc.Div({pandoc.Para({pandoc.Str("Tab prose.")})}), pandoc.Div({pandoc.Plain({pandoc.Str("Tab")})})}, pandoc.Attr("", {}, attrs)) end',
      'local page = ctm.feedback.prepare(pandoc.Pandoc({node(), node(), pandoc.CodeBlock("print(1)", pandoc.Attr("after"))}, pandoc.Meta({})))',
      'return page.blocks[3].attributes["data-ai-feedback-context"]'].join('\n');
    C.write(dir, {'page.qmd': '---\ntitle: t\nfilters: [ctm-libs, probe]\n---\n\nText.\n' + C.probe('unreadable', fake)});
    const r = C.render(dir, ['page.qmd']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.match(/ctm-libs cannot read the tabs of a tabset with this Quarto version/g)?.length, 1, r.stderr);
    assert.equal(C.probes(C.html(dir, 'page.qmd')).unreadable, 'Tab prose.\nTab\nTab prose.\nTab');
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
