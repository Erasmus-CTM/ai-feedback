// The page's interface (lua/ui.lua), rendered: reveals, the lecture/reading
// switch, embedded pages and the dependencies (tab links on by default).
// Pages without the new syntax are unchanged.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {JSDOM} = require('jsdom');
const C = require('./helpers/ctm-libs.cjs');
const skip = C.hasQuarto ? false : 'Quarto required';

// A default project whose pages render with one `quarto render`.
function withProject(files, check, quartoYml = '') {
  const dir = C.tempdir('ctm-ui-');
  try {
    C.installPackage(dir); C.install(dir);
    const pages = Object.keys(files).filter(name => name.endsWith('.qmd'));
    const filters = /^filters:/m.test(quartoYml) ? '' : 'filters: [ctm-libs]\n';
    C.write(dir, {'_quarto.yml': 'project:\n  type: default\n  render: [' + pages.join(', ') + ']\n' + filters + quartoYml, ...files});
    check(dir);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}
const front = (extra = '') => '---\ntitle: t\n' + extra + '---\n\n';
const documentOf = html => new JSDOM(html).window.document;
const summaries = doc => [...doc.querySelectorAll('details.ctm-reveal')].map(d => [d.className, d.querySelector(':scope > summary').textContent.trim()]);
const dependencies = html => ['ctm-ui', 'ctm-reveal', 'ctm-nav'].filter(name => new RegExp('/' + name + '-[\\d.]+/' + name + '\\.(css|js)"').test(html));
const warnings = stderr => stderr.split('\n').map(line => line.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(line => /^(WARN|\(W\))/.test(line));

const KINDS = '::: {.reading-step}\nStep.\n:::\n\n::: {.hint}\nHint.\n:::\n\n::: {.solution}\nSolution.\n:::\n\n'
  + '::: {.details title="Own *title*"}\nDetails.\n:::\n';

test('reveals: four kinds, closed, with default titles in English, German, Bokmål and Nynorsk', {skip}, () => withProject({
  'en.qmd': front('lang: en\n') + KINDS,
  'de.qmd': front('lang: de\n') + KINDS,
  'nb.qmd': front('lang: nb-NO\n') + KINDS,
  'nn.qmd': front('lang: nn\n') + KINDS,
  'setting.qmd': front('lang: en\nctm-assessment:\n  lang: de\n') + KINDS,
}, dir => {
  const r = C.render(dir);
  assert.equal(r.status, 0, r.stderr);
  const titles = {
    en: ['Go deeper', 'Hint', 'Solution'], de: ['Vertiefung', 'Hinweis', 'Lösungsvorschlag'],
    nb: ['Gå i dybden', 'Hint', 'Løsningsforslag'], nn: ['Gå i djupna', 'Hint', 'Løysingsforslag'], setting: ['Vertiefung', 'Hinweis', 'Lösungsvorschlag'],
  };
  for (const [page, [step, hint, solution]] of Object.entries(titles)) {
    const doc = documentOf(C.html(dir, page + '.qmd'));
    assert.deepEqual(summaries(doc), [['ctm-reveal reading-step', step], ['ctm-reveal hint', hint], ['ctm-reveal solution', solution],
      ['ctm-reveal details', 'Own title']], page);
    for (const details of doc.querySelectorAll('details.ctm-reveal')) {
      assert.equal(details.open, false, page + ': closed');
      assert.equal(details.children.length, 2, page + ': a summary and the body');
      assert.ok(details.children[1].matches('div.ctm-reveal-body'), page);
    }
    assert.equal(doc.querySelector('details.details summary em').textContent, 'title', 'the title is Markdown');
  }
  assert.doesNotMatch(r.stderr, /has no (nn|de|nb) text/);
}));

// B2: Pandoc's sections would swallow a raw </details>; the inner Div keeps a
// heading's section inside the block and what follows it in place.
test('a heading inside a reveal stays inside it, and what follows stays in main', {skip}, () => withProject({
  'page.qmd': front('lang: nb\n') + '## Section\n\nBefore.\n\n::: {.reading-step title="Gå i dybden: skaler"}\nDeep text.\n\n'
    + '#### Deep heading {#deep-head}\n\nMore deep.\n\n### Deeper still\n\nDeepest.\n:::\n\nAfter the block.\n\n## Next {#next}\n\nNext text.\n',
}, dir => {
  const r = C.render(dir);
  assert.equal(r.status, 0, r.stderr);
  const doc = documentOf(C.html(dir, 'page.qmd'));
  const details = doc.querySelector('details.reading-step');
  const body = details.querySelector(':scope > .ctm-reveal-body');
  assert.ok(body.querySelector('section#deep-head > h4'), 'the heading is inside the block');
  assert.ok(body.textContent.includes('Deepest.'));
  const after = [...doc.querySelectorAll('p')].find(p => p.textContent === 'After the block.');
  assert.ok(after && !details.contains(after), 'what follows is outside the block');
  assert.equal(after.parentElement.id, 'section', 'and in the block\'s own section');
  assert.equal(after.previousElementSibling, details);
  assert.ok(doc.querySelector('main section#next').textContent.includes('Next text.'), 'the next section is in main');
}));

test('titles: Pandoc reads backslash escapes in attributes, so TeX takes doubled backslashes', {skip}, () => withProject({
  'page.qmd': front() + '::: {.hint title="Bruk $\\\\mathbf{A}\\\\,x$"}\nDoubled.\n:::\n\n::: {.hint title="Bruk $\\mathbf{A}\\,x$"}\nSingle.\n:::\n',
}, dir => {
  const r = C.render(dir);
  assert.equal(r.status, 0, r.stderr);
  const html = C.html(dir, 'page.qmd');
  const [doubled, single] = [...html.matchAll(/<summary>\n([\s\S]*?)\n<\/summary>/g)].map(m => m[1]);
  assert.equal(doubled, 'Bruk <span class="math inline">\\(\\mathbf{A}\\,x\\)</span>');
  assert.equal(single, 'Bruk <span class="math inline">\\(\\mathbf{A},x\\)</span>', 'a single backslash before , is Pandoc\'s escape');
}));

test('.solution: Quarto\'s Solution becomes a reveal; name= and a leading heading name it; other formats keep Quarto\'s', {skip}, () => withProject({
  'page.qmd': front('lang: nb\n') + '::: {.solution #sol-a}\nPlain.\n:::\n\n::: {.solution name="Eget *navn*"}\nNamed.\n:::\n\n'
    + '::: {.solution title="Med tittel" .extra data-x="1"}\nTitled.\n:::\n\n::: {.solution}\n### Steg 1\n\nFirst step.\n:::\n\n'
    + '::: {.proof}\nA proof stays a proof.\n:::\n',
  'both.qmd': front() + 'Intro.\n\n::: {.solution title="T"}\n### H\n\nText.\n:::\n',
}, dir => {
  let r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
  const doc = documentOf(C.html(dir, 'page.qmd'));
  assert.deepEqual(summaries(doc), [['ctm-reveal solution', 'Løsningsforslag'], ['ctm-reveal solution', 'Eget navn'],
    ['ctm-reveal solution extra', 'Med tittel'], ['ctm-reveal solution', 'Steg 1']]);
  assert.equal(doc.querySelector('details.solution').id, 'sol-a');
  assert.equal(doc.querySelector('details.extra').getAttribute('data-x'), '1');
  assert.ok(doc.querySelector('.proof'), 'other proof kinds are Quarto\'s');
  assert.doesNotMatch(doc.body.innerHTML, /Solution\./);
  r = C.render(dir, ['page.qmd', '--to', 'latex']);
  assert.equal(r.status, 0, r.stderr);
  const tex = fs.readFileSync(path.join(dir, 'page.tex'), 'utf8');
  assert.match(tex, /\\begin\{solution\}\s*\\phantomsection\\label\{sol-a\}|\\begin\{solution\}/);
  assert.match(tex, /\\begin\{solution\}\[Eget \\emph\{navn\}\]/);
  r = C.render(dir, ['both.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /A \.solution block has both title= and a name \(name="…", or a heading as its first block, which Quarto takes as the name\): use one \(both\.qmd:7\)\./);
}));

test('other formats show reveals open: the title in bold, then the content', {skip}, () => withProject({
  'page.qmd': front('lang: en\n') + '::: {.reading-step #deep}\nStep.\n:::\n\n::: {.details title="Look *up*"}\nDetails.\n:::\n\n'
    + '::: {.embed src="assets/a.html" title="An experiment"}\n:::\n\n::: {.modes}\n:::\n',
}, dir => {
  const r = C.render(dir, ['page.qmd', '--to', 'latex']);
  assert.equal(r.status, 0, r.stderr);
  const tex = fs.readFileSync(path.join(dir, 'page.tex'), 'utf8');
  assert.match(tex, /\\label\{deep\}\s*\\textbf\{Go deeper\}\s*Step\./);
  assert.match(tex, /\\textbf\{Look \\emph\{up\}\}\s*Details\./);
  assert.match(tex, /\\href\{assets\/a\.html\}\{An experiment\}/);
  assert.doesNotMatch(tex, /ctm-modes|Explore/);
}));

test('.details needs a title: the error names the file and line, also in an included file', {skip}, () => withProject({
  'page.qmd': front() + 'Intro.\n\n{{< include _parts/part.md >}}\n',
  '_parts/part.md': 'Part.\n\n::: {.details}\nNo title.\n:::\n\n```markdown\n::: {.details}\n```\n',
}, dir => {
  const r = C.render(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /A \.details block needs a title: ::: \{\.details title="…"\} \(_parts\/part\.md:3\)\./);
}));

test('a reveal in a list item, in a tab and in a callout', {skip}, () => withProject({
  'page.qmd': front('lang: en\n') + '- Item\n\n  ::: {.hint title="Item hint"}\n  In the item.\n  :::\n\n'
    + '::: {.panel-tabset}\n## A\n\n::: {.solution}\nIn a tab.\n:::\n\n## B\n\nB.\n:::\n\n::: {.callout-note}\n## Note\n\n::: {.reading-step}\nIn a callout.\n:::\n:::\n',
}, dir => {
  const r = C.render(dir);
  assert.equal(r.status, 0, r.stderr);
  const doc = documentOf(C.html(dir, 'page.qmd'));
  const item = doc.querySelector('li details.hint');
  assert.ok(item, 'in the list item');
  assert.equal(item.querySelector('summary').innerHTML.trim(), 'Item hint', 'a plain summary, no paragraph');
  assert.ok(doc.querySelector('.tab-pane details.solution'));
  assert.ok(doc.querySelector('.callout details.reading-step'));
}));

test('.embed: a lazy iframe with its title; src and title are required, the height is a length', {skip}, () => withProject({
  'page.qmd': front() + '::: {.embed src="assets/svd.html" title="Interaktivt SVD-forsøk" height="920px" #svd allow="fullscreen"}\n:::\n\n'
    + '::: {.embed src="b.html" title="B"}\n[Open it](b.html)\n:::\n',
  'notitle.qmd': front() + 'Text.\n\n::: {.embed src="a.html"}\n:::\n',
  'nosrc.qmd': front() + '::: {.embed title="A"}\n:::\n',
  'height.qmd': front() + '::: {.embed src="a.html" title="A" height="tall"}\n:::\n',
}, dir => {
  let r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
  const html = C.html(dir, 'page.qmd');
  assert.ok(html.includes('<iframe id="svd" class="ctm-embed" src="assets/svd.html" title="Interaktivt SVD-forsøk" loading="lazy" style="height:920px" allow="fullscreen"></iframe>'), html);
  assert.ok(html.includes('<iframe class="ctm-embed" src="b.html" title="B" loading="lazy" style="height:600px"></iframe>\n<p><a href="b.html">Open it</a></p>'));
  assert.deepEqual(dependencies(html), ['ctm-ui'], 'the stylesheet only');
  r = C.render(dir, ['notitle.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /An \.embed block needs title=: ::: \{\.embed src="…" title="…" height="…"\} \(notitle\.qmd:7\)\. The title names the embedded page for screen readers\./);
  r = C.render(dir, ['nosrc.qmd']);
  assert.match(r.stderr, /An \.embed block needs src=: .* \(nosrc\.qmd:5\)\./);
  r = C.render(dir, ['height.qmd']);
  assert.match(r.stderr, /\.embed: height must be a length such as "920px", "40rem" or "80vh" \(found tall in height\.qmd:5\)\./);
}));

const SWITCH_NB = '<div class="ctm-modes" role="group" aria-label="Velg lesemodus" hidden="">\n'
  + '<button type="button" data-mode="lecture" aria-pressed="true">Forelesning</button>\n'
  + '<button type="button" data-mode="reading" aria-pressed="false">Gå i dybden</button>\n'
  + '<span class="ctm-modes-status" data-lecture="Forelesning: eksperimenter og diskusjon. Åpne utdypningene ved behov." '
  + 'data-reading="Gå i dybden: prøv selv, og følg forklaringene steg for steg."></span>\n</div>';

test('the lecture/reading switch: at the top of pages with reading steps, where ::: {.modes} puts it, never with modes: false', {skip}, () => withProject({
  'auto.qmd': front('lang: nb\n') + 'Intro.\n\n::: {.panel-tabset}\n## A\n\n::: {.reading-step}\nStep.\n:::\n\n## B\n\nB.\n:::\n',
  'marker.qmd': front('lang: en\n') + 'Explore a direction.\n\nUse the tabs.\n\n::: {.modes #switch}\n:::\n\n::: {.reading-step}\nStep.\n:::\n',
  'off.qmd': front('lang: nb\nctm-assessment:\n  modes: false\n') + '::: {.modes}\n:::\n\n::: {.reading-step}\nStep.\n:::\n',
  'none.qmd': front('lang: nb\n') + '::: {.modes}\n:::\n\n::: {.hint}\nNo reading step.\n:::\n',
  'nn.qmd': front('lang: nn\n') + '::: {.reading-step}\nStep.\n:::\n',
  'de.qmd': front('lang: de\n') + '::: {.reading-step}\nStep.\n:::\n',
}, dir => {
  const r = C.render(dir);
  assert.equal(r.status, 0, r.stderr);
  let html = C.html(dir, 'auto.qmd');
  assert.equal(html.split('class="ctm-modes"').length, 2, 'one switch');
  assert.ok(html.includes(SWITCH_NB), 'Bokmål labels and today\'s status texts; hidden; no live region yet');
  assert.ok(html.indexOf(SWITCH_NB) < html.indexOf('<p>Intro.</p>'), 'at the top of the body');
  let doc = documentOf(html);
  assert.equal(doc.querySelector('.ctm-modes-status').getAttribute('role'), null);
  assert.deepEqual(dependencies(html), ['ctm-ui', 'ctm-reveal', 'ctm-nav']);
  html = C.html(dir, 'marker.qmd');
  doc = documentOf(html);
  const modes = doc.querySelector('.ctm-modes');
  assert.equal(modes.id, 'switch');
  assert.equal(modes.previousElementSibling.textContent, 'Use the tabs.', 'where the marker is');
  assert.deepEqual([...modes.querySelectorAll('button')].map(b => b.textContent), ['Explore', 'Go deeper']);
  assert.equal(modes.getAttribute('aria-label'), 'Choose reading mode');
  const status = modes.querySelector('.ctm-modes-status');
  assert.equal(status.dataset.lecture, 'Explore: experiment and discuss. Open explanations when needed.');
  assert.equal(status.dataset.reading, 'Go deeper: try it yourself, then follow the explanations step by step.');
  assert.doesNotMatch(C.html(dir, 'off.qmd'), /ctm-modes/, 'modes: false: no switch, the marker is gone');
  assert.doesNotMatch(C.html(dir, 'none.qmd'), /ctm-modes/);
  assert.match(r.stderr, /::: \{\.modes\} on none\.qmd, which has no \.reading-step blocks: there is no switch to place\./);
  assert.equal(r.stderr.match(/there is no switch to place/g).length, 1, 'not for modes: false');
  doc = documentOf(C.html(dir, 'nn.qmd'));
  assert.deepEqual([...doc.querySelectorAll('.ctm-modes button')].map(b => b.textContent), ['Førelesing', 'Gå i djupna']);
  assert.equal(doc.querySelector('.ctm-modes').getAttribute('aria-label'), 'Vel lesemodus');
  doc = documentOf(C.html(dir, 'de.qmd'));
  assert.deepEqual([...doc.querySelectorAll('.ctm-modes button')].map(b => b.textContent), ['Vortrag', 'Vertiefung']);
}));

test('the switch: one marker per page, and it takes no content', {skip}, () => withProject({
  'two.qmd': front() + '::: {.modes}\n:::\n\n::: {.modes}\n:::\n\n::: {.reading-step}\nStep.\n:::\n',
  'content.qmd': front() + '::: {.modes}\nText.\n:::\n',
}, dir => {
  let r = C.render(dir, ['two.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /A page has one ::: \{\.modes\} marker at most \(two\.qmd:5, two\.qmd:8\)\./);
  r = C.render(dir, ['content.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /::: \{\.modes\} marks where the lecture\/reading switch goes and takes no content \(content\.qmd:5\)\./);
}));

// Today's pages (raw HTML, no tabsets) render as before; tab links come with
// tabsets unless tab-links: false; the rest only where it is used.
const OLD = '<div class="learning-mode" data-learning-mode role="group" aria-label="Velg lesemodus">\n'
  + '<button type="button" data-mode="lecture" aria-pressed="true">Forelesning</button>\n'
  + '<button type="button" data-mode="reading" aria-pressed="false">Gå i dybden</button>\n'
  + '<span role="status" aria-live="polite"></span>\n</div>\n\n<div id="anchor"></div>\n\n'
  + '<details class="reading-step">\n<summary>Gå i dybden: noe</summary>\n\nInner text.\n\n</details>\n\n'
  + '<iframe src="a.html" title="A" loading="lazy" style="width:100%;height:920px;"></iframe>\n';

test('dependencies: pages without the new syntax are unchanged; tab links come with tabsets (tab-links: false turns them off)', {skip}, () => withProject({
  'old.qmd': front('lang: nb\n') + OLD,
  'tabs.qmd': front() + '::: {.panel-tabset}\n## A\n\nA.\n\n## B\n\nB.\n:::\n',
  'tabs-off.qmd': front('ctm-assessment:\n  tab-links: false\n') + '::: {.panel-tabset}\n## A\n\nA.\n\n## B\n\nB.\n:::\n',
  'reveal-off.qmd': front('ctm-assessment:\n  tab-links: false\n') + '::: {.hint}\nHint.\n:::\n',
  'plain.qmd': front() + 'Plain text.\n',
}, dir => {
  const r = C.render(dir);
  assert.equal(r.status, 0, r.stderr);
  const old = C.html(dir, 'old.qmd');
  assert.deepEqual(dependencies(old), []);
  assert.ok(old.includes('<details class="reading-step">') && old.includes('<div class="learning-mode" data-learning-mode'), 'raw HTML passes through');
  assert.doesNotMatch(old, /ctm-reveal|ctm-modes|ctm-embed/);
  assert.deepEqual(dependencies(C.html(dir, 'tabs.qmd')), ['ctm-ui', 'ctm-nav']);
  assert.deepEqual(dependencies(C.html(dir, 'tabs-off.qmd')), []);
  assert.deepEqual(dependencies(C.html(dir, 'reveal-off.qmd')), ['ctm-ui', 'ctm-reveal']);
  assert.deepEqual(dependencies(C.html(dir, 'plain.qmd')), []);
  assert.deepEqual(warnings(r.stderr), [], 'no warnings without markdown-lint');
}));

test('ctm-assessment: tab-links, modes and markdown-lint take true or false', {skip}, () => withProject({
  'page.qmd': front('ctm-assessment:\n  modes: maybe\n') + 'Text.\n',
}, dir => {
  const r = C.render(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ctm-assessment: modes must be true or false \(found maybe in page\.qmd\)/);
}, 'ctm-assessment:\n  tab-links: "false"\n'));
