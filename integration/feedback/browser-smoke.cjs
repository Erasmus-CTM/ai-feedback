const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const site = process.env.CTM_INTEGRATION_SITE;
assert.ok(site, 'Run scripts/setup-feedback-integration.py --browser.');
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml'};
const server = http.createServer((req, res) => {
  const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(site, '.' + (requested === '/' ? '/examples.html' : requested));
  if (!file.startsWith(path.resolve(site) + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy':'same-origin', 'Cross-Origin-Embedder-Policy':'credentialless'});
    res.end(body);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const report = {checks: [], pageErrors: [], failedRequests: []};
  try {
    browser = await chromium.launch({headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath: process.env.CHROMIUM_EXECUTABLE} : {}),
      ...(process.env.CTM_BROWSER_PROXY ? {proxy: {server: process.env.CTM_BROWSER_PROXY, bypass: '127.0.0.1,localhost'}} : {})});
    const page = await browser.newPage({viewport: {width: 1280, height: 900}, serviceWorkers: 'block'});
    page.setDefaultTimeout(120000);
    page.on('pageerror', e => report.pageErrors.push(e.message));
    page.on('requestfailed', request => report.failedRequests.push({url: request.url(), error: request.failure()?.errorText}));
    await page.goto('http://127.0.0.1:' + server.address().port + '/examples.html', {waitUntil: 'domcontentloaded'});
    console.log('Waiting for real Pyodide and Monaco initialization…');
    await page.locator('.py-exercise-check').waitFor();
    await page.locator('.qpyodide-button-run').waitFor();
    await page.locator('.math-check-btn').waitFor();
    await page.waitForFunction(() => globalThis.monaco?.editor.getModels().some(m => m.getValue().includes('def add')));
    console.log('All three consumer controls initialized.');
    // The Python and mathematical checkers really execute in the Pyodide worker.
    await page.locator('.py-exercise-check').click();
    await page.waitForFunction(() => document.querySelector('.py-exercise-result .py-test-fail'));
    report.checks.push('Python starter fails its tests');
    const setCode = code => page.evaluate(code => monaco.editor.getModels().find(m => m.getValue().includes('def add')).setValue(code), code);
    await setCode('def add(a, b):\n    return a + b');
    await page.locator('.py-exercise-check').click();
    await page.waitForFunction(() => document.querySelectorAll('.py-exercise-result .py-test-pass').length === 3);
    report.checks.push('Python corrected response passes all three checks');
    await setCode('import os\ndef add(a, b):\n    return a + b');
    await page.locator('.py-exercise-check').click();
    await page.waitForFunction(() => /forbidden|not allowed/i.test(document.querySelector('.py-exercise-result').textContent));
    report.checks.push('Forbidden imports are rejected');
    await page.locator('.py-exercise-reset').click();
    assert.equal(await page.locator('.py-exercise-result').textContent(), '');
    assert.ok(await page.evaluate(() => monaco.editor.getModels().some(m => m.getValue().includes('return a - b'))));
    report.checks.push('Reset restores the starter and clears results');
    await page.locator('.math-input').fill('42');
    await page.locator('.math-check-btn').click();
    await page.waitForFunction(() => document.querySelector('.math-input').classList.contains('math-input-ok'));
    report.checks.push('Mathematics checker accepts 42');
    await page.locator('.qpyodide-button-run').click();
    await page.waitForFunction(() => /\b6\b/.test(document.querySelector('.qpyodide-output-code-area').textContent));
    report.checks.push('Interactive Python executes and prints 6');
    await page.locator('#spanish-writing .ai-feedback-button').first().click();
    await page.locator('#spanish-writing pre').waitFor();
    assert.match(await page.locator('#spanish-writing pre').textContent(), /Yo vive en Trondheim/);
    await page.locator('#spanish-writing .ai-feedback-gear').click();
    assert.equal(await page.locator('dialog.ai-feedback-settings[open]').count(), 1);
    report.checks.push('Shared feedback copy prompt and cogwheel work beside all consumers');
    assert.deepEqual(report.pageErrors, []);
    await page.screenshot({path: path.join(site, 'integration-desktop.png'), fullPage: true});
    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.writeFileSync(path.join(site, 'browser-smoke.json'), JSON.stringify(report, null, 2) + '\n');
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
