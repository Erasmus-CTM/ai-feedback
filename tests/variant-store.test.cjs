const test = require('node:test'), assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const fs = require('node:fs'), path = require('node:path');
const file = name => fs.readFileSync(path.join(__dirname, '../_extensions/ctm-libs/ui/', name), 'utf8');
const records = [2, 7, 31].map(n => ({n, id: 'id-' + n, hash: 'hash-' + n}));
function page({saved, session, save = true, blocked = false, deployed = records, allowProposals = false} = {}) {
  const dom = new JSDOM('<meta name="quarto:offset" content="../"><script id="ctm-store-manifest" type="application/json">' +
    JSON.stringify({course: '/course/', save, exercises: [{id: 'sum', component: 'math-exercise', save}]}) + '</script>',
    {url: 'https://example.test/course/chapter/x.html', runScripts: 'outside-only'});
  const w = dom.window;w.TextEncoder = TextEncoder;w.CTMLayout = {ready: fn => fn()};
  if (saved) for (const [k,v] of Object.entries(saved)) w.localStorage.setItem(k,v);
  if (session) for (const [k,v] of Object.entries(session)) w.sessionStorage.setItem(k,v);
  if (blocked) Object.defineProperty(w, 'localStorage', {get() { throw new Error('SecurityError'); }});
  w.eval(file('ctm-store.js'));w.eval(file('variants.js'));
  let chooser, inputs = {answer: '4'};
  const handle = w.CTMStore.register({component: 'math-exercise', id: 'sum', source: 'source', save,
    read: () => inputs, write() {},
    allowProposals, variant: () => chooser.state().variant, proposal: () => chooser.state().proposal,
    seen: () => chooser.seen(), variants: () => deployed});
  chooser = w.CTMVariants.create({label: 'sum', variants: deployed, allowProposals, saved: handle.restoreChoice()});
  return {w, dom, handle, chooser, key: w.CTMStore.key('sum'), input: value => {inputs = value;}};
}
const storage = target => Object.fromEntries(Object.keys(target).map(key => [key,target.getItem(key)]));
test('P17 choice-only identity survives reopen and two cycles never starve a variant', () => {
  let p = page(), cycle = [];
  for (let i=0;i<9;i++) {
    cycle.push(p.chooser.current().n);p.handle.choice(p.chooser.state());
    const saved = storage(p.w.localStorage);p.dom.window.close();p=page({saved});
    p.chooser.next();
  }
  for (let i=0;i<9;i+=3) assert.equal(new Set(cycle.slice(i,i+3)).size,3);
  assert.deepEqual(JSON.parse(p.w.localStorage.getItem(p.key)).inputs,{});
  p.dom.window.close();
});
test('answer saves use authoritative current-cycle seen rather than unioning past cycles', () => {
  const p=page();
  for(let i=0;i<3;i++)p.chooser.next();
  p.handle.choice(p.chooser.state());p.handle.flush();
  assert.deepEqual(JSON.parse(p.w.localStorage.getItem(p.key)).seen,Array.from(p.chooser.seen()));
  p.handle.result({status:'correct',score:1});
  const old=JSON.parse(p.w.localStorage.getItem(p.key));p.handle.choice(p.chooser.state());
  assert.deepEqual(JSON.parse(p.w.localStorage.getItem(p.key)).inputs,old.inputs);
  assert.deepEqual(JSON.parse(p.w.localStorage.getItem(p.key)).result,old.result);
  p.dom.window.close();
});
test('saving disabled keeps only choice and seen in session; reopen preserves choice', () => {
  let p=page({save:false});p.chooser.next();p.handle.choice(p.chooser.state());
  assert.equal(p.w.localStorage.getItem(p.key),null);
  const record=JSON.parse(p.w.sessionStorage.getItem(p.key));assert.deepEqual(record.inputs,{});assert.equal(record.result,undefined);
  const session=storage(p.w.sessionStorage), expected=p.chooser.current().n;p.dom.window.close();p=page({save:false,session});
  assert.equal(p.chooser.current().n,expected);p.handle.clear();assert.equal(p.w.sessionStorage.getItem(p.key),null);p.dom.window.close();
});
test('new choice cancels old debounce and cannot reuse cached result on later flush', () => {
  const p=page();p.handle.choice(p.chooser.state());p.handle.result({status:'correct',score:1});
  p.handle.changed();p.chooser.next();p.handle.choice(p.chooser.state());p.handle.flush();
  const record=JSON.parse(p.w.localStorage.getItem(p.key));
  assert.equal(record.result,undefined);assert.equal(record.variant.n,p.chooser.current().n);p.dom.window.close();
});
test('an untouched answer flush preserves its selected variant and seen cycle', () => {
  const p=page();p.chooser.next();p.handle.choice(p.chooser.state());p.input(null);p.handle.flush();
  const record=JSON.parse(p.w.localStorage.getItem(p.key));
  assert.equal(record.variant.n,p.chooser.current().n);assert.deepEqual(record.inputs,{});
  assert.deepEqual(record.seen,Array.from(p.chooser.seen()));p.dom.window.close();
});
test('page/course clear remove session choices; blocked local storage retains same-page state', () => {
  for(const method of ['clearPage','clearCourse']) {
    const p=page({save:false});p.handle.choice(p.chooser.state());p.w.CTMStore[method]();
    assert.equal(p.w.sessionStorage.getItem(p.key),null);p.dom.window.close();
  }
  const p=page({blocked:true});p.handle.choice(p.chooser.state());
  assert.equal(p.handle.restoreChoice().variant.n,p.chooser.current().n);p.dom.window.close();
});
test('optional proposal P17 record has null variant and separate sidecar through choice/save/reopen', () => {
  const deployed=[{n:null,id:'p-a',hash:'ha',proposal:true},{n:null,id:'p-b',hash:'hb',proposal:true}];
  let p=page({deployed,allowProposals:true});p.handle.choice(p.chooser.state());p.handle.flush();
  const record=JSON.parse(p.w.localStorage.getItem(p.key));
  assert.equal(record.variant,null);assert.deepEqual(record.proposal,{id:p.chooser.current().id,hash:p.chooser.current().hash});
  assert.ok(record.seen.every(key=>key.startsWith('proposal:')));assert.deepEqual(record.inputs,{answer:'4'});
  const saved=storage(p.w.localStorage);p.dom.window.close();p=page({deployed,allowProposals:true,saved});
  assert.equal(p.chooser.current().id,record.proposal.id);assert.equal(p.handle.restore().state,'restored');
  p.chooser.next();p.handle.choice(p.chooser.state());assert.equal(p.handle.restoreChoice().variant,null);
  const pending=p.handle.restoreChoice(), promoted=storage(p.w.localStorage);p.dom.window.close();
  p=page({deployed:[{n:14,id:pending.proposal.id,hash:pending.proposal.hash}],saved:promoted});
  assert.equal(p.chooser.current().n,14);assert.equal(p.handle.restore().state,'restored');
  p.handle.choice(p.chooser.state());assert.equal(p.handle.restoreChoice().proposal,undefined);p.dom.window.close();
});
test('duplicate content restores exact identity and a deliberate same-hash switch clears old grades', () => {
  const deployed=[{n:1,id:'A',hash:'H'},{n:2,id:'B',hash:'H'}];
  let p=page({deployed});p.chooser.restore({variant:deployed[1]});p.handle.choice(p.chooser.state());p.handle.result({status:'correct',score:1});
  const saved=storage(p.w.localStorage);p.dom.window.close();p=page({deployed,saved});
  assert.equal(p.chooser.current().n,2);assert.equal(p.handle.restore().variant.n,2);
  p.chooser.restore({variant:deployed[0]});p.handle.choice(p.chooser.state());p.handle.flush();
  assert.equal(p.handle.restoreChoice().result,undefined,'equal hash is not permission to reuse a different identity grade');
  p.w.localStorage.setItem(p.key,JSON.stringify({v:1,component:'math-exercise',variant:{n:99,id:'gone',hash:'H'},inputs:{answer:'keep'}}));
  const outcome=p.handle.restore();assert.equal(outcome.state,'withdrawn');assert.equal(outcome.variant,null);
  assert.deepEqual(JSON.parse(JSON.stringify(outcome.record.inputs)),{answer:'keep'});p.dom.window.close();
});
test('unambiguous content remapping preserves restored answers when identity changes', () => {
  const deployed=[{n:9,id:'new',hash:'same'}];
  let p=page({deployed});
  p.w.localStorage.setItem(p.key,JSON.stringify({v:1,component:'math-exercise',variant:{n:4,id:'old',hash:'same'},inputs:{answer:'preserve'}}));
  const saved=storage(p.w.localStorage);p.dom.window.close();p=page({deployed,saved});
  assert.equal(p.chooser.current().n,9);p.handle.choice(p.chooser.state());
  assert.equal(p.handle.restoreChoice().inputs.answer,'preserve');p.dom.window.close();
});
