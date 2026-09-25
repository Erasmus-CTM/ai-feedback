const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const target = path.join(__dirname, '../_site/examples.html');
test('rendered examples load the runtime once and produce real copy prompts', { skip: !fs.existsSync(target) }, async () => {
  const dom = new JSDOM(fs.readFileSync(target, 'utf8'), { url: 'https://example.invalid/examples.html', runScripts: 'outside-only' });
  const w = dom.window; w.AbortController = AbortController;
  w.fetch = () => { throw new Error('Examples start without network calls.'); };
  w.__aiFeedbackConfig = { mode: 'copy', storage: 'session' };
  for (const file of ['feedback-core.js', 'feedback-dom.js', 'ai-feedback.js']) {
    assert.equal([...w.document.scripts].filter(s => s.src.endsWith('/' + file)).length, 1);
    w.eval(fs.readFileSync(path.join(__dirname, '../_extensions/ai-feedback', file), 'utf8'));
  }
  w.AIFeedback.initialize();
  const activities = [...w.document.querySelectorAll('.ai-feedback-activity')];
  assert.equal(activities.length, 6);
  for (const activity of activities) {
    const text = activity.querySelector('textarea');
    text.value ||= 'Esta es mi respuesta.';
    const trigger = [...activity.querySelectorAll('button')].find(b => b.textContent === 'Feedback');
    trigger.click();
    for (let i = 0; i < 10 && trigger.disabled; i++) await new Promise(resolve => setImmediate(resolve));
    const prompt = activity.querySelector('pre');
    assert.ok(prompt, activity.id + ': ' + activity.querySelector('.ai-feedback-output').textContent);
    assert.match(prompt.textContent, /USER/);
  }
  const translated = activities[1].querySelector('pre').textContent;
  assert.match(translated, /Maria walks/);
  const alias = activities[2].querySelector('pre').textContent;
  assert.match(alias, /agrees in gender/);
  assert.match(alias, /explanations in nb/);
  const multilingual = w.document.querySelector('#german-to-norwegian pre').textContent;
  assert.match(multilingual, /Am Samstag/);
  assert.match(multilingual, /\"role\":\"source\"/);
  assert.match(multilingual, /\"language\":\"de\"/);
  assert.match(multilingual, /\"language\":\"nb\"/);
  assert.match(multilingual, /explanations in en/);
  const handwriting = w.document.querySelector('#handwriting');
  const upload = handwriting.querySelector('input[type=file]');
  const bytes = Buffer.from(require('./fixtures.cjs').png.split(',')[1], 'base64');
  Object.defineProperty(upload, 'files', { configurable: true, value: [new w.File([bytes], 'spanish.png', { type: 'image/png' })] });
  upload.dispatchEvent(new w.Event('change'));
  handwriting.querySelector('textarea').value = '';
  const imageTrigger = [...handwriting.querySelectorAll('button')].find(b => b.textContent === 'Feedback');
  imageTrigger.click();
  for (let i = 0; i < 40 && imageTrigger.disabled; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.match(handwriting.querySelector('pre').textContent, /ATTACH THE ORIGINAL IMAGES/);
  assert.equal(handwriting.querySelectorAll('.ai-feedback-images img').length, 1);
  assert.equal(w.document.querySelectorAll('.ai-feedback-gear').length, 6);
  w.close();
});
