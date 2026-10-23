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
  w.eval(script('ctm-layout.js'));
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

// While an entry still shows its link's target, a reload handles the link
// again: coi-serviceworker reloads a first visit (cross-origin isolation where
// the host sends no COOP/COEP headers). Once the reader has moved, a reload
// restores the position.
test('ctm-nav: a reload of an entry that still shows its link\'s target handles the link again', async () => {
  // jsdom lays nothing out: here every element has a box. (Its frames come
  // late: a navigation takes some 300 ms.)
  const boxes = w => { w.Element.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; }; };
  let w = loadNav('#deep', boxes);
  await shown(w);
  await wait(600);
  assert.deepEqual(active(w), ['t2', 'i2']);
  assert.equal(w.document.getElementById('deep').getAttribute('data-ctm-nav'), 'load');
  w.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'F5'}));
  w.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'r', ctrlKey: true}));
  w.dispatchEvent(new w.Event('pagehide'));
  const saved = w.history.state.__quartoTabPosition;
  assert.equal(saved.at, '#deep', 'the entry shows its target (reload keys aside)');
  assert.deepEqual([...saved.panes], ['t2', 'i2']);
  w.dispatchEvent(new w.Event('wheel'));
  w.dispatchEvent(new w.Event('pagehide'));
  assert.equal(w.history.state.__quartoTabPosition.at, undefined, 'not once the reader has moved');
  w.close();
  // The reload: the link's target again, not the saved tabs.
  const at = (panes, hash) => ({__quartoTabPosition: {x: 0, y: 0, panes, at: hash}});
  w = loadNav('#deep', w => { boxes(w); w.history.replaceState(at(['t2', 'i1'], '#deep'), '', w.location.href); });
  await shown(w);
  await wait(600);
  assert.deepEqual(active(w), ['t2', 'i2'], 'the link\'s target');
  assert.equal(w.document.getElementById('closed').open, true);
  assert.equal(w.document.getElementById('deep').getAttribute('data-ctm-nav'), 'load');
  w.close();
  // Another hash's target, or none: the position.
  for (const hash of ['#other', undefined]) {
    w = loadNav('#deep', w => { boxes(w); w.history.replaceState(at(['t2', 'i1'], hash), '', w.location.href); });
    await shown(w);
    await wait(600);
    assert.deepEqual(active(w), ['t2', 'i1'], 'the saved tabs (' + hash + ')');
    assert.equal(w.document.getElementById('deep').hasAttribute('data-ctm-nav'), false);
    w.close();
  }
});

// Collapsible Quarto callouts: the content is a `.callout-collapse.collapse`
// (`show` once open) and the header toggles it (aria-expanded, `collapsed`).
// One outer callout holds a tabset whose second tab holds a reading step that
// holds an inner callout; a hint holds a callout's section the other way round.
const callout = (id, inner, {open = false, kind = 'note'} = {}) => '<div id="' + id + '" class="callout callout-style-default callout-' + kind + ' callout-titled">'
  + '<div class="callout-header d-flex align-content-center' + (open ? '' : ' collapsed') + '" data-bs-toggle="collapse" data-bs-target=".' + id + '-contents" aria-controls="' + id + '-body" aria-expanded="' + open + '">'
  + '<div class="callout-title-container flex-fill">Boks</div><div class="callout-btn-toggle"><i class="callout-toggle"></i></div></div>'
  + '<div id="' + id + '-body" class="' + id + '-contents callout-collapse collapse' + (open ? ' show' : '') + '"><div class="callout-body-container callout-body">' + inner + '</div></div></div>';
