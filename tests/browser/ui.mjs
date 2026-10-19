// The page's interface in real browsers (Chromium, Firefox, WebKit): links
// into tabs and reveals (ui/ctm-nav.js), reveals and the lecture/reading
// switch (ui/ctm-reveal.js) on a rendered Quarto website. Chromium opens a
// closed <details> on fragment navigation by itself, so the checks also
// assert the script's path: a pushState for links in the page, and the
// data-ctm-nav mark on every target the script handled.
//
//   node tests/browser/ui.mjs [chromium] [firefox] [webkit]   (default: chromium)
//
// Needs Quarto and Playwright (.github/workflows/browser.yml); CHROMIUM_PATH
// selects a local Chromium.
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
  '_quarto.yml': 'project:\n  type: website\nwebsite:\n  title: UI\n  navbar:\n    left: [index.qmd, other.qmd, group.qmd, plain.qmd]\n'
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
  'other.qmd': '---\ntitle: En annen side\n---\n\n[Eksempel 3](index.qmd#eks-3), [det dype](index.qmd#deep-head), [fane B](index.qmd#tab-b).\n',
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
  const result = spawnSync(QUARTO, ['render'], {cwd: dir, encoding: 'utf8', timeout: 300000});
  if (result.status !== 0) throw new Error('quarto render failed:\n' + result.stderr);
  return dir;
}

function serve(root) {
  const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml'};
  const server = http.createServer((request, response) => {
    // As GitHub Pages: a folder serves its index.html, x serves x.html.
    let file = path.join(root, decodeURIComponent(new URL(request.url, 'http://x').pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    else if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!file.startsWith(root) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, {'content-type': types[path.extname(file)] || 'application/octet-stream'});
    response.end(fs.readFileSync(file));
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
      focusInTarget: !!focused && (target.contains(focused) || focused.contains(target)),
    };
  }, id);
}
const settle = page => page.waitForTimeout(600);
// A full load (not a fragment navigation within the page already shown).
async function open(page, url) {
  await page.goto('about:blank');
  await page.goto(url);
  await settle(page);
}

