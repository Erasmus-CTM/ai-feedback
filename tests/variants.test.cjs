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
test('explicit review proposals keep null variant identity and proposal keys until approved', () => {
  const proposals = [{n:null,id:'p-a',hash:'ha',proposal:true},{n:null,id:'p-b',hash:'hb',proposal:true}];
  assert.throws(()=>api().create({...options,variants:proposals}),/positive/);
  const chooser=api().create({...options,variants:proposals,allowProposals:true});
  const first=chooser.state();assert.equal(first.variant,null);assert.ok(first.proposal.id);
  assert.deepEqual(plain(first.seen),['proposal:'+first.proposal.id]);
  assert.notEqual(chooser.next().id,first.proposal.id);
  const reopened=api().create({...options,variants:proposals,allowProposals:true,saved:first});
  assert.equal(reopened.current().id,first.proposal.id);assert.equal(reopened.restored().state,'restored');
  const approved=api().create({...options,variants:[{n:8,id:first.proposal.id,hash:first.proposal.hash}],saved:first});
  assert.equal(approved.current().n,8);assert.equal(approved.state().proposal,undefined);
  assert.throws(()=>api().create({...options,variants:[{n:0,id:'x',hash:'h',proposal:true}],allowProposals:true}),/positive/);
});
test('learner assignment avoids suffix-length bias and adding one record only remaps its own winners', () => {
  const chooser=api(), counts={2:0,7:0,31:0};let moved=0;
  const extra={n:140,id:'id-140',hash:'hash-140'};
  for(let i=0;i<10000;i++) {
    const base={...options,seed:String(i)},before=chooser.create(base).current().n;
    const after=chooser.create({...base,variants:records.concat(extra)}).current().n;
    counts[before]++;
    if(before!==after){moved++;assert.equal(after,140,'existing relative rankings never change');}
  }
  for(const count of Object.values(counts))assert.ok(count>2700&&count<4000,JSON.stringify(counts));
  assert.ok(moved>1800&&moved<3200,'new winner cohort should be about one quarter: '+moved);
  assert.equal(chooser.rankingVersion,2);
});
