// The reveals' script in jsdom (ui/ctm-reveal.js): the switch, its storage
// per course, its announcements, one resize per frame, printing, and
// opening <details> for a link.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {JSDOM} = require('jsdom');
const C = require('./helpers/ctm-libs.cjs');

const script = name => fs.readFileSync(path.join(C.library, 'ui', name), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const SWITCH = '<div class="ctm-modes" role="group" aria-label="Velg lesemodus" hidden>'
  + '<button type="button" data-mode="lecture" aria-pressed="true">Forelesning</button>'
  + '<button type="button" data-mode="reading" aria-pressed="false">Gå i dybden</button>'
  + '<span class="ctm-modes-status" data-lecture="Forelesning: eksperimenter og diskusjon. Åpne utdypningene ved behov." '
  + 'data-reading="Gå i dybden: prøv selv, og følg forklaringene steg for steg."></span></div>';
const step = (id, inner = 'Step.') => '<details class="ctm-reveal reading-step"' + (id ? ' id="' + id + '"' : '') + '><summary>Gå i dybden</summary><div class="ctm-reveal-body">' + inner + '</div></details>';
const BODY = SWITCH + step('one') + step('two', '<h4 id="deep">Deep</h4>') + '<details class="ctm-reveal hint" id="hint"><summary>Hint</summary><div class="ctm-reveal-body">H</div></details>';

// A page of a website (quarto:offset) or a single file; `session` seeds
// sessionStorage. Resolves once the page's DOMContentLoaded has run.
async function load(body, {url = 'https://example.invalid/course/pages/a.html', offset = '../', session = {}, before} = {}) {
  const head = offset === null ? '' : '<meta name="quarto:offset" content="' + offset + '">';
  const dom = new JSDOM('<!doctype html><html><head>' + head + '</head><body>' + body + '</body></html>', {url, runScripts: 'outside-only', pretendToBeVisual: true});
  const w = dom.window;
  for (const [key, value] of Object.entries(session)) w.sessionStorage.setItem(key, value);
  if (before) before(w);
  w.eval(script('ctm-reveal.js'));
  if (w.document.readyState === 'loading') await new Promise(resolve => w.document.addEventListener('DOMContentLoaded', resolve));
  await wait(0);
  return w;
}
const session = w => Object.fromEntries(Array.from({length: w.sessionStorage.length}, (_, i) => [w.sessionStorage.key(i), w.sessionStorage.getItem(w.sessionStorage.key(i))]));
const opened = w => [...w.document.querySelectorAll('details')].filter(d => d.open).map(d => d.id);

test('the switch: shown by the script, lecture first, reading opens every reading step and not the others', async () => {
  const w = await load(BODY);
  const group = w.document.querySelector('.ctm-modes');
  assert.equal(group.hidden, false);
  assert.equal(w.CTMReveal.mode(), 'lecture');
  assert.deepEqual(opened(w), []);
  const [lecture, reading] = group.querySelectorAll('button');
  reading.click();
  assert.deepEqual(opened(w), ['one', 'two']);
  assert.deepEqual([lecture.getAttribute('aria-pressed'), reading.getAttribute('aria-pressed')], ['false', 'true']);
  assert.equal(group.querySelector('.ctm-modes-status').textContent, 'Gå i dybden: prøv selv, og følg forklaringene steg for steg.');
  w.document.getElementById('hint').open = true;
  lecture.click();
  assert.deepEqual(opened(w), ['hint'], 'lecture closes the reading steps only');
  assert.equal(group.querySelector('.ctm-modes-status').textContent, 'Forelesning: eksperimenter og diskusjon. Åpne utdypningene ved behov.');
  w.close();
});

test('the status line: its first text comes before its live region, so loading announces nothing', async () => {
  const records = [];
  const w = await load(BODY, {before: w => {
    const status = w.document.querySelector('.ctm-modes-status');
    new w.MutationObserver(list => list.forEach(r => records.push(r.type === 'attributes' ? r.attributeName : 'text'))).observe(status, {attributes: true, childList: true});
  }});
  await wait(10);
  assert.deepEqual(records, ['text', 'role', 'aria-live']);
  const status = w.document.querySelector('.ctm-modes-status');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  w.close();
});

test('the mode lasts for the tab, per course: sessionStorage ctm|1|<course>|~mode', async () => {
  let w = await load(BODY);
  assert.deepEqual(session(w), {}, 'loading stores nothing');
  w.document.querySelector('button[data-mode="reading"]').click();
  const stored = session(w);
  assert.deepEqual(stored, {'ctm|1|%2Fcourse%2F|~mode': 'reading'});
  w.close();
  // Another page of the course (a reload, the next week) starts in reading mode.
  w = await load(BODY, {url: 'https://example.invalid/course/pages/b', session: stored});
  assert.equal(w.CTMReveal.mode(), 'reading');
  assert.deepEqual(opened(w), ['one', 'two']);
  w.close();
  // Another course on the same origin, and a single file (its folder), do not.
  w = await load(BODY, {url: 'https://example.invalid/other/index.html', offset: './', session: stored});
  assert.equal(w.CTMReveal.mode(), 'lecture');
  assert.equal(w.CTMReveal.course(), '/other/');
  w.close();
  w = await load(BODY, {url: 'https://example.invalid/course/pages/c.html', offset: null, session: stored});
  assert.equal(w.CTMReveal.course(), '/course/pages/');
  assert.equal(w.CTMReveal.mode(), 'lecture');
  w.close();
});

test('opening or closing reveals dispatches one resize per frame', async () => {
  const w = await load(BODY + step('three') + step('four'));
  await wait(60);
  let resizes = 0;
  w.addEventListener('resize', () => resizes++);
  w.document.querySelector('button[data-mode="reading"]').click();
  await wait(120);
  assert.equal(resizes, 1, 'four reading steps opened, one resize');
  w.document.querySelector('button[data-mode="lecture"]').click();
  await wait(120);
  assert.equal(resizes, 2);
  w.close();
});

test('printing opens the reading steps and restores them afterwards', async () => {
  const w = await load(BODY);
  w.document.getElementById('one').open = true;
  w.dispatchEvent(new w.Event('beforeprint'));
  assert.deepEqual(opened(w), ['one', 'two']);
  w.dispatchEvent(new w.Event('afterprint'));
  assert.deepEqual(opened(w), ['one']);
  w.close();
});

test('without ctm-nav, a link into closed <details> opens them; with it, ctm-nav does', async () => {
  let w = await load(BODY, {url: 'https://example.invalid/course/pages/a.html#deep'});
  assert.deepEqual(opened(w), ['two']);
  w.location.hash = '#hint';
  await wait(20);
  assert.deepEqual(opened(w), ['two', 'hint']);
  w.close();
  w = await load(BODY, {url: 'https://example.invalid/course/pages/a.html#deep', before: w => { w.CTMNav = {}; }});
  assert.deepEqual(opened(w), []);
  w.close();
});
