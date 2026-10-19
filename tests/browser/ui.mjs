// The page's interface in real browsers (Chromium, Firefox, WebKit): links
// into tabs and reveals (ui/ctm-nav.js), reveals and the lecture/reading
// switch (ui/ctm-reveal.js) on a rendered Quarto website. Chromium opens a
// closed <details> on fragment navigation by itself, so the checks also
// assert the script's path: a pushState for links in the page, and the
// data-ctm-nav mark on every target the script handled.
//
//   node tests/browser/ui.mjs [chromium] [firefox] [webkit]   (default: chromium)
//
// Needs Quarto, Playwright and coi-serviceworker (.github/workflows/browser.yml);
// CHROMIUM_PATH selects a local Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import playwright from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QUARTO = process.env.QUARTO_BIN || 'quarto';
const browsers = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium'];

// --- the site ---------------------------------------------------------------
const filler = n => Array.from({length: n}, (_, i) => `Avsnitt ${i + 1} med litt tekst, slik at siden blir lang nok til å rulle.`).join('\n\n');
const SITE = {
  '_quarto.yml': 'project:\n  type: website\n  resources: [coi-serviceworker.js]\nwebsite:\n  title: UI\n  navbar:\n    left: [index.qmd, other.qmd, group.qmd, plain.qmd, slow.qmd, dark.qmd]\n'
    + 'format:\n  html:\n    theme: cosmo\nfilters: [ctm-libs]\nlang: nb\n',
  'index.qmd': `---
title: Faner og lenker
---

Innledning. [Til eksempelet](#eks-3), [til det dype](#deep-head), [til fane B](#tab-b), [til ankeret](#anchor-b).

${filler(6)}

::: {.panel-tabset}

## Fane A

::: {#tab-a .ctm-tab-target}
:::

Tekst i fane A.

::: {.reading-step title="Gå i dybden: A"}
Les mer om A.
:::

## Fane B

::: {#tab-b .ctm-tab-target}
:::

Tekst i fane B.

::: {#anchor-b}
:::

::: {.panel-tabset}

### Indre 1

Indre tekst.

### Indre 2

#### Eksempel 3 {#eks-3}

Eksempelet, med [en lenke etter målet](#tab-a).

::: {.reading-step title="Gå i dybden: skaler uten å dreie"}
Dyp tekst.

##### Dypt {#deep-head}

Mer dyp tekst.
:::

Etter blokken.

:::

:::

${filler(4)}

::: {.hint}
Et hint.
:::

::: {.solution}
En løsning.
:::

::: {.details title="SciPy-oppslag"}
Oppslag.
:::

${filler(10)}

\`\`\`{=html}
<div id="grow" style="height: 10px"></div>
<script>
// Late layout above a target, as editors and boards make it: 7 × 100 px.
addEventListener('pageshow', () => setTimeout(() => {
  let steps = 0;
  const timer = setInterval(() => {
    document.getElementById('grow').style.height = (10 + 100 * ++steps) + 'px';
    if (steps === 7) clearInterval(timer);
  }, 150);
}, 120));
</script>
\`\`\`

## Langt nede {#far}

Målet langt nede.

${filler(12)}
`,
  'other.qmd': '---\ntitle: En annen side\n---\n\n[Eksempel 3](index.qmd#eks-3), [det dype](index.qmd#deep-head), [fane B](index.qmd#tab-b).\n\n'
    + '[Første fane](slow.qmd#first-start), [løsningen](slow.qmd#sol-1), [utenfor faner](slow.qmd#outside).\n',
  // A page whose load waits for a slow image: the browser jumps to the
  // fragment long before pageshow (uke5#uke5-start, uke8#oversikt-like
  // targets in the first tab; outside tabs; in closed reveals).
  'slow.qmd': `---
title: Treg side
---

![Et sakte bilde](slow.png){width=1 height=1}

${filler(10)}

::: {.panel-tabset}

## Første fane

::: {#tab-one .ctm-tab-target}
:::

::: {#first-start}
:::

Tekst i første fane.

${filler(4)}

## Andre fane

Andre.

:::

${filler(10)}

## Utenfor faner {#outside}

Tekst utenfor faner.

${filler(10)}

::: {.solution #sol-1}
Løsningen.
:::

${filler(10)}

::: {.reading-step title="Gå i dybden"}
Innledning.

#### Dypt {#slow-deep}

Mer.
:::

${filler(12)}
`,
  // A theme that is dark only (Quarto marks the page quarto-light).
  'dark.qmd': `---
title: Mørk
format:
  html:
    theme: darkly
---

::: {.reading-step title="Gå i dybden: mørk"}
Tekst i et steg.
:::

::: {.hint}
Tekst i et hint.
:::

::: {.solution}
Tekst i en løsning.
:::

::: {.details title="Oppslag"}
Tekst i et oppslag.
:::
`,
  'group.qmd': `---
title: Grupperte faner
---

::: {.panel-tabset group="lang"}
## R

R først.

## Python

Python først.
:::

${filler(3)}

::: {.panel-tabset group="lang"}
## R

### I R {#in-r}

Målet i R.

## Python

Python igjen.
:::
`,
  // A page with coi-serviceworker (the courses' Python pages load
  // pyodide-interaktiv's variant of it): a first visit registers the service
  // worker and reloads, to become cross-origin isolated where the host sends
  // no COOP/COEP headers (GitHub Pages, and serve() below). Here the reload
  // waits until the page has handled its link and kept its position, as on
  // a quick page with a slow worker. Late layout above the target, as
  // editors make it, on every load. A theme without web fonts: no request
  // leaves the server, also none through the worker (whose requests
  // page.route() does not see).
  'coi.qmd': `---
title: Isolert
format:
  html:
    theme: default
include-in-header:
  - text: |
      <script>
      // What ctm-nav finds: whether the page started with a saved position.
      // (Read here: Playwright's init scripts run before Firefox restores
      // history.state.)
      window.__startPosition = !!(history.state && history.state.__quartoTabPosition);
      window.coi = {doReload: function () {
        var start = Date.now();
        (function reload() {
          if ((history.state && history.state.__quartoTabPosition) || Date.now() - start > 5000) location.reload();
          else setTimeout(reload, 50);
        })();
      }};
      </script>
      <script src="coi-serviceworker.js"></script>
---

${filler(4)}

\`\`\`{=html}
<div id="coi-grow" style="height: 10px"></div>
<script>
addEventListener('pageshow', () => setTimeout(() => {
  let steps = 0;
  const timer = setInterval(() => {
    document.getElementById('coi-grow').style.height = (10 + 100 * ++steps) + 'px';
    if (steps === 7) clearInterval(timer);
  }, 150);
}, 120));
</script>
\`\`\`

${filler(4)}

::: {.panel-tabset}

## Oppgave

Oppgaveteksten.

## Løsning

${filler(3)}

### Målet {#coi-target}

Her lander lenken.

${filler(3)}

:::

${filler(12)}
`,
  'plain.qmd': `---
title: Uten faner
---

${filler(8)}

::: {.reading-step title="Gå i dybden"}
Tekst.

#### Dypt uten faner {#plain-deep}

Mer.
:::

${filler(8)}
`,
};

