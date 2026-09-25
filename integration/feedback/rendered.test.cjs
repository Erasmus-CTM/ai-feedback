const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const site = process.env.CTM_INTEGRATION_SITE;
assert.ok(site, 'Run scripts/setup-feedback-integration.py --test first.');
const html = fs.readFileSync(path.join(site, 'examples.html'), 'utf8');

test('common page renders the active extensions and keeps local dependencies resolvable', () => {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.ai-feedback-activity').length, 6);
  assert.equal(doc.querySelectorAll('.math-exercise-cell').length, 5);
  assert.equal(doc.querySelectorAll('.py-exercise-cell').length, 6);
  assert.deepEqual([...doc.querySelectorAll('.panel-tabset > ul [role=tab]')].map(n => n.textContent.trim()), ['Non-Python', 'Python', 'Mathematics']);
  const panels = doc.querySelectorAll('.panel-tabset > .tab-content > .tab-pane');
  assert.equal(panels.length, 3);
  assert.equal(panels[0].querySelectorAll('.ai-feedback-activity').length, 6);
  assert.equal(panels[0].querySelectorAll('.math-exercise-cell').length, 0);
  assert.equal(panels[1].querySelectorAll('.py-exercise-cell').length, 6);
  assert.equal(panels[1].querySelectorAll('[id^="qpyodide-insertion-location-"]').length, 0);
  assert.ok(!fs.existsSync(path.join(site, 'py-exercise-examples.html')), 'Python examples must use the same page');
  assert.equal(doc.querySelectorAll('[id^="qpyodide-insertion-location-"]').length, 0);
  for (const name of ['feedback-core.js', 'feedback-dom.js', 'ai-feedback.js']) {
    assert.equal([...doc.scripts].filter(s => s.src.endsWith('/' + name)).length, 1, name + ' must load once');
  }
  for (const marker of ['var ME_CFG =', 'function setupExercise(exerciseData)']) {
    assert.equal([...doc.scripts].filter(s => s.textContent.includes(marker)).length, 1, marker + ' must initialize once');
  }
  for (const node of doc.querySelectorAll('script[src],link[rel="stylesheet"][href]')) {
    const resource = node.getAttribute('src') || node.getAttribute('href');
    if (/^(https?:|data:|\/\/)/.test(resource)) continue;
    assert.ok(fs.existsSync(path.resolve(site, resource.split('?')[0])), 'Missing ' + resource);
  }
  const record = JSON.parse(fs.readFileSync(path.join(site, 'resolved-repos.json'), 'utf8'));
  assert.deepEqual(Object.keys(record.repositories).sort(), ['ai-feedback', 'math-exercise', 'py-exercise', 'pyodide-interaktiv']);
  assert.equal(panels[2].querySelectorAll('.math-exercise-cell').length, 5);
  assert.equal(record.repositories['math-exercise'].branch, 'feature/shared-feedback-integration');
  const python = record.repositories['py-exercise'];
  assert.equal(python.branch, 'feature/shared-feedback-integration');
  if (!python.local_override && !record.refresh) {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'repos.json'), 'utf8'));
    assert.equal(python.commit, manifest.repositories['py-exercise'].commit);
  }
  assert.ok(record.extension_sha256['py-exercise']['py-exercise-feedback.js']);
  for (const [name, source] of Object.entries(record.repositories)) {
    assert.match(source.commit, /^[0-9a-f]{40}$/);
    assert.ok(Object.keys(record.extension_sha256[name]).length > 0);
  }
  dom.window.close();
});

test('shared text feedback works on the combined page without running Python or making API calls', async () => {
  const dom = new JSDOM(html, {url: 'https://integration.invalid/', runScripts: 'outside-only'});
  const w = dom.window;
  w.AbortController = AbortController;
  w.fetch = () => { throw new Error('Copy mode must not call a provider'); };
  for (const name of ['feedback-core.js', 'feedback-dom.js', 'ai-feedback.js']) {
    const script = [...w.document.scripts].find(s => s.src.endsWith('/' + name));
    w.eval(fs.readFileSync(path.resolve(site, script.getAttribute('src')), 'utf8'));
  }
  w.AIFeedback.initialize();
  const activity = w.document.querySelector('#spanish-writing');
  activity.querySelector('button').click();
  for (let i = 0; i < 20 && !activity.querySelector('pre'); i++) await new Promise(resolve => setImmediate(resolve));
  assert.match(activity.querySelector('pre').textContent, /Yo vive en Trondheim/);
  assert.doesNotMatch(activity.querySelector('pre').textContent, /assert add|submissionKey|integration-math/);
  assert.equal(w.document.querySelectorAll('dialog.ai-feedback-settings').length, 1);
  dom.window.close();
});

test('mathematics feedback excludes the author note from learning context', () => {
  const dom = new JSDOM(html, {url: 'https://integration.invalid/', runScripts: 'outside-only'});
  const w = dom.window;
  w.__mathExerciseTestMode = true;
  // Exercise the real resolver/prompt builder without starting consumer runtimes.
  w.document.addEventListener = () => {};
  const bundle = [...w.document.scripts].find(s => s.textContent.includes('var ME_CFG ='));
  w.eval(bundle.textContent);
  const cell = w.document.querySelector('.math-exercise-cell');
  const api = w.__mathExerciseTestApi;
  assert.equal(cell.dataset.contextMode, 'none');
  assert.equal(api.resolveContexts(cell).length, 0);
  const question = api.questionText(cell, [], () => 'Answer');
  const prompt = api.buildUserPrompt(question, '42', '', api.resolveContexts(cell));
  assert.match(prompt, /6.*7/);
  assert.match(prompt, /42/);
  assert.doesNotMatch(prompt, /For course authors|Feature:|shared adapter|legacy settings|learning_context/);
  dom.window.close();
});