const CALLOUTS = '<header id="quarto-header"></header><main>'
  + callout('c-plain', '<section id="in-plain"><h4>Plain</h4></section>')
  + callout('c-open', '<section id="in-open"><h4>Open</h4></section>', {open: true})
  + callout('c-outer', '<div class="panel-tabset"><ul class="nav nav-tabs" role="tablist">'
    + '<li><a class="nav-link active" id="k1-tab" role="tab" aria-selected="true" href="">A</a></li>'
    + '<li><a class="nav-link" id="k2-tab" role="tab" aria-selected="false" href="">B</a></li></ul>'
    + '<div class="tab-content"><div id="k1" class="tab-pane active" role="tabpanel" aria-labelledby="k1-tab">A.</div>'
    + '<div id="k2" class="tab-pane" role="tabpanel" aria-labelledby="k2-tab">' + step('reading', callout('c-inner', '<section id="in-all"><h4>All</h4></section>', {kind: 'tip'}))
    + '</div></div></div>')
  + callout('c-hinted', '<details class="ctm-reveal hint" id="hinted"><summary>Hint</summary><div class="ctm-reveal-body"><section id="in-hint"><h4>Hint</h4></section></div></details>')
  + '<div class="callout callout-style-default callout-note"><div class="callout-body-container"><section id="in-simple"><h4>Simple</h4></section></div></div></main>';
const shownCallouts = w => [...w.document.querySelectorAll('.callout-collapse')].filter(c => c.classList.contains('show')).map(c => c.id.replace(/-body$/, '')).sort();
const headerOf = (w, id) => w.document.getElementById(id).querySelector(':scope > .callout-header');
// jsdom lays nothing out: an element has a box unless an inactive tab or a
// closed callout hides it. (Its frames come late: a navigation takes some 300 ms.)
const layout = w => {
  w.Element.prototype.getClientRects = function () {
    for (let node = this; node; node = node.parentElement) {
      if (node.classList.contains('tab-pane') && !node.classList.contains('active')) return [];
      if (node.classList.contains('callout-collapse') && !node.classList.contains('show')) return [];
    }
    return [this.getBoundingClientRect()];
  };
};
function loadCallouts(hash, before) {
  const w = new JSDOM('<!doctype html><html><head></head><body>' + CALLOUTS + '</body></html>', {url: 'https://example.invalid/c/p.html' + hash, runScripts: 'outside-only', pretendToBeVisual: true}).window;
  w.scrollTo = () => {};
  layout(w);
  if (before) before(w);
  w.eval(script('ctm-nav.js'));
  return w;
}

// Bootstrap's transition contract: show/hide are ignored while transitioning;
// collapse/show are absent during either transition; transitionend completes
// it once, clears its state/size, and emits the matching bubbling event.
// `stalled` omits the usual transition-end emulation so ctm-nav's watchdog
// must complete the same queued callback, rather than only change classes.
function collapseBootstrap(w, {stalled = false, log = []} = {}) {
  const instances = new WeakMap();
  const Collapse = {getOrCreateInstance(body) {
    if (instances.has(body)) return instances.get(body);
    let transitioning = false;
    const dimension = body.classList.contains('collapse-horizontal') ? 'width' : 'height';
    function transition(open) {
      if (transitioning || body.classList.contains('show') === open) return;
      log.push((open ? 'show ' : 'hide ') + body.id);
      transitioning = true;
      body.classList.remove('collapse', 'show');
      body.classList.add('collapsing');
      body.style[dimension] = open ? '120px' : '';
      const header = body.parentElement.querySelector(':scope > .callout-header');
      header.classList.toggle('collapsed', !open);
      header.setAttribute('aria-expanded', String(open));
      let timer;
      const complete = event => {
        if (event.target !== body) return;
        body.removeEventListener('transitionend', complete);
        w.clearTimeout(timer);
        transitioning = false;
        body.classList.remove('collapsing');
        body.classList.add('collapse');
        body.classList.toggle('show', open);
        body.style[dimension] = '';
        log.push((open ? 'shown ' : 'hidden ') + body.id);
        body.dispatchEvent(new w.Event((open ? 'shown' : 'hidden') + '.bs.collapse', {bubbles: true}));
      };
      body.addEventListener('transitionend', complete);
      if (!stalled) timer = w.setTimeout(() => body.dispatchEvent(new w.Event('transitionend')), 200);
    }
    const instance = {show() { transition(true); }, hide() { transition(false); }};
    instances.set(body, instance);
    return instance;
  }};
  w.bootstrap = {Collapse};
  return Collapse;
}

