// Generic named catalogue arguments share the existing compiler and resolver.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const C = require('./helpers/ctm-libs.cjs');

function runtime() {
  const warnings = [], context = vm.createContext({console: {warn: text => warnings.push(text)}});
  vm.runInContext(fs.readFileSync(path.join(C.library, 'locales/ctm-locale.js'), 'utf8'), context);
  const L = context.CTMLocales;
  L.add('sample', {$languages: ['en', 'de'], en: {
    pair: {$t: '{left} / {right}', $args: ['left', 'right']},
    count: {$args: ['n', 'item'], $plural: 'n', one: '{n} {item}', other: '{n} {item}s'},
    forms: {fraction: 'one fraction', '*': 'the requested form'},
    form: {$t: 'Use {form}.', $args: ['form'], $lookup: {form: 'forms'}},
    plain: 'Plain text.',
  }, de: {
    pair: {$t: '{right} vor {left}', $args: ['left', 'right']},
    count: {$args: ['n', 'item'], $plural: 'n', one: '{n} {item}', other: '{n} {item}s'},
    forms: {fraction: 'ein Bruch', '*': 'die verlangte Form'},
    form: {$t: 'Nutze {form}.', $args: ['form'], $lookup: {form: 'forms'}},
  }});
  L.add('refs', {$languages: ['en', 'de'], en: {
    pair: {$ref: 'sample.pair'}, count: {$ref: 'sample.count'}, form: {$ref: 'sample.form'},
  }, de: {
    pair: {$ref: 'sample.pair'}, count: {$ref: 'sample.count'}, form: {$ref: 'sample.form'},
  }});
  return {L, warnings};
}

test('named arguments use declared order while t and table stay positional', () => {
  const {L} = runtime();
  const args = {right: 'R', left: 'L'};
  assert.equal(L.format('sample', 'pair', 'en', args), 'L / R');
  assert.equal(L.format('sample', 'pair', 'de-CH', args), 'R vor L');
  assert.equal(L.t('sample', 'pair', 'en', 'L', 'R'), 'L / R');
  assert.equal(L.table('sample', 'en').pair('L', 'R'), 'L / R');
  assert.equal(L.format('sample', 'pair', 'en', {right: '<b>x</b>', left: '\\(y\\)'}), '\\(y\\) / <b>x</b>');
  assert.deepEqual(args, {right: 'R', left: 'L'});
});

test('refs, plurals, lookups and English fallback use the existing resolver', () => {
  const {L, warnings} = runtime();
  assert.equal(L.format('refs', 'pair', 'de', {right: 'B', left: 'A'}), 'B vor A');
  assert.equal(L.format('refs', 'count', 'en', {item: 'row', n: 1}), '1 row');
  assert.equal(L.format('refs', 'count', 'en', {item: 'row', n: 2}), '2 rows');
  assert.equal(L.format('refs', 'form', 'de', {form: 'fraction'}), 'Nutze ein Bruch.');
  assert.equal(L.format('refs', 'form', 'en', {form: 'unknown'}), 'Use the requested form.');
  assert.equal(L.format('sample', 'plain', 'de'), 'Plain text.');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /plain.*using English/);
});

test('unknown keys permit producer fallback and re-registration refreshes named templates', () => {
  const {L} = runtime();
  for (const key of ['missing', 'constructor', '__proto__'])
    assert.equal(L.format('sample', key, 'en', {}), undefined);
  assert.throws(() => L.format('sample', 'pair', 'en', ['L', 'R']), /named argument object/);
  assert.throws(() => L.format('sample', 'pair', 'en', 'L'), /named argument object/);
  assert.equal(L.format('sample', 'pair', 'en', Object.create({left: 'inherited'})), 'undefined / undefined');
  L.add('sample', {$languages: ['en'], en: {pair: {$t: '{right}:{left}', $args: ['right', 'left']}}});
  assert.equal(L.format('sample', 'pair', 'en', {left: 'L', right: 'R'}), 'R:L');
});
