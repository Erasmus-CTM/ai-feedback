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
test('feedback preserves inline/display TeX through Markdown and leaves code literal', () => {
  const {F, w} = page();
  const el = w.document.createElement('div');
  el.innerHTML = F.renderMarkdown(String.raw`Area $\pi \times r^2$, not $\pi \times r$. Also \(x_1 * x_2\).

$$
\begin{aligned}a &= b \\ c &= d\end{aligned}
$$

\[y = |x|\]

Code: \`$literal$\`.

\`\`\`python
print("$not_math$")
\`\`\`

**Keep prose bold.** <img src=x onerror=alert(1)>`.replace(/\\`/g, '`'));
  const math = [...el.querySelectorAll('.ai-feedback-math')];
  assert.equal(math.length, 5);
  assert.equal(math[0].dataset.tex, String.raw`\pi \times r^2`);
  assert.equal(math[2].dataset.tex, 'x_1 * x_2');
  assert.equal(math[3].dataset.display, 'true');
  assert.match(math[3].dataset.tex, /begin\{aligned\}/);
  assert.equal(math[4].dataset.tex, 'y = |x|');
  assert.equal(el.querySelector('code').textContent, '$literal$');
  assert.equal(el.querySelector('pre code').textContent, 'print("$not_math$")');
  assert.equal(el.querySelector('strong').textContent, 'Keep prose bold.');
  assert.equal(el.querySelector('img'), null);
  w.close();
});
test('shared attach typesets feedback after insertion but never typesets copy prompts', async () => {
  const {F, w} = page('<button>Feedback</button><div id="out"></div>');
  let calls = 0;
  F.typesetFeedback = async body => { calls++; assert.ok(body.isConnected); assert.equal(body.querySelector('.ai-feedback-math').dataset.tex, 'r^2'); };
  const options = {button: w.document.querySelector('button'), output: w.document.querySelector('#out'), getRequest: () => fixtures.writing};
  const api = F.attach({...options, client: {request: async () => ({text: '$r^2$', format: 'markdown'})}});
  await api.request(); assert.equal(calls, 1); api.dispose();
  const copy = F.attach(options); await copy.request(); assert.equal(calls, 1); copy.dispose(); w.close();
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

test('cancel during the final async snapshot prevents rendering and hint advancement', async () => {
  const {F, w} = page('<button>Feedback</button><div id="out"></div>');
  let calls = 0, finish;
  const request = structuredClone(fixtures.mathematics);
  const adapter = F.attach({id: 'cancel-snapshot', button: w.document.querySelector('button'), output: w.document.querySelector('#out'),
    getRequest: () => ++calls === 1 ? request : new Promise(resolve => {finish = resolve;}),
    client: {request: async () => ({text: 'OLD FEEDBACK', format: 'markdown'})}});
  const pending = adapter.request(); await new Promise(resolve => setImmediate(resolve));
  adapter.cancel(); finish(request); await pending;
  assert.doesNotMatch(w.document.querySelector('#out').textContent, /OLD FEEDBACK/);
  assert.equal(w.sessionStorage.getItem('ai-feedback-hints|/course|cancel-snapshot'), null);
  adapter.dispose(); w.close();
});

test('feedback policy changes make a pending response stale', async () => {
  const {F, w} = page('<button>Feedback</button><div id="out"></div>');
  let request = structuredClone(fixtures.mathematics), finish;
  const adapter = F.attach({id: 'policy', button: w.document.querySelector('button'), output: w.document.querySelector('#out'), getRequest: () => request,
    client: {request: () => new Promise(resolve => {finish = resolve;})}});
  const pending = adapter.request(); await new Promise(resolve => setImmediate(resolve));
  request = {...request, feedback: {...request.feedback, language: 'en'}};
  finish({text: 'OLD FEEDBACK', format: 'markdown'}); await pending;
  assert.match(w.document.querySelector('#out').textContent, /changed/);
  assert.equal(w.sessionStorage.getItem('ai-feedback-hints|/course|policy'), null);
  adapter.dispose(); w.close();
});

test('cancelling while math is typesetting does not consume a hint', async () => {
  const {F, w} = page('<button>Feedback</button><div id="out"></div>');
  let finish;
  F.typesetFeedback = () => new Promise(resolve => {finish = resolve;});
  const adapter = F.attach({id: 'typeset', button: w.document.querySelector('button'), output: w.document.querySelector('#out'), getRequest: () => fixtures.mathematics,
    client: {request: async () => ({text: '$x^2$', format: 'markdown'})}});
  const pending = adapter.request(); await new Promise(resolve => setImmediate(resolve));
  adapter.cancel(); finish(); await pending;
  assert.equal(w.sessionStorage.getItem('ai-feedback-hints|/course|typeset'), null);
  assert.equal(w.document.querySelector('#out .ai-feedback-body'), null);
  adapter.dispose(); w.close();
});