function assertCalloutOpen(w, id) {
  const body = w.document.getElementById(id + '-body');
  assert.equal(body.classList.contains('collapse'), true);
  assert.equal(body.classList.contains('show'), true);
  assert.equal(body.classList.contains('collapsing'), false);
  assert.equal(body.style[body.classList.contains('collapse-horizontal') ? 'width' : 'height'], '');
  assert.equal(headerOf(w, id).getAttribute('aria-expanded'), 'true');
  assert.equal(headerOf(w, id).classList.contains('collapsed'), false);
}

test('ctm-nav: a link during a callout hide waits for hidden, then opens it through Bootstrap', async () => {
  const log = [], w = loadCallouts('', w => collapseBootstrap(w, {log}));
  await shown(w);
  const body = w.document.getElementById('c-open-body');
  const instance = w.bootstrap.Collapse.getOrCreateInstance(body);
  instance.hide();
  assert.equal(body.classList.contains('collapsing'), true);
  await w.CTMNav.reveal(w.document.getElementById('in-open'));
  assertCalloutOpen(w, 'c-open');
  assert.deepEqual(log, ['hide c-open-body', 'hidden c-open-body', 'show c-open-body', 'shown c-open-body']);
  // The same public instance still works after navigation; no stale hide can
  // close the target and no transition-state flag was left stuck.
  await wait(80);
  assertCalloutOpen(w, 'c-open');
  instance.hide();
  await wait(250);
  assert.equal(body.classList.contains('show'), false);
  instance.show();
  await wait(250);
  assertCalloutOpen(w, 'c-open');
  w.close();
});

test('ctm-nav: a link during a callout show waits for its completion', async () => {
  const log = [], w = loadCallouts('', w => collapseBootstrap(w, {log}));
  await shown(w);
  const body = w.document.getElementById('c-plain-body');
  w.bootstrap.Collapse.getOrCreateInstance(body).show();
  await w.CTMNav.reveal(w.document.getElementById('in-plain'));
  assertCalloutOpen(w, 'c-plain');
  assert.deepEqual(log, ['show c-plain-body', 'shown c-plain-body']);
  w.close();
});

test('ctm-nav: the watchdog completes Bootstrap opening and closing transitions, including horizontal sizes', async () => {
  for (const hiding of [false, true]) {
    const log = [], w = loadCallouts('', w => collapseBootstrap(w, {stalled: true, log}));
    await shown(w);
    const id = hiding ? 'c-open' : 'c-plain', target = hiding ? 'in-open' : 'in-plain';
    const body = w.document.getElementById(id + '-body');
    body.classList.add('collapse-horizontal');
    const instance = w.bootstrap.Collapse.getOrCreateInstance(body);
    if (hiding) instance.hide();
    const pending = w.CTMNav.reveal(w.document.getElementById(target));
    await wait(200);
    assert.equal(body.classList.contains('collapsing'), true, 'still waiting for Bootstrap');
    await pending;
    assertCalloutOpen(w, id);
    assert.deepEqual(log, hiding
      ? ['hide c-open-body', 'hidden c-open-body', 'show c-open-body', 'shown c-open-body']
      : ['show c-plain-body', 'shown c-plain-body']);
    // Completing through Bootstrap releases its instance too. A subsequent
    // hide and show must run and normalize their own size/classes.
    instance.hide();
    assert.equal(body.classList.contains('collapsing'), true);
    body.dispatchEvent(new w.Event('transitionend'));
    assert.equal(body.classList.contains('show'), false);
    instance.show();
    body.dispatchEvent(new w.Event('transitionend'));
    assertCalloutOpen(w, id);
    await wait(80);
    assertCalloutOpen(w, id);
    w.close();
  }
});

