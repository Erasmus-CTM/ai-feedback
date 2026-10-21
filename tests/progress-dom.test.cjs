const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {JSDOM} = require('jsdom');
const C = require('./helpers/ctm-libs.cjs');
const source = fs.readFileSync(path.join(C.library, 'ui', 'ctm-progress.js'), 'utf8');
async function load({progress = true, early = []} = {}) {
  const manifest = {progress, quizzes: [{id:'q', title:'Quiz <one>'}], exercises: [
    {component:'math-exercise', id:'a', quiz:'q'},
    {component:'py-exercise', id:'b', quiz:'q'},
    {component:'math-exercise', id:'outside'},
    {component:'pyodide-interaktiv', id:'cell'}
  ], messages:{locale:'nb',total:'{score} av {count}'}};
  const w = new JSDOM('<!doctype html><html lang="en"><body><main><div class="ctm-progress-slot" data-ctm-quiz="q"></div><details><summary>Closed</summary><div id="a"></div></details><div id="b"></div><div id="outside"></div></main><script id="ctm-store-manifest" type="application/json"></script></body></html>', {runScripts:'outside-only',pretendToBeVisual:true}).window;
  w.document.getElementById('ctm-store-manifest').textContent = JSON.stringify(manifest);
  w.eval(source);
  for (const [type,detail] of early) w.document.dispatchEvent(new w.CustomEvent(type,{detail}));
  if (w.document.readyState === 'loading') await new Promise(resolve => w.document.addEventListener('DOMContentLoaded',resolve));
  const send = (type, detail) => w.document.dispatchEvent(new w.CustomEvent(type,{detail}));
  return {w,send,buttons:() => [...w.document.querySelectorAll('.ctm-progress button')]};
}
test('manifest panels precede Python, use ordered accessible buttons and exclude cells', async () => {
  const {w,buttons} = await load();
  assert.equal(buttons().length,3);
  assert.equal(w.document.querySelectorAll('.ctm-progress ol').length,2);
  assert.equal(w.document.querySelector('.ctm-progress-title').textContent,'Quiz <one>');
  assert.equal(w.document.querySelector('.ctm-progress-title').children.length,0);
  for (const b of buttons()) { assert.equal(b.type,'button'); assert.match(b.getAttribute('aria-label'),/Exercise \d: not attempted/); }
  assert.equal(w.document.querySelector('[aria-live]'),null);
  assert.equal(w.MathExerciseRuntime,undefined);
  w.close();
});
test('fractional results, invalid and unrelated events do not change valid progress', async () => {
  const {w,send,buttons} = await load();
  send('ctm:result',{component:'math-exercise',id:'a',score:0.5,status:'partial'});
  assert.equal(w.document.querySelector('.ctm-progress-total').textContent,'0,5 av 2');
  assert.match(buttons()[0].textContent,/½ partly correct/);
  for (const detail of [
    {component:'math-exercise',id:'a',score:0,status:'invalid'},
    {component:'math-exercise',id:'a',score:2,status:'correct'},
    {component:'py-exercise',id:'a',score:1,status:'correct'},
    {component:'math-exercise',id:'a',score:'1',status:'correct'}
  ]) send('ctm:result',detail);
  assert.equal(w.document.querySelector('.ctm-progress-total').textContent,'0,5 av 2');
  w.close();
});
test('early restore is buffered; outdated results remain visible and do not earn current credit', async () => {
  const {w,send,buttons} = await load({early:[['ctm:store-restore',{component:'math-exercise',id:'a',state:'changed',outdated:true,result:{score:1,status:'correct'}}]]});
  assert.match(buttons()[0].getAttribute('aria-label'),/outdated/);
  assert.equal(w.document.querySelector('.ctm-progress-total').textContent,'0 av 2');
  send('ctm:result',{component:'math-exercise',id:'a',score:1,status:'correct'});
  assert.doesNotMatch(buttons()[0].getAttribute('aria-label'),/outdated/);
  assert.equal(w.document.querySelector('.ctm-progress-total').textContent,'1 av 2');
  send('ctm:store-clear',{});
  assert.match(buttons()[0].textContent,/not attempted/);
  w.close();
});
test('tiles call CTMNav with the exact exercise target; quiz works without page progress', async () => {
  const {w,buttons} = await load({progress:false});
  let target;
  w.CTMNav = {reveal: async e => {target=e;e.setAttribute('tabindex','-1');e.focus();}};
  buttons()[0].click();
  await Promise.resolve();
  assert.equal(buttons().length,2);
  assert.equal(target,w.document.getElementById('a'));
  assert.equal(w.document.activeElement,target);
  w.close();
});