test('Python practice keeps five incomplete starters and their tasks separate from author notes', () => {
  const dom = new JSDOM(html, {runScripts: 'outside-only'});
  const w = dom.window;
  // Only the declarative exercise data is evaluated, not the Python runtime.
  for (const script of w.document.scripts) {
    if (script.textContent.trim().startsWith('(window.__pyExercises =')) w.eval(script.textContent);
  }
  assert.equal(w.__pyExercises.length, 6);
  const practice = w.__pyExercises.filter(x => x.label.startsWith('practice-'));
  assert.equal(practice.length, 5);
  assert.equal(new Set(w.__pyExercises.map(x => x.label)).size, 6);
  assert.equal(w.document.querySelectorAll('.example-learner-task:has(.py-exercise-cell)').length, 5);
  for (const task of w.document.querySelectorAll('.example-learner-task:has(.py-exercise-cell)')) {
    assert.equal(task.querySelectorAll('.py-exercise-cell').length, 1);
    assert.equal(task.querySelectorAll('.example-author-notes').length, 0);
    const prose = task.cloneNode(true);
    prose.querySelectorAll('script').forEach(s => s.remove());
    assert.doesNotMatch(prose.textContent, /For course authors|Feature:|shared.feedback adapter|assert /);
  }
  for (const data of practice) {
    assert.ok(data.task.length > 30, 'Feedback needs the actual assignment');
    assert.match(data.starter, /def \w+\(/);
    assert.match(data.starter, /TODO/);
    assert.doesNotMatch(data.starter, /## TESTS ##|assert /);
    assert.match(data.tests, /assert /);
  }
  for (const node of w.document.querySelectorAll('a[href$=".html"]')) {
    const href = node.getAttribute('href');
    if (/^https?:/.test(href)) continue;
    assert.ok(fs.existsSync(path.resolve(site, href)), 'Missing page: ' + href);
  }
  dom.window.close();
});

test('standalone math and both shared-filter orders load one usable runtime', async () => {
  const {spawnSync} = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(path.dirname(site), 'filter-order-'));
  try {
    const source = path.join(path.dirname(site), '_extensions');
    fs.cpSync(path.join(source, 'math-exercise'), path.join(dir, '_extensions/math-exercise'), {recursive: true});
    fs.cpSync(path.join(source, 'ai-feedback'), path.join(dir, '_extensions/ai-feedback'), {recursive: true});
    for (const [i, filters] of [['math-exercise'], ['ai-feedback', 'math-exercise'], ['math-exercise', 'ai-feedback'], ['ai-feedback', 'math-exercise'], ['math-exercise', 'ai-feedback']].entries()) {
      if (i === 3) {
        // Simulate the previously released explicit dependency and callback contract.
        for (const name of ['ai-feedback.lua', 'feedback-core.js', 'ai-feedback.js']) {
          const file = path.join(dir, '_extensions/ai-feedback', name);
          fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('0.2.0', '0.1.0').replace('await getRequest({ hintLevel })', 'await getRequest()'));
        }
      }
      fs.writeFileSync(path.join(dir, `order-${i}.qmd`), `---\nformat: html\nfilters: [${filters.join(', ')}]\n---\n\n::: {#context .ai-context}\nUse $x^2$.\n:::\n\n\x60\x60\x60{math-exercise}\n#| label: order\n#| context: context\nCompute $2+2$: _[SECRET_ANSWER]\n\x60\x60\x60\n`);
      const render = spawnSync(process.env.QUARTO_BIN || 'quarto', ['render', `order-${i}.qmd`], {cwd: dir, encoding: 'utf8', timeout: 120000});
      assert.equal(render.status, 0, render.stderr);
      const dom = new JSDOM(fs.readFileSync(path.join(dir, `order-${i}.html`), 'utf8'), {url: 'https://order.invalid/', runScripts: 'outside-only'});
      const w = dom.window; w.document.addEventListener = () => {}; w.__mathExerciseTestMode = true;
      for (const name of ['feedback-core.js', 'feedback-dom.js', 'ai-feedback.js']) {
        const scripts = [...w.document.scripts].filter(s => s.src.endsWith('/' + name));
        assert.equal(scripts.length, 1, `${filters}: ${name}`);
        w.eval(fs.readFileSync(path.join(dir, scripts[0].getAttribute('src')), 'utf8'));
      }
      if (i < 3) assert.equal(w.AIFeedback.version, '0.2.0');
      w.AIFeedback.initialize();
      const math = [...w.document.scripts].find(s => s.textContent.includes('var ME_CFG ='));
      w.eval(math.textContent);
      const cell = w.document.querySelector('.math-exercise-cell');
      w.__mathExerciseTestApi.setupCell(cell); cell.querySelector('.math-input').value = '3';
      if (w.AIFeedback.version === '0.1.0') {
        assert.ok(cell.querySelector('.math-feedback-btn').disabled);
        assert.match(cell.querySelector('.ai-feedback-output').textContent, /Update.*ai-feedback/);
        assert.equal(cell.querySelector('.math-check-btn').disabled, false);
        dom.window.close(); continue;
      }
      cell.querySelector('.math-feedback-btn').click();
      for (let n = 0; n < 30 && !cell.querySelector('pre'); n++) await new Promise(resolve => setImmediate(resolve));
      const prompt = cell.querySelector('pre')?.textContent;
      assert.ok(prompt, filters.join(', ')); assert.match(prompt, /x\^2/); assert.doesNotMatch(prompt, /SECRET_ANSWER/);
      w.AIFeedback.openSettings();
      assert.equal(w.document.querySelectorAll('dialog.ai-feedback-settings').length, 1);
      dom.window.close();
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
