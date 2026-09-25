const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const site = process.env.CTM_INTEGRATION_SITE || path.join(__dirname, '../.feedback-workspace/site/_site');
const adapterFile = path.resolve(site, '../_extensions/py-exercise/py-exercise-feedback.js');

test('Python adapter sends current code and allowlisted code-matched evidence without execution', {skip: !fs.existsSync(adapterFile)}, async () => {
  const dom = new JSDOM('<div id="cell"><div id="buttons"></div></div>', {url: 'https://example.invalid/examples.html', runScripts: 'outside-only'});
  const w = dom.window;
  w.AbortController = AbortController;
  w.fetch = () => { throw new Error('Copy feedback must not call a provider'); };
  w.mainPyodide = {runPythonAsync() { throw new Error('Feedback must not execute Python'); }};
  for (const name of ['feedback-core.js', 'feedback-dom.js', 'ai-feedback.js']) w.eval(fs.readFileSync(path.join(__dirname, '../_extensions/ai-feedback', name), 'utf8'));
  w.eval(fs.readFileSync(adapterFile, 'utf8'));
  let code = 'def total(values):\n    return 0';
  let assessment = null;
  const adapter = w.PyExerciseFeedback.attach({
    container: w.document.querySelector('#cell'), buttonBar: w.document.querySelector('#buttons'),
    label: 'sum', uiLanguage: 'en', feedbackLanguage: 'en', learnerLevel: 'Introductory Python',
    task: 'Return the total using a loop.', forbiddenImports: ['os'], forbiddenKeywords: ['sum'],
    getCode: () => code, getAssessment: () => assessment,
    tests: 'SECRET_TEST_SOURCE', submissionKey: 'SECRET_SUBMISSION_KEY'
  });
  const button = w.document.querySelector('.py-exercise-feedback');
  async function prompt() {
    button.click();
    for (let i = 0; i < 20 && button.disabled; i++) await new Promise(resolve => setImmediate(resolve));
    return w.document.querySelector('.py-exercise-feedback-output pre').textContent;
  }
  let text = await prompt();
  assert.match(text, /Return the total using a loop/);
  assert.match(text, /Do not use: sum/);
  assert.match(text, /Do not import: os/);
  assert.match(text, /"evidence":\[\]/);
  assessment = {code, result: {status: 'checked', passed: 1, total: 3, stdout: 'learner output', tests: 'SECRET_TEST_SOURCE', messages: ['SECRET_ASSERTION'], traceback: 'SECRET_TRACEBACK'}};
  text = await prompt();
  assert.match(text, /1 of 3/);
  assert.match(text, /learner output/);
  assert.doesNotMatch(text, /SECRET_/);
  code += '\n# changed';
  text = await prompt();
  assert.match(text, /changed/);
  assert.match(text, /"evidence":\[\]/);
  assert.doesNotMatch(text, /learner output|1 of 3/);
  adapter.invalidate();
  assert.equal(w.document.querySelector('.py-exercise-feedback-output').textContent, '');
  w.document.querySelector('.ai-feedback-gear').click();
  assert.equal(w.document.querySelectorAll('dialog.ai-feedback-settings[open]').length, 1);
  adapter.dispose();
  w.close();
});