async function deepLinks(browser, base, name) {
  const context = await browser.newContext({viewport: {width: 1280, height: 800}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // External resources (fonts, MathJax) are blocked; their load errors do not count.
  page.on('console', message => {
    const url = message.location() && message.location().url || '';
    if (message.type() === 'error' && url.startsWith(base) && !/Failed to load resource/i.test(message.text())) errors.push(message.text());
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());

  // On load: a heading in an inactive inner tab, a heading inside a collapsed
  // reading step there (lecture mode), an anchor, a tab title.
  await open(page, base + 'index.html#eks-3');
  let s = await state(page, 'eks-3');
  assert.deepEqual(s.panes, [true, true], name + ' #eks-3: both tabs open');
  assert.equal(s.visible, true);
  assert.ok(s.top >= s.headerBottom && s.top < s.headerBottom + 60, name + ' #eks-3 below the header: ' + JSON.stringify(s));
  assert.equal(s.focus, 'H4', name + ' #eks-3: its heading has focus');
  assert.ok(s.focusInView && s.focusInTarget, name + ' #eks-3 focus in view');
  assert.equal(s.mark, 'load', name + ': handled by the script');

  await open(page, base + 'index.html#deep-head');
  s = await state(page, 'deep-head');
  assert.deepEqual(s.panes, [true, true], name + ' #deep-head tabs');
  assert.deepEqual(s.details, [true], name + ' #deep-head: the reading step opened');
  assert.equal(s.focus, 'H5');
  assert.ok(s.focusInView, name + ' #deep-head focus in view: ' + JSON.stringify(s));
  assert.equal(s.mark, 'load');
  assert.equal(await page.evaluate(() => CTMReveal.mode()), 'lecture', 'the page is in lecture mode');

  await open(page, base + 'index.html#anchor-b');
  s = await state(page, 'anchor-b');
  assert.deepEqual(s.panes, [true]);
  assert.equal(s.mark, 'load');
  assert.ok(s.top >= s.headerBottom, name + ' #anchor-b below the header');

  // A tab title: the tab row stays visible, the panel (or its first heading) has focus.
  await open(page, base + 'index.html#tab-b');
  s = await state(page, 'tab-b');
  assert.deepEqual(s.panes, [true]);
  const row = await page.evaluate(() => {
    const pane = document.getElementById('tab-b').closest('.tab-pane');
    const list = pane.closest('.panel-tabset').querySelector(':scope > [role="tablist"]');
    return {top: Math.round(list.getBoundingClientRect().top), header: document.getElementById('quarto-header').offsetHeight,
      focused: document.activeElement === pane || (pane.contains(document.activeElement) && /^H[1-6]$/.test(document.activeElement.tagName))};
  });
  assert.ok(row.top >= row.header, name + ' #tab-b: the tab row is below the header ' + JSON.stringify(row));
  assert.ok(row.focused, name + ' #tab-b: the panel or its first heading has focus, ' + s.focus);
  assert.ok(s.focusInView, name + ' #tab-b: the focused element is in view ' + JSON.stringify(s));

  // In the page: from the top, after switching back to tab A.
  await page.goto(base + 'index.html');
  await settle(page);
  await page.evaluate(() => { window.__hashchanges = 0; addEventListener('hashchange', () => window.__hashchanges++); });
  const length = await page.evaluate(() => history.length);
  await page.click('main a[href$="#deep-head"] >> nth=0');
  await settle(page);
  s = await state(page, 'deep-head');
  assert.deepEqual(s.panes, [true, true], name + ' click: tabs');
  assert.deepEqual(s.details, [true], name + ' click: the reading step opened');
  assert.equal(s.mark, 'link');
  assert.equal(s.hash, '#deep-head', name + ': the address shows the id');
  assert.equal(await page.evaluate(() => [history.length, window.__hashchanges].join()), (length + 1) + ',0', name + ': pushState, no navigation');
  assert.equal(s.focus, 'H5');
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
  assert.equal(s.visible, true, name + ': Forward shows the target again');
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

  // From another page.
  await page.goto(base + 'other.html');
  await settle(page);
  await page.click('main a[href$="#eks-3"]');
  await page.waitForURL(/\/(index\.html)?#eks-3$/);
  await settle(page);
  s = await state(page, 'eks-3');
  assert.deepEqual(s.panes, [true, true], name + ' from another page');
  assert.equal(s.mark, 'load');
  assert.ok(s.focusInView);

  // Without tabsets: a heading inside a collapsed reading step.
  await open(page, base + 'plain.html#plain-deep');
  s = await state(page, 'plain-deep');
  assert.deepEqual(s.details, [true], name + ' plain page: the reading step opened');
  assert.equal(s.mark, 'load');
  assert.ok(s.top >= s.headerBottom && s.focusInView, name + ' plain page: in view ' + JSON.stringify(s));

  // Late layout above the target: it stays where the link put it.
  await page.goto(base + 'index.html#far');
  await page.waitForTimeout(300);
  const early = await state(page, 'far');
  await page.waitForTimeout(1700);
  const late = await state(page, 'far');
  assert.equal(await page.evaluate(() => document.getElementById('grow').offsetHeight), 710, 'the block above grew');
  assert.ok(early.top >= early.headerBottom && early.top < early.headerBottom + 60 && Math.abs(late.top - early.top) <= 2,
    name + ' #far stays in place: ' + JSON.stringify({early, late}));

  assert.deepEqual(errors, [], name + ': no console errors');
  await context.close();
}

async function groups(browser, base, name) {
  const context = await browser.newContext({viewport: {width: 1280, height: 800}});
  const page = await context.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
  await page.goto(base + 'group.html');
  await settle(page);
  await page.click('a[role="tab"]:has-text("Python") >> nth=0');
  await page.waitForTimeout(200);
  const stored = await page.evaluate(() => localStorage.getItem('quarto-persistent-tabsets-data'));
  assert.deepEqual(JSON.parse(stored), {lang: 'Python'});
  await page.goto(base + 'other.html');
  await open(page, base + 'group.html#in-r');
  const s = await state(page, 'in-r');
  assert.deepEqual(s.panes, [true], name + ': the link wins over the remembered group');
  assert.equal(s.visible, true);
  assert.equal(s.mark, 'load');
  assert.ok(s.focusInView, name + ' group: focus in view ' + JSON.stringify(s));
  assert.equal(await page.evaluate(() => localStorage.getItem('quarto-persistent-tabsets-data')), stored, name + ': the remembered group is unchanged');
  await context.close();
}

async function reveals(browser, base, name) {
  const context = await browser.newContext({viewport: {width: 1280, height: 800}});
  const page = await context.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
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
  // A heading inside a reveal stays inside it; the next content stays in main.
  const shape = await page.evaluate(() => {
    const heading = document.getElementById('deep-head');
    const after = [...document.querySelectorAll('main p')].find(p => p.textContent === 'Etter blokken.');
    return {inside: !!heading.closest('details.reading-step > .ctm-reveal-body'), after: !!after && !after.closest('details'), main: !!document.querySelector('main #far')};
  });
  assert.deepEqual(shape, {inside: true, after: true, main: true}, name + ': structure');
  await context.close();
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
      for (const check of [deepLinks, groups, reveals]) {
        await check(browser, base, name);
        console.log('ok', name, check.name);
      }
    } catch (error) {
      failed = true;
      console.error('not ok', name, error.message);
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
