const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../_extensions/ctm-libs/ui/variants.js'), 'utf8');
function api(store) {
  const context = {TextEncoder, URLSearchParams, CTMStore: store};
  vm.runInNewContext(source, context);
  return context.CTMVariants;
}
const records = [2, 7, 31].map(n => ({n, id: 'id-' + n, hash: 'hash-' + n}));
const plain = value => JSON.parse(JSON.stringify(value));
const options = {label: 'sum', seed: 'learner', page: 'page', variants: records};

test('saved exact hash wins over link, number and renamed locator', () => {
  const chooser = api().create({...options, query: '?variant=sum:7', saved: {
    variant: {n: 7, id: 'old-name', hash: 'hash-31'}, inputs: {answer: 'old'}, seen: [2, 31]
  }});
  assert.equal(chooser.current().n, 31);
  assert.equal(chooser.restored().state, 'restored');
  assert.deepEqual(plain(chooser.state()), {variant: records[2], seen: [2, 31]});
});
test('changed and withdrawn records remain offered without modifying old answers', () => {
  const saved = {variant: {n: 7, id: 'id-2', hash: 'changed'}, inputs: {answer: 'old'}};
  const chooser = api().create({...options, saved, query: '?variant=sum:31'});
  assert.equal(chooser.current().n, 7, 'number before id');
  assert.equal(chooser.restored().state, 'changed');
  assert.equal(chooser.restored().record, saved);
  assert.deepEqual(saved.inputs, {answer: 'old'});
  assert.equal(chooser.restore({variant: {n: 900, id: 'gone', hash: 'gone'}}).state, 'withdrawn');
  assert.equal(chooser.current().n, 7, 'withdrawal does not overwrite current answers or choose silently');
});
test('id is final restore fallback; a withdrawn initial record permits explicit link', () => {
  assert.equal(api().create({...options, saved: {variant: {n: 900, id: 'id-2'}}}).current().n, 2);
  const chooser = api().create({...options, saved: {variant: {n: 900, id: 'gone'}}, query: '?variant=other:2&variant=sum:31'});
  assert.equal(chooser.current().n, 31);
  assert.equal(chooser.restored().state, 'withdrawn');
});
test('ranking is repeatable, order-independent and stable under variable renames', () => {
  const a = api().create(options);
  const b = api().create({...options, variants: records.slice().reverse().map(v => ({...v, id: 'renamed-' + v.n}))});
  for (let i = 0; i < 12; i++) { assert.equal(a.current().n, b.current().n); a.next(); b.next(); }
});
test('all variants precede repeats; cycle and saved seen state survive reopening', () => {
  const chooser = api().create({...options, query: '?variant=sum:7'});
  const cycle = [chooser.current().n, chooser.next().n, chooser.next().n];
  assert.equal(new Set(cycle).size, 3);
  const saved = chooser.state();
  const reopened = api().create({...options, saved});
  assert.deepEqual(plain(reopened.state()), plain(saved));
  assert.notEqual(reopened.next().n, saved.variant.n, 'no immediate cycle-boundary repeat');
});
test('range growth retains old ranking and stale seen numbers cannot exhaust choices', () => {
  const original = api().create(options);
  const grown = api().create({...options, variants: records.concat({n: 100, id: 'new', hash: 'new'}), seen: [900]});
  const take = chooser => [chooser.current().n, chooser.next().n, chooser.next().n, chooser.next().n];
  const oldOrder = take(original).slice(0, 3);
  assert.deepEqual(take(grown).filter(n => n !== 100), oldOrder);
});
test('shared course seed/page defaults and single deployed variant work', () => {
  const chooser = api({seed: () => 'shared', page: 'page'}).create({label: 'sum', variants: [records[0]]});
  assert.equal(chooser.next().n, 2);assert.deepEqual(plain(chooser.seen()), [2]);
  assert.throws(() => api().create({label: 'sum', variants: records}), /learner seed/);
  assert.throws(() => api().create({...options, variants: [{n: 0, id: 'x', hash: 'x'}]}), /positive/);
});
