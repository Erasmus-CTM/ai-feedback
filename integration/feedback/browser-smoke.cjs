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
    await page.locator('.py-exercise-check').first().waitFor({state: 'attached'});
    await page.locator('.qpyodide-button-run').waitFor({state: 'attached'});
    await page.locator('.math-check-btn').waitFor();
    await page.waitForFunction(() => globalThis.monaco?.editor.getModels().some(m => m.getValue().includes('def add')));
    console.log('All three consumer controls initialized.');
    assert.equal(await page.locator('.ai-feedback-activity .feedback-criteria').count(), 0);
    assert.ok(!/read the handwritten Spanish|Do not rewrite the whole response/i.test(await page.locator('#handwriting').innerText()));
    assert.equal(await page.locator('#handwriting #handwriting-sample-download').count(), 1);
    report.checks.push('Learner cards omit reviewer instructions and expose the handwriting download');
    // Switch tabs before interacting with the real consumer controls.
    const pythonTab = page.getByRole('tab', {name: 'Python', exact: true});
    const nonPythonTab = page.getByRole('tab', {name: 'Non-Python', exact: true});
    await pythonTab.click();
    assert.equal(await page.locator('[role=tab][aria-selected="true"]').innerText(), 'Python');
    const additionId = await page.evaluate(() => window.__pyExercises.find(x => x.label === 'integration-add').id);
    const addition = page.locator('#py-exercise-' + additionId);
    await addition.locator('.py-exercise-check').click();
    await addition.locator('.py-test-fail').first().waitFor();
    report.checks.push('Python starter fails its tests');
    const setCode = code => page.evaluate(code => monaco.editor.getModels().find(m => m.getValue().includes('def add')).setValue(code), code);
    await setCode('def add(a, b):\n    return a + b');
    await addition.locator('.py-exercise-check').click();
    await page.waitForFunction(id => document.querySelectorAll('#py-exercise-' + id + ' .py-test-pass').length === 3, additionId);
    report.checks.push('Python corrected response passes all three checks');
    await setCode('import os\ndef add(a, b):\n    return a + b');
    await addition.locator('.py-exercise-check').click();
    await addition.locator('.py-exercise-violations').waitFor();
    report.checks.push('Forbidden imports are rejected');
    await addition.locator('.py-exercise-reset').click();
    assert.equal(await addition.locator('.py-exercise-result').textContent(), '');
    assert.ok(await page.evaluate(() => monaco.editor.getModels().some(m => m.getValue().includes('return a - b'))));
    report.checks.push('Reset restores the starter and clears results');
    await nonPythonTab.click();
    await page.locator('.math-input').fill('42');
    await page.locator('.math-check-btn').click();
    await page.waitForFunction(() => document.querySelector('.math-input').classList.contains('math-input-ok'));
    report.checks.push('Mathematics checker accepts 42');
    await pythonTab.click();
    await page.locator('.qpyodide-button-run').click();
    await page.waitForFunction(() => /\b6\b/.test(document.querySelector('.qpyodide-output-code-area').textContent));
    report.checks.push('Interactive Python executes and prints 6');
    await nonPythonTab.click();
    await page.locator('#spanish-writing .ai-feedback-button').first().click();
    await page.locator('#spanish-writing pre').waitFor();
    assert.match(await page.locator('#spanish-writing pre').textContent(), /Yo vive en Trondheim/);
    await page.locator('#spanish-writing .ai-feedback-gear').click();
    assert.equal(await page.locator('dialog.ai-feedback-settings[open]').count(), 1);
    report.checks.push('Shared feedback copy prompt and cogwheel work beside all consumers');
    assert.deepEqual(report.pageErrors, []);
    await page.screenshot({path: path.join(site, 'integration-desktop.png'), fullPage: true});
    await page.locator('dialog.ai-feedback-settings').getByRole('button', {name: 'Cancel', exact: true}).click();
    await pythonTab.click();
    const solutions = {
      'practice-price': 'def price_with_tax(price, rate):\n    tax = price * rate\n    return price + tax',
      'practice-total': 'def total(values):\n    result = 0\n    for value in values:\n        result += value\n    return result',
      'practice-greet': 'def greet(name):\n    message = f"Hello, {name}!"\n    print(message)\n    return message\n\ngreet("Ada")',
      'practice-circle': 'def circle_area(radius):\n    pi = 3.14159\n    return pi * radius ** 2',
      'practice-palindrome': 'def is_palindrome(text):\n    normalized = text.lower()\n    return normalized == normalized[::-1]'
    };
    const exercises = await page.evaluate(() => window.__pyExercises.filter(x => x.label.startsWith('practice-')));
    assert.equal(exercises.length, 5);
    assert.equal(await page.locator('.py-exercise-feedback').count(), 6, 'Every Python task needs a Feedback button');
    await page.evaluate(() => {
      const run = mainPyodide.runPythonAsync;
      window.__feedbackExecutionCount = 0;
      mainPyodide.runPythonAsync = function (...args) {
        window.__feedbackExecutionCount++;
        return run.apply(this, args);
      };
    });
    for (const exercise of exercises) {
      const cell = page.locator('#py-exercise-' + exercise.id);
      const bounds = await cell.locator('.monaco-editor').boundingBox();
      assert.ok(bounds && bounds.width > 100 && bounds.height > 40, exercise.label + ': editor must lay out after opening its tab');
      const result = cell.locator('.py-exercise-result');
      const fn = /def (\w+)\(/.exec(exercise.starter)[1];
      const modelId = await page.evaluate(fn => monaco.editor.getModels().find(m => m.getValue().includes('def ' + fn + '(')).uri.toString(), fn);
      const replace = code => page.evaluate(({modelId, code}) => monaco.editor.getModels().find(m => m.uri.toString() === modelId).setValue(code), {modelId, code});
      const runCheck = async () => {
        await cell.locator('.py-exercise-check').click();
        await page.waitForFunction(id => !document.querySelector('#py-exercise-' + id + ' .py-exercise-check').disabled, exercise.id);
      };
      const feedback = async () => {
        const before = await page.evaluate(() => window.__feedbackExecutionCount);
        await cell.locator('.py-exercise-feedback').click();
        await cell.locator('.py-exercise-feedback-output pre').waitFor();
        assert.equal(await page.evaluate(() => window.__feedbackExecutionCount), before, 'Feedback must not execute code');
        const prompt = await cell.locator('.py-exercise-feedback-output pre').textContent();
        assert.ok(prompt.includes(JSON.stringify(exercise.task)));
        assert.ok(!prompt.includes(exercise.tests));
        assert.doesNotMatch(prompt, /For course authors|Feature:|## TESTS ##|submissionKey/);
        return prompt;
      };
      assert.match(await feedback(), /"evidence":\[\]/);
      await runCheck();
      assert.equal(await result.locator('.py-exercise-error').count(), 0, exercise.label + ': starter must run');
      assert.ok(await result.locator('.py-test-fail').count() > 0, exercise.label + ': starter must need work');
      if (exercise.label === 'practice-greet') assert.match(await result.locator('.py-exercise-stdout').innerText(), /Hello, Ada!/);
      if (!exercise.showTestHints) assert.ok(!(await result.innerText()).includes('Ignore differences in letter case'));
      const checkedPrompt = await feedback();
      assert.match(checkedPrompt, /Checks passed/);
      assert.doesNotMatch(checkedPrompt, /Ignore differences in letter case|Return the greeting as well as printing it/);
      await replace(solutions[exercise.label]);
      assert.match(await feedback(), /"evidence":\[\]/, 'Editing must discard the earlier checker evidence');
      await runCheck();
      assert.equal(await result.locator('.py-exercise-all-passed').count(), 1, exercise.label + ': corrected solution must pass');
      assert.match(await feedback(), /Checks passed/);
      if (exercise.label === 'practice-total' || exercise.label === 'practice-circle') {
        await replace(exercise.label === 'practice-total' ? 'def total(values):\n    return sum(values)' : 'import math\ndef circle_area(radius):\n    return math.pi * radius ** 2');
        await runCheck();
        assert.equal(await result.locator('.py-exercise-violations').count(), 1, exercise.label + ': task restriction must be enforced');
      }
      await cell.locator('.py-exercise-reset').click();
      assert.equal(await result.textContent(), '');
      assert.equal(await cell.locator('.py-exercise-feedback-output').textContent(), '');
      assert.equal(await page.evaluate(id => monaco.editor.getModels().find(m => m.uri.toString() === id).getValue(), modelId), exercise.starter);
      report.checks.push(exercise.label + ': Feedback without execution, fresh checker evidence, passing correction and exact Reset');
    }
    await page.locator('#task-price .ai-feedback-gear').click();
    assert.equal(await page.locator('dialog.ai-feedback-settings[open]').count(), 1);
    await page.locator('dialog.ai-feedback-settings').getByRole('button', {name: 'Cancel', exact: true}).click();
    // Test the real Python button in API mode with a mocked provider response.
    let apiRequest;
    await page.route('https://feedback-test.invalid/v1/chat/completions', async route => {
      if (route.request().method() === 'POST') apiRequest = route.request().postDataJSON();
      await route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS'}, body: JSON.stringify({choices: [{finish_reason: 'stop', message: {content: 'Review your return value.'}}]})});
    });
    await page.evaluate(() => AIFeedback.saveConfig({mode: 'api', storage: 'session', baseUrl: 'https://feedback-test.invalid/v1', model: 'test-model', apiKey: 'test-only'}));
    const executionCount = await page.evaluate(() => window.__feedbackExecutionCount);
    await page.locator('#task-price .py-exercise-feedback').click();
    await page.locator('#task-price .ai-feedback-body').waitFor();
    assert.match(await page.locator('#task-price .ai-feedback-body').innerText(), /Review your return value/);
    const sent = JSON.parse(apiRequest.messages[1].content);
    assert.match(sent.task, /price_with_tax/);
    assert.equal(sent.responses[0].language, 'python');
    assert.deepEqual(sent.evidence, []);
    assert.doesNotMatch(JSON.stringify(apiRequest), /assert price_with_tax|submissionKey|test-only/);
    assert.equal(await page.evaluate(() => window.__feedbackExecutionCount), executionCount);
    await page.evaluate(() => AIFeedback.saveConfig({mode: 'copy', storage: 'session'}));
    report.checks.push('Python API feedback uses shared settings and current code without execution or hidden tests (mock provider)');
    assert.deepEqual(report.pageErrors, []);
    await page.screenshot({path: path.join(site, 'python-practice-desktop.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    await page.locator('#task-price').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.py-exercise-buttons').evaluateAll(bars => bars.every(bar => {
      const bounds = bar.getBoundingClientRect();
      return [...bar.children].every(button => {
        const rect = button.getBoundingClientRect();
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && button.scrollWidth <= button.clientWidth + 1;
      });
    })), 'Python controls must fit on mobile without squeezing or overflowing labels');
    await page.screenshot({path: path.join(site, 'python-practice-mobile.png'), fullPage: true});
    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.writeFileSync(path.join(site, 'browser-smoke.json'), JSON.stringify(report, null, 2) + '\n');
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
