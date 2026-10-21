// What markdown-lint and the reveals read, as an API for maintainer tools
// (ctm-assessment's migrate-course-html.py runs it through `quarto pandoc
// lua`, outside a render): ctm.source.read(lines), ctm.ui.rawHTML(lines) and
// ctm.ui.defaultTitle(kind, lang). The render's own lint and titles go through
// the same functions, so a tool and the render cannot read a course apart.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {spawnSync} = require('node:child_process');
const C = require('./helpers/ctm-libs.cjs');
const skip = C.hasQuarto ? false : 'Quarto required';

// Runs `body` (Lua, with `ctm` loaded as docs/api.md says for tools) with
// `quarto pandoc lua`; the files are written into a temporary folder, which is
// arg[2]. What the script prints as JSON comes back.
function outside(body, files = {}) {
  const dir = C.tempdir('ctm-api-');
  try {
    C.write(dir, files);
    const script = path.join(dir, 'api.lua');
    fs.writeFileSync(script, 'quarto = {json = pandoc.json}\n'
      + 'local ctm = dofile(pandoc.path.join({arg[1], "lua", "ctm.lua"}))\n'
      + 'local dir = arg[2]\n'
      + 'local function lines(name)\n'
      + '  local handle = assert(io.open(pandoc.path.join({dir, name}), "r"))\n'
      + '  local text = handle:read("*a"); handle:close()\n'
      + '  local found = {}\n'
      + '  for line in (text .. "\\n"):gmatch("([^\\n]*)\\n") do found[#found + 1] = line end\n'
      + '  return found\n'
      + 'end\n' + body + '\n');
    const r = spawnSync(C.quarto, ['pandoc', 'lua', script, C.library, dir], {encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

// [text, raw] for a Markdown line, false for the others.
const PRINT_READ = 'local out = {}\nfor i, line in ipairs(ctm.source.read(lines("page.md"))) do\n'
  + '  out[i] = line and {line.text, line.raw} or false\nend\nio.write(pandoc.json.encode(out))';

const PAGE = [
  '---', 'title: "<details>"', '---',                                      // 1-3 front matter
  'Text with `<iframe>` code and ``<details>`` too.',                     // 4
  '<!-- a comment -->', 'Before <!-- inside', '<details>', 'still --> after', // 5-8
  '', '```python', '<details>', '```',                                     // 9-12 fenced code
  '~~~~', '```', '~~~~',                                                   // 13-15 a longer fence
  '', '    <details>', '    code', '',                                     // 16-19 indented code
  '- item', '', '    <details><summary>In the list</summary>',             // 20-22 a list's paragraph
  '', '```{=html}', '<div id="x"></div> `kept`', '```',                    // 23-26 raw HTML
  'Last.',                                                                 // 27
].join('\n');

test('ctm.source.read: each line is Markdown text (without inline code and comments) and raw or not, else false', {skip}, () => {
  const read = outside(PRINT_READ, {'page.md': PAGE});
  assert.deepEqual(read, [
    false, false, false,
    ['Text with  code and  too.', false],
    ['', false], ['Before ', false], ['', false], [' after', false],
    ['', false], false, false, false,
    false, false, false,
    ['', false], false, false, false,
    ['- item', false], ['', false], ['    <details><summary>In the list</summary>', false],
    ['', false], false, ['<div id="x"></div> `kept`', true], false,
    ['Last.', false],
  ]);
});

test('ctm.source.scan visits the lines read() gives a text, in the page and the files it includes', {skip}, () => {
  const visits = outside('quarto.doc = {input_file = pandoc.path.join({dir, "pages", "p.qmd"})}\n'
    + 'quarto.project = {directory = dir}\n'
    + 'local out = {}\nctm.source.scan(function(text, file, number, raw) out[#out + 1] = {file.label, number, text, raw} end)\n'
    + 'local expected = {}\nfor _, file in ipairs(ctm.source.files()) do\n'
    + '  for number, line in ipairs(ctm.source.read(file.lines)) do\n'
    + '    if line and line.text:match("%S") then expected[#expected + 1] = {file.label, number, line.text, line.raw} end\n'
    + '  end\nend\nio.write(pandoc.json.encode({out, expected}))', {
    'pages/p.qmd': '---\ntitle: p\n---\n\nIntro <!-- note -->\n\n{{< include ../_inc/a.md >}}\n\n```\ncode\n```\n',
    '_inc/a.md': 'A `x`.\n\n    indented\n\n<!--\nhidden\n-->\nB.\n',
  });
  assert.deepEqual(visits[0], [
    ['pages/p.qmd', 5, 'Intro ', false], ['pages/p.qmd', 7, '{{< include ../_inc/a.md >}}', false],
    ['_inc/a.md', 1, 'A .', false], ['_inc/a.md', 8, 'B.', false],
  ]);
  assert.deepEqual(visits[1], visits[0]);
});

// The lint's examples (tests/ui-render.test.cjs) and the state of the
// <details> rule: a <summary> right after its <details> is the same block.
const LEGACY = [
  '<details class="reading-step">', '<summary>Gå i dybden</summary>',        // 1-2: one block
  '', 'Text.', '<summary>Alone</summary>',                                  // 5: a <summary> elsewhere
  '<DIV ID="Anchor"></div>', '<iframe src="a.html" title="A"></iframe> and <iframe src="b.html">', // 6-7: once per line
  '<div class="learning-mode" data-learning-mode>', '</div>',              // 8
  '<!-- <details> -->', 'Inline `<details>`.', '',                         // 10-12: not raw HTML
  '```{=html}', '<details><summary>Raw</summary>', '```',                  // 13-15: in raw HTML too
].join('\n');

test('ctm.ui.rawHTML: the raw HTML markdown-lint names, by rule and line', {skip}, () => {
  const found = outside('local out = {}\nfor _, hit in ipairs(ctm.ui.rawHTML(lines("page.md"))) do\n'
    + '  out[#out + 1] = {hit.rule, hit.line, hit.text, hit.raw}\nend\nio.write(pandoc.json.encode(out))', {'page.md': LEGACY});
  assert.deepEqual(found, [
    ['details', 1, '<details class="reading-step">', false],
    ['details', 5, '<summary>Alone</summary>', false],
    ['anchor', 6, '<DIV ID="Anchor"></div>', false],
    ['iframe', 7, '<iframe src="a.html" title="A"></iframe> and <iframe src="b.html">', false],
    ['switch', 8, '<div class="learning-mode" data-learning-mode>', false],
    ['details', 14, '<details><summary>Raw</summary>', true],
  ]);
});

test('markdown-lint names exactly the lines ctm.ui.rawHTML gives', {skip}, () => {
  const dir = C.tempdir('ctm-api-lint-');
  try {
    C.installPackage(dir); C.install(dir);
    C.write(dir, {
      '_quarto.yml': 'project:\n  type: default\n  render: [page.qmd]\nfilters: [ctm-libs]\nctm-assessment:\n  markdown-lint: true\n',
      'page.qmd': '---\ntitle: t\n---\n\n{{< include legacy.md >}}\n', 'legacy.md': LEGACY,
    });
    const r = C.render(dir);
    assert.equal(r.status, 0, r.stderr);
    const named = {};
    for (const line of r.stderr.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
      const rule = /markdown-lint: (?:raw HTML <(details|div|iframe)|a hand-written lecture\/reading (switch))/.exec(line);
      if (rule) named[{div: 'anchor'}[rule[1]] || rule[1] || rule[2]] = [...line.matchAll(/legacy\.md:(\d+)/g)].map(m => Number(m[1]));
    }
    const found = outside('local out = {}\nfor _, hit in ipairs(ctm.ui.rawHTML(lines("legacy.md"))) do\n'
      + '  out[hit.rule] = out[hit.rule] or {}\n  table.insert(out[hit.rule], hit.line)\nend\nio.write(pandoc.json.encode(out))', {'legacy.md': LEGACY});
    assert.deepEqual(named, found);
    assert.deepEqual(named.details, [1, 5, 14]);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('ctm.ui.defaultTitle: every reveal kind in every language of the ui catalogue', {skip}, () => {
  const titles = outside('local out = {}\nfor _, kind in ipairs({"reading-step", "hint", "solution", "details"}) do\n'
    + '  out[kind] = {}\n  for _, lang in ipairs(ctm.locale.supported("ui")) do out[kind][lang] = ctm.ui.defaultTitle(kind, lang) end\nend\n'
    + 'local ok, message = pcall(ctm.ui.defaultTitle, "summary", "en")\n'
    + 'io.write(pandoc.json.encode({titles = out, unknown = message, fr = ctm.ui.defaultTitle("solution", ctm.locale.language("ui", "fr"))}))');
  const text = fs.readFileSync(path.join(C.library, 'locales', 'ui.js'), 'utf8');
  const catalogue = JSON.parse(text.slice(text.indexOf('/*BEGIN-JSON*/') + 14, text.indexOf('/*END-JSON*/')));
  const keys = {'reading-step': 'readingStep', hint: 'hint', solution: 'solution', details: 'details'};
  for (const [kind, key] of Object.entries(keys)) {
    assert.deepEqual(Object.keys(titles.titles[kind]).sort(), [...catalogue.$languages].sort(), kind);
    for (const lang of catalogue.$languages) assert.equal(titles.titles[kind][lang], catalogue[lang][key], kind + ' ' + lang);
  }
  assert.equal(titles.titles['reading-step'].nb, 'Gå i dybden');
  assert.equal(titles.fr, 'Solution', 'a language without a catalogue reads English, as the render does');
  assert.match(titles.unknown, /no reveal kind summary/);
});
