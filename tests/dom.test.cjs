const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const fixtures = require('./fixtures.cjs');
function page(html = '') {
  const dom = new JSDOM('<main>' + html + '</main>', { url: 'https://example.invalid/course', runScripts: 'outside-only' });
  const w = dom.window;
  w.AbortController = AbortController;
  for (const file of ['feedback-core.js', 'feedback-dom.js', 'ai-feedback.js']) w.eval(fs.readFileSync(path.join(__dirname, '../_extensions/ai-feedback', file), 'utf8'));
  return { dom, w, F: w.AIFeedback };
}
test('canonical and legacy contexts deduplicate and preserve LaTeX source', () => {
  const { w, F } = page('<div id="a" class="ai-feedback-context math-exercise-context">Area <span data-ai-feedback-tex="r^2">garbled</span><span hidden>secret</span><textarea>draft</textarea></div><div id="b" class="math-exercise-context">Legacy</div>');
  const contexts = F.collectExplicitContexts('a,b,a');
  assert.equal(contexts.length, 2); assert.match(contexts[0].content, /\\\(r\^2\\\)/); assert.doesNotMatch(contexts[0].content, /garbled|secret|draft/);
  w.close();
});
test('Markdown rendering never activates model HTML', () => {
  const { F, w } = page();
  const el = w.document.createElement('div'); el.innerHTML = F.renderMarkdown('<img src=x onerror=alert(1)> **word**');
  assert.equal(el.querySelector('img'), null); assert.equal(el.querySelector('strong').textContent, 'word'); w.close();
});
test('attach discards responses for edited work and failed requests do not advance hints', async () => {
  const { F, w } = page('<button>Feedback</button><div id="out"></div>');
  let request = structuredClone(fixtures.mathematics), finish;
  const adapter = F.attach({ id: 'exercise', button: w.document.querySelector('button'), output: w.document.querySelector('#out'), getRequest: () => request,
    client: { request: () => new Promise(resolve => { finish = resolve; }) } });
  const pending = adapter.request(); await new Promise(resolve => setImmediate(resolve));
  request = { ...request, task: 'Changed task' }; finish({ text: 'Old feedback.', format: 'markdown' }); await pending;
  assert.match(w.document.querySelector('#out').textContent, /changed/);
  assert.equal(w.sessionStorage.getItem('ai-feedback-hints|/course|exercise'), null);
  adapter.dispose(); w.close();
});
test('copy-mode attachment needs no API call and advances hints only after display', async () => {
  const { F, w } = page('<button>Feedback</button><div id="out"></div>');
  w.fetch = () => { throw new Error('No API call expected.'); };
  const adapter = F.attach({ id: 'exercise', button: w.document.querySelector('button'), output: w.document.querySelector('#out'), getRequest: () => fixtures.mathematics });
  await adapter.request();
  assert.match(w.document.querySelector('pre').textContent, /diagnostic question/);
  assert.equal(w.sessionStorage.getItem('ai-feedback-hints|/course|exercise'), '1');
  adapter.dispose(); w.close();
});
test('saved credentials stay out of prompts and legacy configs require explicit migration', () => {
  const { F, w } = page();
  w.localStorage.setItem('math-exercise-llm-config', JSON.stringify({ baseUrl: 'https://old.invalid', apiKey: 'secret' }));
  assert.equal(F.loadConfig().apiKey, '');
  F.buildSettings(); assert.match(w.document.body.textContent, /math-exercise/);
  assert.doesNotMatch(F.buildPrompt(fixtures.writing), /secret/); w.close();
});
test('all cogwheels open one shared dialog and saved settings are website-wide', () => {
  const { F, w } = page();
  const first = F.settingsButton(), second = F.settingsButton();
  w.document.body.append(first, second); first.click(); second.click();
  assert.equal(w.document.querySelectorAll('dialog.ai-feedback-settings').length, 1);
  F.saveConfig({ baseUrl: 'https://institution.invalid/v1', model: 'institution-model', apiKey: 'private-test-key', storage: 'local', mode: 'api' });
  assert.equal(JSON.parse(w.localStorage.getItem('ai-feedback-config-v1')).model, 'institution-model');
  w.localStorage.setItem('ai-feedback-config-v1', JSON.stringify({ model: 'changed-in-another-tab' }));
  assert.equal(F.loadConfig().model, 'changed-in-another-tab');
  w.close();
});
