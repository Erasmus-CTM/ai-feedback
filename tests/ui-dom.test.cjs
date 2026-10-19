// The page's interface scripts in jsdom (ui/ctm-reveal.js, ui/ctm-nav.js):
// the switch, its storage per course, its announcements, one resize per
// frame, printing, and opening tabs and <details> for a link. Layout, scroll
// and focus are checked in real browsers (tests/browser/ui.mjs).
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

// Two tabsets, the inner one in the second tab; a <details> in the inner tab.
const TABS = '<header id="quarto-header"></header><main><p><a id="to-deep" href="#deep">to deep</a> <a id="to-tab" role="tab" href="">tab</a></p>'
  + '<div class="panel-tabset"><ul class="nav nav-tabs" role="tablist">'
  + '<li><a class="nav-link active" id="t1-tab" role="tab" aria-selected="true" href="">One</a></li>'
  + '<li><a class="nav-link" id="t2-tab" role="tab" aria-selected="false" href="">Two</a></li></ul>'
  + '<div class="tab-content"><div id="t1" class="tab-pane active" role="tabpanel" aria-labelledby="t1-tab">One.</div>'
  + '<div id="t2" class="tab-pane" role="tabpanel" aria-labelledby="t2-tab">'
  + '<div class="panel-tabset"><ul class="nav nav-tabs" role="tablist">'
  + '<li><a class="nav-link active" id="i1-tab" role="tab" aria-selected="true" href="">A</a></li>'
  + '<li><a class="nav-link" id="i2-tab" role="tab" aria-selected="false" href="">B</a></li></ul>'
  + '<div class="tab-content"><div id="i1" class="tab-pane active" role="tabpanel" aria-labelledby="i1-tab">A.</div>'
  + '<div id="i2" class="tab-pane" role="tabpanel" aria-labelledby="i2-tab">' + step('closed', '<section id="deep"><h4>Deep</h4></section>')
  + '</div></div></div></div></div></div></main>';
const active = w => [...w.document.querySelectorAll('.tab-pane.active')].map(p => p.id);

test('ctm-nav: a link in the page opens every enclosing tab and <details>, with pushState', async () => {
  const w = new JSDOM('<!doctype html><html><head></head><body>' + TABS + '</body></html>', {url: 'https://example.invalid/c/p.html', runScripts: 'outside-only', pretendToBeVisual: true}).window;
  w.scrollTo = () => {};
  w.eval(script('ctm-nav.js'));
  await new Promise(resolve => w.addEventListener('load', resolve));
  await wait(50);
  assert.equal(typeof w.CTMNav.reveal, 'function');
  const pushed = [];
  const push = w.history.pushState.bind(w.history);
  w.history.pushState = (state, title, url) => { pushed.push(url); return push(state, title, url); };
  let hashchanges = 0;
  w.addEventListener('hashchange', () => hashchanges++);
  w.document.getElementById('to-deep').dispatchEvent(new w.MouseEvent('click', {bubbles: true, cancelable: true, button: 0}));
  await wait(150);
  assert.deepEqual(pushed, ['#deep']);
  assert.equal(w.location.hash, '#deep');
  assert.equal(hashchanges, 0, 'handled by the script, not by navigation');
  assert.deepEqual(active(w), ['t2', 'i2']);
  assert.equal(w.document.getElementById('t2-tab').getAttribute('aria-selected'), 'true');
  assert.equal(w.document.getElementById('t1-tab').classList.contains('active'), false);
  assert.equal(w.document.getElementById('closed').open, true);
  assert.deepEqual([...w.history.state.__quartoTabPosition.panes], ['t2', 'i2'], 'the entry keeps its open tabs');
  // Tab buttons are Bootstrap's: the script only records the position.
  const event = new w.MouseEvent('click', {bubbles: true, cancelable: true, button: 0});
  w.document.getElementById('to-tab').dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  w.close();
});

test('ctm-nav: CTMNav.reveal opens an element\'s tabs without changing the address', async () => {
  const w = new JSDOM('<!doctype html><html><head></head><body>' + TABS + '</body></html>', {url: 'https://example.invalid/c/p.html', runScripts: 'outside-only', pretendToBeVisual: true}).window;
  w.scrollTo = () => {};
  w.eval(script('ctm-nav.js'));
  await new Promise(resolve => w.addEventListener('load', resolve));
  await wait(50);
  await w.CTMNav.reveal(w.document.getElementById('deep'));
  assert.deepEqual(active(w), ['t2', 'i2']);
  assert.equal(w.location.hash, '');
  w.close();
});

// Review B1: what a load restores is the position the history entry had
// when the page was loaded, not one saved while the page was still loading
// (the browser's jump to the fragment scrolls, and scrolling saves).
function loadNav(hash, before) {
  const w = new JSDOM('<!doctype html><html><head></head><body>' + TABS + '</body></html>', {url: 'https://example.invalid/c/p.html' + hash, runScripts: 'outside-only', pretendToBeVisual: true}).window;
  w.scrollTo = () => {};
  if (before) before(w);
  w.eval(script('ctm-nav.js'));
  return w;
}
const position = panes => ({__quartoTabPosition: {x: 0, y: 0, panes}});
// The page's load, then its pageshow (dispatched here: jsdom does not always
// send one), as a browser shows a page.
async function shown(w) {
  if (w.document.readyState !== 'complete') {
    await new Promise(resolve => { w.addEventListener('load', resolve); setTimeout(resolve, 3000); });
  }
  w.dispatchEvent(new w.PageTransitionEvent('pageshow', {persisted: false}));
}

test('ctm-nav: a new visit goes to the link\'s target, even when a position was saved while the page loaded', async () => {
  const w = loadNav('#deep');
  // Scrolling while the page loads saves nothing; a position written by
  // anything else before pageshow is not this visit's either.
  w.dispatchEvent(new w.Event('scroll'));
  w.history.replaceState(position(['t1', 'i1']), '', w.location.href);
  await shown(w);
  await wait(200);
  assert.deepEqual(active(w), ['t2', 'i2'], 'the target\'s tabs');
  assert.equal(w.document.getElementById('closed').open, true);
  w.close();
});

test('ctm-nav: a reload or Back/Forward restores the position the entry had', async () => {
  const w = loadNav('#deep', w => w.history.replaceState(position(['t2', 'i1']), '', w.location.href));
  await shown(w);
  await wait(200);
  assert.deepEqual(active(w), ['t2', 'i1'], 'the saved tabs, not the target\'s');
  assert.equal(w.document.getElementById('closed').open, false);
  w.close();
});
