const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const target = path.join(process.env.CTM_INTEGRATION_SITE || path.join(__dirname, '../.feedback-workspace/site/_site'), 'examples.html');
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
  const notes = [...w.document.querySelectorAll('.example-author-notes')];
  assert.equal(notes.length, 17);
  assert.ok(notes.every(note => !note.closest('.ai-feedback-activity')));
  const download = w.document.querySelector('#handwriting-sample-download');
  assert.ok(download.hasAttribute('download'));
  const samplePath = path.resolve(path.dirname(target), download.getAttribute('href'));
  const sample = fs.readFileSync(samplePath);
  assert.deepEqual(sample, fs.readFileSync(path.join(__dirname, '../assets/spanish-handwriting.png')));
  assert.equal(sample.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(sample.length < 8 * 1024 * 1024);
  for (const activity of activities) {
    const data = JSON.parse(activity.querySelector('script.ai-feedback-data').textContent);
    assert.match(data.task, /^Your task\n\n/);
    assert.doesNotMatch(data.task, /Feedback focus/);
    const learnerContent = activity.cloneNode(true);
    learnerContent.querySelectorAll('script').forEach(script => script.remove());
    assert.equal(learnerContent.querySelectorAll('.feedback-criteria').length, 0);
    for (const criterion of data.criteria || []) {
      assert.ok(!learnerContent.textContent.includes(criterion), activity.id + ': reviewer guidance is visible');
      assert.ok(!data.task.includes(criterion), activity.id + ': reviewer guidance leaked into the task');
    }
    assert.notEqual(data.contextMode, 'auto', activity.id + ': author notes must not become automatic context');
    const text = activity.querySelector('textarea');
    text.value ||= 'Esta es mi respuesta.';
    const trigger = [...activity.querySelectorAll('button')].find(b => b.textContent === 'Feedback');
    trigger.click();
    for (let i = 0; i < 10 && trigger.disabled; i++) await new Promise(resolve => setImmediate(resolve));
    const prompt = activity.querySelector('pre');
    assert.ok(prompt, activity.id + ': ' + activity.querySelector('.ai-feedback-output').textContent);
    assert.match(prompt.textContent, /USER/);
    for (const criterion of data.criteria || []) {
      assert.ok(prompt.textContent.includes(criterion), activity.id + ': reviewer guidance was lost');
    }
    assert.doesNotMatch(prompt.textContent, /For course authors|Feature:|deliberate beginner|downloadable|two deliberate/);
    for (const note of notes) {
      for (const paragraph of note.querySelectorAll('p')) {
        const prose = paragraph.textContent.trim().replace(/\s+/g, ' ');
        if (prose.length > 30) assert.ok(!prompt.textContent.replace(/\s+/g, ' ').includes(prose), activity.id + ': author explanation leaked');
      }
    }
  }
  const writingData = JSON.parse(activities[0].querySelector('script.ai-feedback-data').textContent);
  assert.equal(writingData.criteria.length, 2, 'All author criteria blocks must be retained');
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
  Object.defineProperty(upload, 'files', { configurable: true, value: [new w.File([sample], 'spanish-handwriting.png', { type: 'image/png' })] });
  upload.dispatchEvent(new w.Event('change'));
  handwriting.querySelector('textarea').value = '';
  const imageTrigger = [...handwriting.querySelectorAll('button')].find(b => b.textContent === 'Feedback');
  imageTrigger.click();
  for (let i = 0; i < 40 && imageTrigger.disabled; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.match(handwriting.querySelector('pre').textContent, /ATTACH THE ORIGINAL IMAGES/);
  assert.equal(handwriting.querySelectorAll('.ai-feedback-images img').length, 1);
  // Exercise the same public button in API mode and inspect the outgoing image.
  let sent;
  w.fetch = async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'Check the verb endings.' } }] }) };
  };
  w.AIFeedback.saveConfig({ mode: 'api', storage: 'session', baseUrl: 'https://provider.invalid/v1', model: 'vision-test', apiKey: 'test-only' });
  imageTrigger.click();
  for (let i = 0; i < 40 && imageTrigger.disabled; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(sent.url, 'https://provider.invalid/v1/chat/completions');
  const content = sent.body.messages[1].content;
  assert.match(sent.body.messages[0].content, /If a word is unreadable, say so instead of guessing/);
  assert.doesNotMatch(JSON.parse(content.find(part => part.type === 'text').text).task, /unreadable|rewrite the whole/);
  assert.equal(content.find(part => part.type === 'image_url').image_url.url, 'data:image/png;base64,' + sample.toString('base64'));
  assert.doesNotMatch(content.find(part => part.type === 'text').text, /For course authors|two deliberate|Me llamo Ana|Yo vive en Trondheim|Me gusta los libros/);
  assert.match(handwriting.querySelector('.ai-feedback-body').textContent, /Check the verb endings/);
  assert.equal(w.document.querySelectorAll('.ai-feedback-gear').length, 6);
  w.close();
});
