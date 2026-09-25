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
