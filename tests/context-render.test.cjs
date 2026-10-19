// A5 (P19): explicit context also sends the exercise's own section prose,
// without the blocks it lists (they are sent on their own); the 1500-character
// cap counts that prose only. Automatic context is unchanged.
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

test('explicit context: the listed blocks are left out of the section prose, which is kept', {skip}, () => {
  const dir = C.tempdir('ctm-context-');
  try {
    C.installPackage(dir); C.install(dir); C.installProbe(dir);
    C.write(dir, {'page.qmd': '---\ntitle: t\nfilters: [ctm-libs, probe]\n---\n\n' + source + cells});
    const r = C.render(dir, ['page.qmd']);
    assert.equal(r.status, 0, r.stderr);
    const html = C.html(dir, 'page.qmd');
    const data = Object.fromEntries([...html.matchAll(/<div id="([^"]+)" class="ai-feedback-activity">[\s\S]*?<script type="application\/json" class="ai-feedback-data">([\s\S]*?)<\/script>/g)].map(m => [m[1], JSON.parse(m[2])]));
    const all = 'Section\nProse one.\nNote text \\(n_1\\).\nProse two.';
    const own = 'Section\nProse one.\nProse two.';
    assert.equal(data.auto.context, all);
    assert.equal(data.explicit.context, own);
    assert.equal(data.explicit.contextMode, 'explicit');
    assert.equal(data.elsewhere.context, all, 'a block from another section changes nothing');
    assert.equal(data.off.context, '');
    assert.equal(data['capped-explicit'].context, 'Long\nShort prose.', 'the cap counts the section prose only');
    // Unchanged for automatic context: whole blocks up to 1500 characters, from the latest back; an oversized latest block ends it.
    assert.equal(data['capped-auto'].context, '');
    assert.deepEqual(C.probes(html).cells, {listed: own, plain: all, pyodide: all, 'pyodide-feedback': own});
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