function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctm-ui-browser-'));
  fs.cpSync(path.join(ROOT, '_extensions', 'ctm-libs'), path.join(dir, '_extensions', 'ctm-libs'), {recursive: true});
  for (const [name, text] of Object.entries(SITE)) fs.writeFileSync(path.join(dir, name), text);
  const coi = path.join(ROOT, 'node_modules', 'coi-serviceworker', 'coi-serviceworker.js');
  if (!fs.existsSync(coi)) throw new Error('needs coi-serviceworker: npm install --no-save coi-serviceworker@0.1.7');
  fs.copyFileSync(coi, path.join(dir, 'coi-serviceworker.js'));
  // A 1x1 PNG.
  fs.writeFileSync(path.join(dir, 'slow.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
  const result = spawnSync(QUARTO, ['render'], {cwd: dir, encoding: 'utf8', timeout: 300000});
  if (result.status !== 0) throw new Error('quarto render failed:\n' + result.stderr);
  return dir;
}

function serve(root) {
  const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png'};
  const server = http.createServer((request, response) => {
    // As GitHub Pages: a folder serves its index.html, x serves x.html.
    let file = path.join(root, decodeURIComponent(new URL(request.url, 'http://x').pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    else if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!file.startsWith(root) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
    const send = () => {
      response.writeHead(200, {'content-type': types[path.extname(file)] || 'application/octet-stream'});
      response.end(fs.readFileSync(file));
    };
    // The slow image holds the page's load event back.
    if (file.endsWith('slow.png')) setTimeout(send, 1500);
    else send();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// --- what a page shows ------------------------------------------------------
// The target's state: visible, in which panes, inside open <details>, below
// the header, the focused element (in view?), the script's mark.
async function state(page, id) {
  const found = await page.evaluate(id => !!document.getElementById(id), id);
  assert.ok(found, 'no #' + id + ' on ' + page.url());
  return page.evaluate(id => {
    const target = document.getElementById(id);
    const header = document.getElementById('quarto-header');
    // The fixed header's height: where it ends while shown (headroom slides
    // it away on scrolling down, and back on scrolling up).
    const headerBottom = header ? header.offsetHeight : 0;
    const panes = [];
    for (let node = target; node; node = node.parentElement) if (node.classList && node.classList.contains('tab-pane')) panes.push(node.classList.contains('active'));
    const details = [];
    for (let node = target; node; node = node.parentElement) if (node.tagName === 'DETAILS') details.push(node.open);
    const focused = document.activeElement;
    const rect = focused ? focused.getBoundingClientRect() : null;
    return {
      visible: target.getClientRects().length > 0,
      // A section's heading: Quarto stretches a :target section upwards.
      top: Math.round((target.tagName === 'SECTION' && /^H[1-6]$/.test(target.firstElementChild?.tagName || '') ? target.firstElementChild : target).getBoundingClientRect().top),
      headerBottom,
      panes, details, mark: target.getAttribute('data-ctm-nav'), hash: location.hash,
      focus: focused === document.body ? 'BODY' : (focused.tagName + (focused.id ? '#' + focused.id : '') + (focused.getAttribute('role') ? '[' + focused.getAttribute('role') + ']' : '')),
      focusInView: !!rect && rect.height > 0 && rect.top >= headerBottom - 1 && rect.top < innerHeight,
      // An empty anchor has no height: its top must be in view.
      focusTopInView: !!rect && rect.top >= headerBottom - 1 && rect.top < innerHeight,
      focusMark: focused ? focused.hasAttribute('data-ctm-nav-focus') : false,
      focusInTarget: !!focused && (target.contains(focused) || focused.contains(target)),
      trace: (window.__trace || []).join(' | '),
    };
  }, id);
}
const settle = page => page.waitForTimeout(600);
// Until the script has handled the target (`how`: its data-ctm-nav mark),
// then until the page has settled. Renderers in CI can be slow.
async function handled(page, id, how) {
  await page.waitForFunction(([id, how]) => {
    const target = document.getElementById(id);
    return !!target && target.getAttribute('data-ctm-nav') === how;
  }, [id, how], {timeout: 10000}).catch(() => {});
  await settle(page);
}
// A full load (not a fragment navigation within the page already shown).
async function open(page, url) {
  await page.goto('about:blank');
  await page.goto(url);
  const id = new URL(url).hash.slice(1);
  if (id) await handled(page, id, 'load');
  else await settle(page);
}

// A fresh browser context and page; external requests are blocked, and
// uncaught errors and console errors of the site are collected.
// A trace of what happened on the page, for failure messages: events,
// history calls, focus calls, the script's marks.
const TRACE = `(() => {
  const t0 = performance.now(), trace = window.__trace = [];
  const log = text => { if (trace.length < 80) trace.push(Math.round(performance.now() - t0) + ' ' + text); };
  document.addEventListener('DOMContentLoaded', () => log('domcontentloaded'), true);
  for (const type of ['load', 'pageshow', 'popstate', 'hashchange']) window.addEventListener(type, event => log(type + (type === 'pageshow' ? '(' + event.persisted + ')' : '') + ' ' + location.hash), true);
  let scrolls = 0;
  window.addEventListener('scroll', () => { if (scrolls++ < 8) log('scroll ' + Math.round(scrollY)); }, true);
  window.addEventListener('unhandledrejection', event => log('rejection ' + (event.reason && event.reason.message || event.reason)));
  window.addEventListener('error', event => log('error ' + event.message));
  const push = history.pushState, replace = history.replaceState;
  history.pushState = function (state, title, url) { log('push ' + url); return push.apply(this, arguments); };
  history.replaceState = function (state) { log('replace ' + (state && state.__quartoTabPosition ? state.__quartoTabPosition.y : '-')); return replace.apply(this, arguments); };
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function () { log('focus ' + this.tagName + (this.id ? '#' + this.id : '')); return focus.apply(this, arguments); };
  const set = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) { if (name === 'data-ctm-nav') log('mark ' + value); return set.apply(this, arguments); };
  const rects = Element.prototype.getClientRects;
  Element.prototype.getClientRects = function () { const found = rects.apply(this, arguments); if (this.tagName === 'SECTION' && this.id) log('rects ' + this.id + ' ' + found.length); return found; };
})();`;

async function newPage(browser, base) {
  const context = await browser.newContext({viewport: {width: 1280, height: 800}});
  await context.addInitScript(TRACE);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // External resources (fonts, MathJax) are blocked; their load errors do not count.
  page.on('console', message => {
    const url = message.location() && message.location().url || '';
    if (message.type() === 'error' && url.startsWith(base) && !/Failed to load resource/i.test(message.text())) errors.push(message.text());
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
  return {context, page, errors};
}
async function done({context, errors}, name) {
  assert.deepEqual(errors, [], name + ': no console errors');
  await context.close();
}

async function loads(browser, base, name) {
  const session = await newPage(browser, base), {page} = session;
  // On load: a heading in an inactive inner tab, a heading inside a collapsed
  // reading step there (lecture mode), an anchor, a tab title.
  await open(page, base + 'index.html#eks-3');
  let s = await state(page, 'eks-3');
  assert.deepEqual(s.panes, [true, true], name + ' #eks-3: both tabs open' + ' ' + JSON.stringify(s));
  assert.equal(s.visible, true, name + ' ' + JSON.stringify(s));
  assert.ok(s.top >= s.headerBottom && s.top < s.headerBottom + 60, name + ' #eks-3 below the header: ' + JSON.stringify(s));
  assert.equal(s.focus, 'H4', name + ' #eks-3: its heading has focus' + ' ' + JSON.stringify(s));
  assert.equal(s.focusMark, true, name + ' #eks-3: marked for the focus style ' + JSON.stringify(s));
  assert.ok(s.focusInView && s.focusInTarget, name + ' #eks-3 focus in view');
  assert.equal(s.mark, 'load', name + ': handled by the script' + ' ' + JSON.stringify(s));

  await open(page, base + 'index.html#deep-head');
  s = await state(page, 'deep-head');
  assert.deepEqual(s.panes, [true, true], name + ' #deep-head tabs' + ' ' + JSON.stringify(s));
  assert.deepEqual(s.details, [true], name + ' #deep-head: the reading step opened' + ' ' + JSON.stringify(s));
  assert.equal(s.focus, 'H5', name + ' ' + JSON.stringify(s));
  assert.ok(s.focusInView, name + ' #deep-head focus in view: ' + JSON.stringify(s));
  assert.equal(s.mark, 'load', name + ' ' + JSON.stringify(s));
  assert.equal(await page.evaluate(() => CTMReveal.mode()), 'lecture', 'the page is in lecture mode');

  await open(page, base + 'index.html#anchor-b');
  s = await state(page, 'anchor-b');
  assert.deepEqual(s.panes, [true], name + ' ' + JSON.stringify(s));
  assert.equal(s.mark, 'load', name + ' ' + JSON.stringify(s));
  assert.ok(s.top >= s.headerBottom, name + ' #anchor-b below the header');

  // A tab title: the tab row stays visible, the panel (or its first heading) has focus.
  await open(page, base + 'index.html#tab-b');
  s = await state(page, 'tab-b');
  assert.deepEqual(s.panes, [true], name + ' ' + JSON.stringify(s));
  const row = await page.evaluate(() => {
    const pane = document.getElementById('tab-b').closest('.tab-pane');
    const list = pane.closest('.panel-tabset').querySelector(':scope > [role="tablist"]');
    return {top: Math.round(list.getBoundingClientRect().top), header: document.getElementById('quarto-header').offsetHeight,
      focused: document.activeElement === pane || (pane.contains(document.activeElement) && /^H[1-6]$/.test(document.activeElement.tagName))};
  });
  assert.ok(row.top >= row.header, name + ' #tab-b: the tab row is below the header ' + JSON.stringify(row));
  assert.ok(row.focused, name + ' #tab-b: the panel or its first heading has focus, ' + s.focus);
  assert.ok(s.focusInView, name + ' #tab-b: the focused element is in view ' + JSON.stringify(s));

  await done(session, name);
}

async function inPage(browser, base, name) {
  const session = await newPage(browser, base), {page} = session;
  let s;
  // In the page: from the top.
  await page.goto(base + 'index.html');
  await settle(page);
  await page.evaluate(() => { window.__hashchanges = 0; addEventListener('hashchange', () => window.__hashchanges++); });
  const length = await page.evaluate(() => history.length);
  await page.click('main a[href$="#deep-head"] >> nth=0');
  await handled(page, 'deep-head', 'link');
  s = await state(page, 'deep-head');
  assert.deepEqual(s.panes, [true, true], name + ' click: tabs' + ' ' + JSON.stringify(s));
  assert.deepEqual(s.details, [true], name + ' click: the reading step opened' + ' ' + JSON.stringify(s));
  assert.equal(s.mark, 'link', name + ' ' + JSON.stringify(s));
  assert.equal(s.hash, '#deep-head', name + ': the address shows the id' + ' ' + JSON.stringify(s));
  assert.equal(await page.evaluate(() => [history.length, window.__hashchanges].join()), (length + 1) + ',0', name + ': pushState, no navigation');
  assert.equal(s.focus, 'H5', name + ' ' + JSON.stringify(s));
  assert.ok(s.focusInView, name + ' click: focus in view ' + JSON.stringify(s));
  // Back and Forward.
  const before = await page.evaluate(() => scrollY);
  await page.goBack();
  await settle(page);
  assert.equal(await page.evaluate(() => location.hash), '');
  assert.ok(before > 0);
  assert.ok(await page.evaluate(() => scrollY) <= 2, name + ': Back restores the position before the link');
  assert.equal(await page.evaluate(() => document.querySelector('.tab-content > .tab-pane').classList.contains('active')), true,
    name + ': and its tabs');
  await page.goForward();
  await settle(page);
  s = await state(page, 'deep-head');
  assert.equal(s.visible, true, name + ': Forward shows the target again' + ' ' + JSON.stringify(s));
  assert.ok(s.top >= s.headerBottom - 2 && s.top < 800, name + ' Forward: in view ' + JSON.stringify(s));

  // Keyboard: the next Tab goes on from the target. (WebKit tabs to links
  // only with a preference, so it is not asked there.)
  if (name !== 'webkit') {
    await page.click('main a[href$="#deep-head"] >> nth=0');
    await settle(page);
    await page.keyboard.press('Tab');
    const after = await page.evaluate(() => {
      const heading = document.getElementById('deep-head').firstElementChild, focused = document.activeElement;
      return focused !== document.body && !!(heading.compareDocumentPosition(focused) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    assert.ok(after, name + ': keyboard focus goes on from the target');
  }

  await done(session, name);
}

async function otherPage(browser, base, name) {
  const session = await newPage(browser, base), {page} = session;
  let s;
  // From another page.
  await page.goto(base + 'other.html');
  await settle(page);
  await page.click('main a[href$="#eks-3"]');
  await page.waitForURL(/\/(index\.html)?#eks-3$/);
  await handled(page, 'eks-3', 'load');
  s = await state(page, 'eks-3');
  assert.deepEqual(s.panes, [true, true], name + ' from another page' + ' ' + JSON.stringify(s));
  assert.equal(s.mark, 'load', name + ' ' + JSON.stringify(s));
  assert.ok(s.focusInView, name + ' ' + JSON.stringify(s));

  await done(session, name);
}

async function withoutTabs(browser, base, name) {
  const session = await newPage(browser, base), {page} = session;
  let s;
  // Without tabsets: a heading inside a collapsed reading step.
  await open(page, base + 'plain.html#plain-deep');
  s = await state(page, 'plain-deep');
  assert.deepEqual(s.details, [true], name + ' plain page: the reading step opened' + ' ' + JSON.stringify(s));
  assert.equal(s.mark, 'load', name + ' ' + JSON.stringify(s));
  assert.ok(s.top >= s.headerBottom && s.focusInView, name + ' plain page: in view ' + JSON.stringify(s));

  await done(session, name);
}

async function pinned(browser, base, name) {
  const session = await newPage(browser, base), {page} = session;
  // Late layout above the target: it stays where the link put it.
  await page.goto(base + 'index.html#far');
  await page.waitForFunction(() => document.getElementById('far').hasAttribute('data-ctm-nav'), null, {timeout: 10000}).catch(() => {});
  await page.waitForTimeout(100);
  const early = await state(page, 'far');
  await page.waitForTimeout(1700);
  const late = await state(page, 'far');
  assert.equal(await page.evaluate(() => document.getElementById('grow').offsetHeight), 710, 'the block above grew');
  assert.ok(early.top >= early.headerBottom && early.top < early.headerBottom + 60 && Math.abs(late.top - early.top) <= 2,
    name + ' #far stays in place: ' + JSON.stringify({early, late}));

  await done(session, name);
}

async function groups(browser, base, name) {
  const session = await newPage(browser, base), {page} = session;
  await page.goto(base + 'group.html');
  await settle(page);
  await page.click('a[role="tab"]:has-text("Python") >> nth=0');
  await page.waitForTimeout(200);
  const stored = await page.evaluate(() => localStorage.getItem('quarto-persistent-tabsets-data'));
  assert.deepEqual(JSON.parse(stored), {lang: 'Python'});
  await page.goto(base + 'other.html');
  await open(page, base + 'group.html#in-r');
  const s = await state(page, 'in-r');
  assert.deepEqual(s.panes, [true], name + ': the link wins over the remembered group' + ' ' + JSON.stringify(s));
  assert.equal(s.visible, true, name + ' ' + JSON.stringify(s));
  assert.equal(s.mark, 'load', name + ' ' + JSON.stringify(s));
  assert.ok(s.focusInView, name + ' group: focus in view ' + JSON.stringify(s));
  assert.equal(await page.evaluate(() => localStorage.getItem('quarto-persistent-tabsets-data')), stored, name + ': the remembered group is unchanged');
  await done(session, name);
}

async function reveals(browser, base, name) {
  const session = await newPage(browser, base), {page, context} = session;
  await page.goto(base + 'index.html');
  await settle(page);
  const steps = () => page.evaluate(() => [...document.querySelectorAll('details.reading-step')].map(d => d.open));
  const pressed = () => page.evaluate(() => [...document.querySelectorAll('.ctm-modes button')].map(b => b.getAttribute('aria-pressed')).join());
  assert.equal(await page.isVisible('.ctm-modes'), true, name + ': the script shows the switch');
  assert.deepEqual(await steps(), [false, false]);
  await page.click('.ctm-modes button[data-mode="reading"]');
  assert.deepEqual(await steps(), [true, true], name + ': reading opens every reading step');
  assert.equal(await pressed(), 'false,true');
  assert.equal(await page.textContent('.ctm-modes-status'), 'Gå i dybden: prøv selv, og følg forklaringene steg for steg.');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('details.hint, details.solution, details.details')].map(d => d.open)), [false, false, false], 'other reveals stay closed');
  // The mode survives a reload and another page of the course; a new tab starts in lecture.
  await page.reload();
  await settle(page);
  assert.deepEqual(await steps(), [true, true], name + ': after a reload');
  await page.goto(base + 'plain.html');
  await settle(page);
  assert.equal(await page.evaluate(() => CTMReveal.mode()), 'reading', name + ': on another page');
  const fresh = await context.newPage();
  await fresh.goto(base + 'index.html');
  await fresh.waitForTimeout(400);
  assert.equal(await fresh.evaluate(() => CTMReveal.mode()), 'lecture', name + ': a new tab starts in lecture');
  await fresh.close();
  // Keyboard: Enter and Space toggle a summary; the lecture button closes the steps.
  await page.goto(base + 'index.html');
  await settle(page);
  await page.focus('details.hint > summary');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.querySelector('details.hint').open), true, name + ': Enter opens');
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => document.querySelector('details.hint').open), false, name + ': Space closes');
  await page.focus('.ctm-modes button[data-mode="lecture"]');
  await page.keyboard.press('Enter');
  assert.deepEqual(await steps(), [false, false]);
  // Printing opens the reading steps and hides the switch.
  await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
  assert.deepEqual(await steps(), [true, true], name + ': print opens');
  await page.emulateMedia({media: 'print'});
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ctm-modes')).display), 'none');
  await page.emulateMedia({media: 'screen'});
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  assert.deepEqual(await steps(), [false, false], name + ': restored after printing');
  // The .details marker is drawn: no text for screen readers (S2).
  const marker = await page.evaluate(() => getComputedStyle(document.querySelector('details.details > summary'), '::before').content);
  assert.ok(!/›/.test(marker) && /^(""|none|normal)$/.test(marker), name + ': the .details marker has no text: ' + marker);
  // A heading inside a reveal stays inside it; the next content stays in main.
  const shape = await page.evaluate(() => {
    const heading = document.getElementById('deep-head');
    const after = [...document.querySelectorAll('main p')].find(p => p.textContent === 'Etter blokken.');
    return {inside: !!heading.closest('details.reading-step > .ctm-reveal-body'), after: !!after && !after.closest('details'), main: !!document.querySelector('main #far')};
  });
  assert.deepEqual(shape, {inside: true, after: true, main: true}, name + ': structure');
  await done(session, name);
}

// B1 of the review: the browser jumps to the fragment while the page still
// loads (a slow image), and scrolls; the load must still be handled as a new
// visit, not as a history restore.
async function slowLoads(browser, base, name) {
  const session = await newPage(browser, base), {page} = session;
  const expectations = {
    'first-start': {panes: [true], details: [], focus: 'DIV#first-start'},
    'tab-one': {panes: [true], details: [], focus: /^DIV#tabset-\d+-1\[tabpanel\]$/},
    'outside': {panes: [], details: [], focus: 'H2'},
    'sol-1': {panes: [], details: [true], focus: 'SUMMARY'},
    'slow-deep': {panes: [], details: [true], focus: 'H4'},
  };
  const check = (id, s, how, where) => {
    const expected = expectations[id], label = name + ' ' + where + ' #' + id + ' ' + JSON.stringify(s);
    assert.equal(s.mark, how, label);
    assert.deepEqual(s.panes, expected.panes, label);
    assert.deepEqual(s.details, expected.details, label);
    if (expected.focus instanceof RegExp) assert.match(s.focus, expected.focus, label);
    else assert.equal(s.focus, expected.focus, label);
    assert.ok(s.focusTopInView, label);
    assert.ok(s.top >= s.headerBottom, label);
  };
  for (const id of Object.keys(expectations)) {
    await open(page, base + 'slow.html#' + id);
    check(id, await state(page, id), 'load', 'typed');
  }
  for (const id of ['first-start', 'sol-1', 'outside']) {
    await open(page, base + 'other.html');
    await page.click('main a[href$="slow.html#' + id + '"]');
    await page.waitForURL(new RegExp('slow\\.html#' + id + '$'));
    await handled(page, id, 'load');
    check(id, await state(page, id), 'load', 'from another page');
  }
  await done(session, name);
}

// A deep link on a learner's first visit to a page with coi-serviceworker,
// served without COOP/COEP headers: the worker's reload is still the visit's
// link (its target opened, focused and kept in place below the header), not
// a history restore of the position the first load saved. So is the
// learner's own reload before moving. After the learner has scrolled, a
// reload restores the position where the browser kept it. Browsers differ in
// what a reload keeps of the history entry's state (Chromium drops it when
// COOP switches the browsing context group): the check reports it per
// reload, also as a CI notice.
async function firstVisit(browser, base, name) {
  const session = await newPage(browser, base), {page} = session;
  const loads = [];
  page.on('load', () => { if (/\/coi(\.html)?#/.test(page.url())) loads.push(Date.now()); });
  // Until the page has stopped reloading (no load for `quiet` ms, 20 s at
  // most), its target is handled (`how`) and the layout above has grown.
  const shown = async (how, quiet) => {
    const end = Date.now() + 20000;
    while (Date.now() < end && !(loads.length > 0 && Date.now() - loads[loads.length - 1] >= quiet)) await page.waitForTimeout(100);
    if (how) await handled(page, 'coi-target', how);
    await page.waitForFunction(() => document.getElementById('coi-grow').offsetHeight === 710, null, {timeout: 5000}).catch(() => {});
    await settle(page);
  };
  const facts = () => page.evaluate(() => ({
    type: performance.getEntriesByType('navigation')[0].type,
    controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    isolated: window.crossOriginIsolated,
    kept: window.__startPosition,
  }));
  const linked = (s, label) => {
    assert.equal(s.mark, 'load', label);
    assert.deepEqual(s.panes, [true], label);
    assert.equal(s.focus, 'H3', label);
    assert.ok(s.focusInView, label);
    assert.ok(s.top >= s.headerBottom && s.top < s.headerBottom + 60, label);
  };
  const notes = [];
  const note = (what, f) => notes.push((f.kept ? 'kept by ' : 'dropped by ') + what);
  let first = {};
  try {
    await page.goto('about:blank');
    await page.goto(base + 'coi.html#coi-target');
    await shown('load', 3000);
    first = {...await facts(), loads: loads.length};
    if (loads.length > 1) note('the worker\'s reload (' + first.type + ')', first);
    let s = await state(page, 'coi-target');
    let label = name + ' first visit ' + JSON.stringify({...first, ...s});
    // Where the browser runs the worker, it reloaded the first visit.
    if (first.controlled) assert.ok(loads.length >= 2, label);
    linked(s, label);

    // The learner's own reload before moving: the link again.
    await page.reload();
    await shown('load', 1000);
    const again = await facts();
    note('the learner\'s reload', again);
    s = await state(page, 'coi-target');
    linked(s, name + ' reload ' + JSON.stringify({...again, ...s}));

    // After scrolling: the position, where the reload kept it; else a new visit.
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(500);
    await page.reload();
    await shown(null, 1000);
    const after = await facts();
    note('the reload after scrolling', after);
    s = await state(page, 'coi-target');
    label = name + ' reload after scrolling ' + JSON.stringify({...after, ...s});
    if (after.kept) {
      assert.equal(s.mark, null, label);
      assert.equal(s.focus, 'BODY', label);
      assert.deepEqual(s.panes, [true], label);
    } else {
      assert.equal(s.mark, 'load', label);
    }
  } finally {
    const report = name + ' firstVisit: the first visit took ' + first.loads + ' loads, ' + (first.controlled ? 'the service worker controls the page' : 'no service worker')
      + ' (crossOriginIsolated ' + first.isolated + '); the saved position ' + (notes.join(', ') || '-');
    console.log('#', report);
    if (process.env.GITHUB_ACTIONS) console.log('::notice title=UI check ' + name + ' firstVisit::' + report);
  }

  // coi-serviceworker's own report where a browser can't register it.
  session.errors.splice(0, Infinity, ...session.errors.filter(error => !/^COOP\/COEP Service Worker/.test(error)));
  await done(session, name);
}

// Colours: the courses' light boxes stay as they were; under a dark-only
// theme every text in reveals and the switch stays readable (WCAG AA).
async function colours(browser, base, name) {
  const session = await newPage(browser, base), {page} = session;
  const measure = () => page.evaluate(() => {
    const parse = text => {
      const m = /rgba?\(([^)]+)\)/.exec(text || '');
      if (!m) return null;
      const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    // The colour behind an element: its own and its ancestors' backgrounds over white.
    const behind = element => {
      const layers = [];
      for (let node = element; node; node = node.parentElement) {
        const colour = parse(getComputedStyle(node).backgroundColor);
        if (colour && colour[3] > 0) { layers.push(colour); if (colour[3] >= 1) break; }
      }
      let rgb = [255, 255, 255];
      for (const colour of layers.reverse()) rgb = rgb.map((v, i) => v * (1 - colour[3]) + colour[i] * colour[3]);
      return rgb;
    };
    const luminance = rgb => {
      const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
    };
    const contrast = (element, back = behind(element)) => {
      const text = parse(getComputedStyle(element).color);
      const fore = text.slice(0, 3).map((v, i) => v * text[3] + back[i] * (1 - text[3]));
      const [a, b] = [luminance(fore), luminance(back)].sort((x, y) => y - x);
      return Math.round((a + 0.05) / (b + 0.05) * 100) / 100;
    };
    document.querySelectorAll('details.ctm-reveal').forEach(details => { details.open = true; });
    const texts = [...document.querySelectorAll('.ctm-reveal-body p, .ctm-modes-status, .ctm-modes button')];
    // Summaries keep the theme's colour (Quarto: details > summary in $text-muted):
    // on a reveal it must read about as well as on the page itself.
    const page = behind(document.body);
    return {
      contrasts: texts.map(element => [element.tagName + ':' + element.textContent.trim().slice(0, 18), contrast(element)]),
      summaries: [...document.querySelectorAll('details.ctm-reveal > summary')].map(element =>
        [element.textContent.trim().slice(0, 18), contrast(element), contrast(element, page)]),
      boxes: Object.fromEntries([...document.querySelectorAll('details.ctm-reveal, .ctm-modes')].map(element =>
        [element.className.replace('ctm-reveal ', ''), behind(element).map(Math.round)])),
    };
  });
  await open(page, base + 'dark.html');
  const dark = await measure();
  for (const [what, ratio] of dark.contrasts) assert.ok(ratio >= 4.5, name + ' dark-only theme: ' + what + ' contrast ' + ratio + ' ' + JSON.stringify(dark));
  for (const [what, ratio, onPage] of dark.summaries) assert.ok(ratio >= 0.85 * onPage, name + ' dark-only theme: summary ' + what + ' ' + ratio + ' against ' + onPage + ' on the page');
  await open(page, base + 'index.html');
  const light = await measure();
  const near = (rgb, expected) => rgb.every((v, i) => Math.abs(v - expected[i]) <= 1);
  assert.ok(near(light.boxes['reading-step'], [246, 248, 250]), name + ' light reading step ' + JSON.stringify(light.boxes));
  assert.ok(near(light.boxes.solution, [244, 248, 244]), name + ' light solution ' + JSON.stringify(light.boxes));
  assert.ok(near(light.boxes['ctm-modes'], [244, 248, 250]), name + ' light switch ' + JSON.stringify(light.boxes));
  for (const [what, ratio] of light.contrasts) assert.ok(ratio >= 4.5, name + ' light theme: ' + what + ' contrast ' + ratio);
  for (const [what, ratio, onPage] of light.summaries) assert.ok(ratio >= 0.85 * onPage, name + ' light theme: summary ' + what + ' ' + ratio + ' against ' + onPage);
  await done(session, name);
}

// --- run --------------------------------------------------------------------
const dir = build();
const server = await serve(path.join(dir, '_site'));
const base = `http://127.0.0.1:${server.address().port}/`;
let failed = false;
try {
  for (const name of browsers) {
    const options = name === 'chromium' && process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {};
    const browser = await playwright[name].launch(options);
    try {
      // Each check on its own, so that one run reports every failure.
      for (const check of [loads, inPage, otherPage, withoutTabs, pinned, slowLoads, firstVisit, groups, reveals, colours]) {
        try {
          await check(browser, base, name);
          console.log('ok', name, check.name);
        } catch (error) {
          failed = true;
          console.log('not ok', name, check.name, error.message);
          // A failure as an annotation: GitHub's job logs need a download.
          if (process.env.GITHUB_ACTIONS) console.log('::error title=UI check ' + name + ' ' + check.name + '::' + String(error.message).replace(/%/g, '%25').replace(/\r?\n/g, '%0A'));
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
  fs.rmSync(dir, {recursive: true, force: true});
}
if (failed) process.exit(1);
console.log('UI checks passed in', browsers.join(', ') + '.');
