// Step 6 L6: additive settings/catalogue/feedback and one shared matrix editor.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const C = require('./helpers/ctm-libs.cjs');
const F = require('../_extensions/ctm-libs/feedback/feedback-core.js');
const plain = value => JSON.parse(JSON.stringify(value));

test('STACK catalogue resolves every supported language without missing-key fallback', () => {
  const warnings = [], context = vm.createContext({console: {warn: text => warnings.push(text)}});
  for (const file of ['ctm-locale.js', 'ctm-stack.js'])
    vm.runInContext(fs.readFileSync(path.join(C.library, 'locales', file), 'utf8'), context);
  const L = context.CTMLocales;
  assert.deepEqual(plain(L.languages('ctm-stack')), ['en', 'nb', 'nn', 'de', 'sv', 'da']);
  const english = L.table('ctm-stack', 'en');
  for (const lang of L.languages('ctm-stack')) {
    const messages = L.table('ctm-stack', lang);
    assert.deepEqual(Object.keys(messages), Object.keys(english));
    assert.equal(typeof messages.checkButton, 'string');
    assert.equal(typeof messages.ATSets_wrongentries, 'function');
    assert.ok(messages.ATSets_wrongentries('\\(x\\)').includes('\\(x\\)'));
  }
  assert.equal(L.resolve('ctm-stack', 'nn-NO'), 'nn');
  assert.equal(L.resolve('ctm-stack', 'no'), 'nb');
  assert.equal(english.validateButton, 'Validate answers');
  assert.equal(english.checkButton, 'Check answer');
  assert.equal(english.interpretedAs('x^2'), 'Interpreted as \\(x^2\\)');
  assert.equal(english.checking('SymPy'), 'Checking with SymPy…');
  assert.deepEqual(warnings, []);
});

test('STACK starts with the exact mathematical feedback policy and can diverge independently', () => {
  for (const lang of ['en', 'nb', 'nn', 'de', 'sv', 'da'])
    assert.deepEqual(F.resolvePolicy('stack', lang), F.resolvePolicy('math-exercise', lang));
  const config = {layers: [{policies: {brief: {'max-words': 60}}}], projectPolicy: {stack: 'brief'}};
  assert.equal(F.resolvePolicy('stack', 'en', {}, config)['max-words'], 60);
  assert.equal(F.resolvePolicy('math-exercise', 'en', {}, config)['max-words'], 120);
});

test('Lua resolves stack settings key by key, keeps language precedence, and emits one shared matrix dependency',
  {skip: C.hasQuarto ? false : 'Quarto required'}, () => {
    const dir = C.tempdir('ctm-stack-shared-');
    try {
      C.installPackage(dir); C.install(dir); C.installProbe(dir);
      C.write(dir, {
        '_quarto.yml': 'project:\n  type: default\n  render: [own.qmd, shared.qmd]\nfilters: [ctm-libs, probe]\nlang: de\nctm-assessment:\n  lang: nn\nstack:\n  cas: sympy\n  feedback: auto\n  stop-after: 7\n',
        'own.qmd': '---\ntitle: own\nstack:\n  lang: nb-NO\n  feedback: false\n---\n' + C.probe('stack',
          'ctm.locale.use("ctm-stack"); ctm.matrix.use(); ctm.matrix.use(); local limit = ctm.settings.number("stack", "stop-after"); return {ctm.locale.resolve("ctm-stack"), ctm.settings.string("stack", "cas"), ctm.settings.bool("stack", "feedback"), limit}'),
        'shared.qmd': '---\ntitle: shared\n---\n' + C.probe('stack',
          'return {ctm.locale.resolve("ctm-stack")}'),
      });
      const result = C.render(dir);
      assert.equal(result.status, 0, result.stderr);
      const own = C.html(dir, 'own.qmd');
      assert.deepEqual(C.probes(own).stack, ['nb', 'sympy', false, 7]);
      assert.deepEqual(C.probes(C.html(dir, 'shared.qmd')).stack, ['nn', 'nn', '_quarto.yml']);
      assert.equal((own.match(/<script src="[^"]*\/ctm-matrix-input-[^"]*\/ctm-matrix-input\.js"><\/script>/g) || []).length, 1);
      assert.equal((own.match(/<link href="[^"]*\/ctm-matrix-input-[^"]*\/ctm-matrix-input\.css" rel="stylesheet">/g) || []).length, 1);
      assert.match(own, /ctm-locale-ctm-stack-[^/]+\/ctm-stack\.js/);
      assert.doesNotMatch(result.stderr, /WARNING/);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  });
