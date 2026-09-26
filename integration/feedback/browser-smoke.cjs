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
    await page.locator('.math-check-btn').first().waitFor({state: 'attached'});
    await page.waitForFunction(() => globalThis.monaco?.editor.getModels().some(m => m.getValue().includes('def add')));
    console.log('Python and mathematics controls initialized.');
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
    async function assertCompactMathControls() {
      const rows = await page.locator('.math-exercise-controls').evaluateAll(bars => bars.map(bar => {
        const check = bar.querySelector('.math-check-btn');
        const reference = check.cloneNode(true);
        reference.style.alignSelf = 'center'; reference.style.visibility = 'hidden';
        bar.append(reference);
        const normal = reference.getBoundingClientRect().height; reference.remove();
        return {normal, heights: [...bar.querySelectorAll('button')].map(button => button.getBoundingClientRect().height)};
      }));
      assert.ok(rows.every(row => row.normal > 0 && row.heights.every(height => height <= row.normal + 1)), JSON.stringify(rows));
      report.checks.push('Math controls retain their native compact button height at ' + page.viewportSize().width + 'px');
    }
    await page.getByRole('tab', {name: 'Mathematics', exact: true}).click();
    await assertCompactMathControls();
    await page.locator('#task-math-product .math-input').fill('42');
    await page.locator('#task-math-product .math-check-btn').click();
    await page.waitForFunction(() => document.querySelector('.math-input').classList.contains('math-input-ok'));
    report.checks.push('Mathematics checker accepts 42');
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
      const modelId = await page.evaluate(starter => monaco.editor.getModels().find(m => m.getValue().trim() === starter.trim()).uri.toString(), exercise.starter);
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
    const mathReply = [
      String.raw`The area is $\pi \times r^2$, not $\pi \times r$. Also \(x_1 * x_2\).`,
      '', String.raw`$$\frac{1}{2}$$`, '', String.raw`\[A = \pi r^2\]`, '',
      'Code: `$literal$`.', '```python', 'print("$not_math$")', '```',
      String.raw`Variables \\(x\\), \\(y\\).`,
      String.raw`Gradient \\(\\nabla f = \\left(\\frac{\\partial f}{\\partial x}, \\frac{\\partial f}{\\partial y}\\right)\\).`,
      '', String.raw`\\[\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\\]`, '',
      '<img src=x onerror=alert(1)>'
    ].join('\n');
    await page.route('https://feedback-test.invalid/v1/chat/completions', async route => {
      if (route.request().method() === 'POST') apiRequest = route.request().postDataJSON();
      await route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS'}, body: JSON.stringify({choices: [{finish_reason: 'stop', message: {content: mathReply}}]})});
    });
    await page.evaluate(() => AIFeedback.saveConfig({mode: 'api', storage: 'session', baseUrl: 'https://feedback-test.invalid/v1', model: 'test-model', apiKey: 'test-only'}));
    const executionCount = await page.evaluate(() => window.__feedbackExecutionCount);
    await page.locator('#task-price .py-exercise-feedback').click();
    await page.locator('#task-price .ai-feedback-body').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#task-price .ai-feedback-body .katex').length === 9);
    assert.equal(await page.locator('#task-price .ai-feedback-body .katex-display').count(), 3);
    assert.equal(await page.locator('#task-price .ai-feedback-body code').first().textContent(), '$literal$');
    assert.equal(await page.locator('#task-price .ai-feedback-body pre code').textContent(), 'print("$not_math$")');
    assert.equal(await page.locator('#task-price .ai-feedback-body img').count(), 0);
    assert.equal(await page.locator('#task-price .katex-error').count(), 0);
    const sent = JSON.parse(apiRequest.messages[1].content);
    assert.match(sent.task, /price_with_tax/);
    assert.equal(sent.responses[0].language, 'python');
    assert.deepEqual(sent.evidence, []);
    assert.doesNotMatch(JSON.stringify(apiRequest), /assert price_with_tax|submissionKey|test-only/);
    assert.equal(await page.evaluate(() => window.__feedbackExecutionCount), executionCount);
    await page.getByRole('tab', {name: 'Mathematics', exact: true}).click();
    const mathCases = [
      {id: 'task-math-product', draft: ['42'], correct: ['42']},
      {id: 'task-math-fields', draft: ['5', ''], correct: ['5', '3']},
      {id: 'task-math-vector', draft: ['2*x', ''], correct: ['2*x+y', 'x']},
      {id: 'task-math-matrix', draft: ['1', '', '', '4'], correct: ['1', '3', '2', '4']},
      {id: 'task-math-basis', draft: ['1', '-1', ''], correct: ['1', '1', '-1', '0', '0', '-1'], dynamic: true}
    ];
    for (const example of mathCases) {
      const cell = page.locator('#' + example.id);
      const feedback = cell.locator('.math-feedback-btn');
      assert.deepEqual(await cell.locator('.math-input').evaluateAll(fields => fields.map(f => f.value)), example.draft);
      let runs = await page.evaluate(() => window.__feedbackExecutionCount);
      await feedback.click();
      await cell.locator('.ai-feedback-body').waitFor();
      await page.waitForFunction(id => document.querySelectorAll('#' + id + ' .ai-feedback-body .katex').length === 9, example.id);
      assert.equal(await page.evaluate(() => window.__feedbackExecutionCount), runs);
      assert.equal(await cell.locator('.katex-error').count(), 0);
      let request = JSON.parse(apiRequest.messages[1].content);
      assert.doesNotMatch(JSON.stringify(apiRequest), /For course authors|def check|assess_basis|data-answer|test-only/);
      if (example.id !== 'task-math-product') assert.deepEqual(request.evidence, []);
      if (example.dynamic) {
        await cell.locator('[data-dynamic-action="add-col"]').click();
        assert.equal(await cell.locator('.ai-feedback-output').textContent(), '');
      }
      for (let i = 0; i < example.correct.length; i++) await cell.locator('.math-input').nth(i).fill(example.correct[i]);
      await cell.locator('.math-check-btn').click();
      await page.waitForFunction(id => !document.querySelector('#' + id + ' .math-check-btn').disabled, example.id);
      assert.equal(await cell.locator('.math-input-wrong,.math-input-err,.math-input-partial').count(), 0);
      assert.ok(await cell.locator('.math-fb-ok').count(), example.id + ' must pass its actual checker');
      runs = await page.evaluate(() => window.__feedbackExecutionCount);
      await feedback.click(); await cell.locator('.ai-feedback-body').waitFor();
      request = JSON.parse(apiRequest.messages[1].content);
      assert.ok(request.evidence.length > 0, example.id + ' keeps matching check evidence');
      assert.equal(await page.evaluate(() => window.__feedbackExecutionCount), runs);
      await cell.locator('.math-input').first().fill('999');
      assert.equal(await cell.locator('.math-input-ok,.math-input-wrong,.math-input-partial,.math-input-dependent').count(), 0, 'Edits must clear old Check colors');
      await feedback.click(); await cell.locator('.ai-feedback-body').waitFor();
      assert.deepEqual(JSON.parse(apiRequest.messages[1].content).evidence, []);
      assert.equal(await page.evaluate(() => window.__feedbackExecutionCount), runs);
      await feedback.click(); await cell.locator('.ai-feedback-body').waitFor();
      assert.match(apiRequest.messages[0].content, /CURRENT HINT LEVEL: 3 OF 4/);
      await feedback.click(); await cell.locator('.ai-feedback-body').waitFor();
      assert.match(apiRequest.messages[0].content, /CURRENT HINT LEVEL: 4 OF 4/);
      assert.match(apiRequest.messages[0].content, /A complete rewrite or solution is permitted/);
      report.checks.push(example.id + ': partial draft, real Check, four feedback steps, matching evidence, no feedback execution and LaTeX');
    }
    await page.locator('#task-math-product .ai-feedback-gear').click();
    assert.equal(await page.locator('dialog.ai-feedback-settings[open]').count(), 1);
    await page.locator('dialog.ai-feedback-settings').getByRole('button', {name: 'Cancel', exact: true}).click();
    await page.screenshot({path: path.join(site, 'mathematics-practice-desktop.png'), fullPage: true});
    await page.getByRole('tab', {name: 'Pyodide', exact: true}).click();
    await page.waitForFunction(() => globalThis.qpyodideCellContainer?.cells.length === 3 && qpyodideCellContainer.cells.every(c => c.primaryUnit?.editor));
    await page.evaluate(async () => {
      const proxy = await qpyodideReady, run = proxy.runCell;
      window.__pyodideRunCount = 0;
      proxy.runCell = function(...args) { window.__pyodideRunCount++; return run.apply(this,args); };
    });
    const compact = await page.locator('.qpyodide-editor-toolbar').evaluateAll(bars => bars.every(bar => {
      const reference = bar.querySelector('.qpyodide-button-run').cloneNode(true);
      reference.style.alignSelf='center'; reference.style.visibility='hidden'; bar.append(reference);
      const normal=reference.getBoundingClientRect().height; reference.remove();
      return normal > 0 && [...bar.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height<=normal+1);
    }));
    assert.ok(compact,'Pyodide settings gear must not stretch the original compact controls');
    const pyodideCases = [
      {id:'task-pyodide-price', result:'100', solution:'price = 80\nrate = 0.25\ntax = price * rate\nprint(price + tax)'},
      {id:'task-pyodide-total', result:'10', solution:'values = [3, 5, 2]\ntotal = 0\nfor value in values:\n    total += value\nprint(total)'},
      {id:'task-pyodide-circle', result:'28.27431', solution:'def circle_area(radius):\n    pi = 3.14159\n    return pi * radius ** 2\nprint(circle_area(3))'}
    ];
    for (const [index, example] of pyodideCases.entries()) {
      const cell = page.locator('#'+example.id), feedback = cell.locator('.qpyodide-button-feedback');
      const ask = async () => {
        const runs = await page.evaluate(() => window.__pyodideRunCount);
        await feedback.click(); await cell.locator('.ai-feedback-body').waitFor();
        await page.waitForFunction(id => document.querySelectorAll('#'+id+' .ai-feedback-body .katex').length === 9, example.id);
        assert.equal(await page.evaluate(() => window.__pyodideRunCount), runs);
        assert.equal(await cell.locator('.katex-error').count(),0);
        assert.doesNotMatch(JSON.stringify(apiRequest), /For course authors|TODO_AUTHOR|test-only/);
        return JSON.parse(apiRequest.messages[1].content);
      };
      assert.deepEqual((await ask()).evidence,[]);
      await cell.locator('.qpyodide-button-run').click();
      await page.waitForFunction(index => qpyodideCellContainer.cells[index].primaryUnit.feedbackEvidence !== null, index);
      assert.ok((await ask()).evidence.some(e=>e.label==='Learner stdout'));
      await page.evaluate(({index,code})=>qpyodideCellContainer.cells[index].primaryUnit.editor.setValue(code), {index,code:example.solution});
      assert.deepEqual((await ask()).evidence,[]);
      assert.match(apiRequest.messages[0].content,/Do not supply a complete rewritten response or finished solution/);
      assert.match(apiRequest.messages[0].content,/CURRENT HINT LEVEL: 2 OF 3/);
      await ask();
      assert.match(apiRequest.messages[0].content,/CURRENT HINT LEVEL: 3 OF 3/);
      await cell.locator('.qpyodide-button-run').click();
      await page.waitForFunction(index => qpyodideCellContainer.cells[index].primaryUnit.feedbackEvidence !== null,index);
      assert.match(await cell.locator('.qpyodide-output-code-area').innerText(),new RegExp(example.result.replace('.', '\\.')));
      if(index===2)assert.match(JSON.stringify((await ask()).materials),/pi.*r/);
      await cell.locator('.qpyodide-button-reset').click();
      assert.equal(await cell.locator('.qpyodide-output-feedback-area').textContent(),'');
      assert.equal(await cell.locator('.qpyodide-output-code-area').textContent(),'');
      assert.ok(await page.evaluate(index => {const u=qpyodideCellContainer.cells[index].primaryUnit;return u.getCode()===u.code && u.getFeedbackEvidence().length===0;},index));
      report.checks.push(example.id+': real worker run, matching stdout, no feedback execution, three hints, LaTeX and Reset');
    }
    await page.locator('#task-pyodide-price .ai-feedback-gear').click();
    assert.equal(await page.locator('dialog.ai-feedback-settings[open]').count(),1);
    await page.locator('dialog.ai-feedback-settings').getByRole('button',{name:'Cancel',exact:true}).click();
    await page.screenshot({path:path.join(site,'pyodide-practice-desktop.png'),fullPage:true});
    // Local policy overrides enable the same progression in both review integrations.
    await page.evaluate(() => {
      window.__savedPolicies = window.__aiFeedbackPolicies;
      window.__aiFeedbackPolicies = {layers:[{integrations:{
        'py-exercise':{'reset-on-run':false,steps:[{prompt:'LOCAL FIRST'},{prompt:'LOCAL SECOND'}]},
        'non-python':{steps:[{prompt:'WRITING FIRST'},{prompt:'WRITING SECOND'}]}
      }}]};
    });
    await pythonTab.click();
    const policyCell=page.locator('#task-price');
    const policyAsk=async()=>{await policyCell.locator('.py-exercise-feedback').click();await policyCell.locator('.ai-feedback-body').waitFor();return apiRequest.messages[0].content;};
    assert.match(await policyAsk(),/LOCAL FIRST/);assert.match(await policyAsk(),/LOCAL SECOND/);
    await policyCell.locator('.py-exercise-check').click();
    await page.waitForFunction(()=>!document.querySelector('#task-price .py-exercise-check').disabled);
    assert.match(await policyAsk(),/LOCAL SECOND/);
    await policyCell.locator('.py-exercise-reset').click();assert.match(await policyAsk(),/LOCAL FIRST/);
    await page.evaluate(()=>window.__aiFeedbackPolicies.layers[0].integrations['py-exercise']['reset-on-run']=true);
    await policyAsk();assert.match(await policyAsk(),/LOCAL SECOND/);
    await policyCell.locator('.py-exercise-check').click();
    await page.waitForFunction(()=>!document.querySelector('#task-price .py-exercise-check').disabled);
    assert.match(await policyAsk(),/LOCAL FIRST/);
    await nonPythonTab.click();
    const writing=page.locator('#spanish-writing');
    for(const marker of ['WRITING FIRST','WRITING SECOND']){
      await writing.locator('button').first().click();await writing.locator('.ai-feedback-body').waitFor();assert.ok(apiRequest.messages[0].content.includes(marker));
    }
    await page.evaluate(()=>window.__aiFeedbackPolicies=window.__savedPolicies);
    report.checks.push('Local YAML-equivalent policies enable text/Python steps, preserve Check progress when configured, and reset on Check/Reset by default');


    await pythonTab.click();
    await page.evaluate(() => AIFeedback.saveConfig({mode: 'copy', storage: 'session'}));
    report.checks.push('Python API feedback uses shared settings and current code without execution or hidden tests (mock provider)');
    report.checks.push('Feedback renders all four LaTeX delimiters and preserves literal code');
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
    await page.getByRole('tab', {name: 'Mathematics', exact: true}).click();
    await assertCompactMathControls();
    await page.screenshot({path: path.join(site, 'mathematics-practice-mobile.png'), fullPage: true});
    console.log(JSON.stringify(report, null, 2));
  } finally {
    console.log(JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(site, 'browser-smoke.json'), JSON.stringify(report, null, 2) + '\n');
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