test('ctm-nav: a link opens every collapsed callout around its target, in any nesting, and sets its header', async () => {
  let w = loadCallouts('#in-plain');
  await shown(w);
  await wait(600);
  assert.deepEqual(shownCallouts(w), ['c-open', 'c-plain'], 'only the one around the target (the open one stays)');
  assert.equal(headerOf(w, 'c-plain').getAttribute('aria-expanded'), 'true');
  assert.equal(headerOf(w, 'c-plain').classList.contains('collapsed'), false);
  assert.equal(headerOf(w, 'c-hinted').getAttribute('aria-expanded'), 'false', 'the others are left alone');
  assert.equal(w.document.getElementById('in-plain').getAttribute('data-ctm-nav'), 'load');
  w.close();
  // A callout inside a reveal inside a tab inside a callout: all of them, in turn.
  w = loadCallouts('#in-all');
  await shown(w);
  await wait(600);
  assert.deepEqual(shownCallouts(w), ['c-inner', 'c-open', 'c-outer']);
  assert.deepEqual(active(w), ['k2']);
  assert.equal(w.document.getElementById('reading').open, true);
  for (const id of ['c-outer', 'c-inner']) assert.equal(headerOf(w, id).getAttribute('aria-expanded'), 'true', id);
  w.close();
  // A reveal inside a callout.
  w = loadCallouts('#in-hint');
  await shown(w);
  await wait(600);
  assert.deepEqual(shownCallouts(w), ['c-hinted', 'c-open']);
  assert.equal(w.document.getElementById('hinted').open, true);
  w.close();
  // A link to the callout itself shows what it holds, as a link to a <details> does.
  w = loadCallouts('#c-plain');
  await shown(w);
  await wait(600);
  assert.deepEqual(shownCallouts(w), ['c-open', 'c-plain']);
  w.close();
  // A callout that cannot collapse, and one that is open, are no business of the script.
  for (const id of ['in-simple', 'in-open']) {
    w = loadCallouts('#' + id);
    await shown(w);
    await wait(600);
    assert.deepEqual(shownCallouts(w), ['c-open'], id);
    assert.equal(w.document.getElementById(id).getAttribute('data-ctm-nav'), 'load');
    w.close();
  }
});

test('ctm-nav: with Bootstrap a callout opens through Collapse, outer first, and the script waits for each', async () => {
  const log = [];
  const stub = w => {
    w.bootstrap = {Collapse: {getOrCreateInstance(element, config) {
      return {show() {
        log.push('show ' + element.id + (config && config.toggle === false ? '' : ' (toggles)'));
        // Bootstrap: a transition, then `show` and the event, which bubbles.
        setTimeout(() => {
          element.classList.add('show');
          const header = element.parentElement.querySelector(':scope > .callout-header');
          header.classList.remove('collapsed');
          header.setAttribute('aria-expanded', 'true');
          log.push('shown ' + element.id);
          element.dispatchEvent(new w.Event('shown.bs.collapse', {bubbles: true}));
        }, 40);
      }};
    }}};
  };
  const w = loadCallouts('#in-all', stub);
  await shown(w);
  await wait(900);
  assert.deepEqual(log, ['show c-outer-body', 'shown c-outer-body', 'show c-inner-body', 'shown c-inner-body'], 'the inner one starts when the outer one is shown');
  assert.deepEqual(shownCallouts(w), ['c-inner', 'c-open', 'c-outer']);
  assert.equal(w.document.getElementById('in-all').getAttribute('data-ctm-nav'), 'load');
  w.close();
});

test('ctm-nav: a callout that Bootstrap does not finish opening is marked open after 0.6 s', async () => {
  const w = loadCallouts('#in-plain', w => { w.bootstrap = {Collapse: {getOrCreateInstance() { return {show() {}}; }}}; });
  await shown(w);
  await wait(300);
  assert.deepEqual(shownCallouts(w), ['c-open'], 'still waiting');
  await wait(900);
  assert.deepEqual(shownCallouts(w), ['c-open', 'c-plain']);
  assert.equal(headerOf(w, 'c-plain').getAttribute('aria-expanded'), 'true');
  assert.equal(w.document.getElementById('in-plain').getAttribute('data-ctm-nav'), 'load');
  w.close();
});

test('ctm-nav: CTMNav.reveal opens the callouts around an element', async () => {
  const w = loadCallouts('');
  await shown(w);
  await w.CTMNav.reveal(w.document.getElementById('in-all'));
  assert.deepEqual(shownCallouts(w), ['c-inner', 'c-open', 'c-outer']);
  assert.equal(w.location.hash, '');
  w.close();
});

