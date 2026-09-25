const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const site = process.env.CTM_INTEGRATION_SITE;
assert.ok(site, 'Run scripts/setup-feedback-integration.py --test first.');
const html = fs.readFileSync(path.join(site, 'examples.html'), 'utf8');

test('common page renders all four extensions and keeps local dependencies resolvable', () => {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.ai-feedback-activity').length, 6);
  assert.equal(doc.querySelectorAll('.math-exercise-cell').length, 1);
  assert.equal(doc.querySelectorAll('.py-exercise-cell').length, 1);
  assert.equal(doc.querySelectorAll('[id^="qpyodide-insertion-location-"]').length, 1);
  for (const name of ['feedback-core.js', 'feedback-dom.js', 'ai-feedback.js']) {
    assert.equal([...doc.scripts].filter(s => s.src.endsWith('/' + name)).length, 1, name + ' must load once');
  }
  for (const marker of ['var ME_CFG =', 'function setupExercise(exerciseData)', 'const qpyodideWorkerSource =']) {
    assert.equal([...doc.scripts].filter(s => s.textContent.includes(marker)).length, 1, marker + ' must initialize once');
  }
  for (const node of doc.querySelectorAll('script[src],link[rel="stylesheet"][href]')) {
    const resource = node.getAttribute('src') || node.getAttribute('href');
    if (/^(https?:|data:|\/\/)/.test(resource)) continue;
    assert.ok(fs.existsSync(path.resolve(site, resource.split('?')[0])), 'Missing ' + resource);
  }
  const record = JSON.parse(fs.readFileSync(path.join(site, 'resolved-repos.json'), 'utf8'));
  assert.deepEqual(Object.keys(record.repositories).sort(), ['ai-feedback', 'math-exercise', 'py-exercise', 'pyodide-interaktiv']);
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
  const dom = new JSDOM(fs.readFileSync(path.join(site, 'py-exercise-examples.html'), 'utf8'), {runScripts: 'outside-only'});
  const w = dom.window;
  // Only the declarative exercise data is evaluated, not the Python runtime.
  for (const script of w.document.scripts) {
    if (script.textContent.trim().startsWith('(window.__pyExercises =')) w.eval(script.textContent);
  }
  assert.equal(w.__pyExercises.length, 5);
  assert.equal(new Set(w.__pyExercises.map(x => x.label)).size, 5);
  assert.equal(w.document.querySelectorAll('.example-learner-task').length, 5);
  for (const task of w.document.querySelectorAll('.example-learner-task')) {
    assert.equal(task.querySelectorAll('.py-exercise-cell').length, 1);
    assert.equal(task.querySelectorAll('.example-author-notes').length, 0);
    const prose = task.cloneNode(true);
    prose.querySelectorAll('script').forEach(s => s.remove());
    assert.doesNotMatch(prose.textContent, /For course authors|Feature:|shared.feedback adapter|assert /);
  }
  for (const data of w.__pyExercises) {
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
