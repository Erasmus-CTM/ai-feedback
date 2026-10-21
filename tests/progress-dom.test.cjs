const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {JSDOM} = require('jsdom');
const C = require('./helpers/ctm-libs.cjs');
const source = fs.readFileSync(path.join(C.library, 'ui', 'ctm-progress.js'), 'utf8');
const catalogue = fs.readFileSync(path.join(C.library, 'locales', 'ui.js'), 'utf8');
const uiMessages = JSON.parse(catalogue.split('/*BEGIN-JSON*/')[1].split('/*END-JSON*/')[0]);
async function load({progress = true, early = [], extraExercises = [], messages = {}, configure = () => {}} = {}) {
  const manifest = {progress, quizzes: [{id:'q', title:'Quiz <one>'}], exercises: [
    {component:'math-exercise', id:'a', quiz:'q'},
    {component:'py-exercise', id:'b', quiz:'q'},
    {component:'math-exercise', id:'outside'},
    {component:'pyodide-interaktiv', id:'cell'}, ...extraExercises
  ], messages:{locale:'nb',total:'{score} av {count}',...messages}};
  const w = new JSDOM('<!doctype html><html lang="en"><body><main><div class="ctm-progress-slot" data-ctm-quiz="q"></div><details><summary>Closed</summary><div id="a"></div></details><div id="b"></div><div id="outside"></div></main><script id="ctm-store-manifest" type="application/json"></script></body></html>', {runScripts:'outside-only',pretendToBeVisual:true}).window;
  configure(manifest);
  w.document.getElementById('ctm-store-manifest').textContent = JSON.stringify(manifest);
  w.eval(source);
  for (const [type,detail] of early) w.document.dispatchEvent(new w.CustomEvent(type,{detail}));
  if (w.document.readyState === 'loading') await new Promise(resolve => w.document.addEventListener('DOMContentLoaded',resolve));
  const send = (type, detail) => w.document.dispatchEvent(new w.CustomEvent(type,{detail}));
  const quiz = () => w.document.querySelector('[data-ctm-quiz="q"] .ctm-progress');
  const page = () => w.document.querySelector('.ctm-progress-page .ctm-progress');
  return {w,send,quiz,page,buttons:(scope = w.document) => [...scope.querySelectorAll('button')]};

}
test('manifest panels precede Python, use ordered accessible buttons and exclude cells', async () => {
  const {w,buttons,quiz,page} = await load();
  assert.equal(buttons().length,3);
  assert.equal(w.document.querySelectorAll('.ctm-progress ol').length,2);
  assert.equal(quiz().querySelector('.ctm-progress-title').textContent,'Quiz <one>');
  assert.equal(page().querySelector('.ctm-progress-title').textContent,'Page progress');
  assert.equal(buttons(quiz()).length,2);
  assert.equal(buttons(page()).length,1);
  assert.equal(quiz().querySelector('.ctm-progress-total').textContent,'0 av 2');
  assert.equal(page().querySelector('.ctm-progress-total').textContent,'0 av 1');
  assert.equal(quiz().querySelector('.ctm-progress-title').children.length,0);
  for (const b of buttons()) { assert.equal(b.type,'button'); assert.match(b.getAttribute('aria-label'),/Exercise \d: not attempted/); }
  assert.equal(w.document.querySelector('[aria-live]'),null);
  assert.equal(w.MathExerciseRuntime,undefined);
  w.close();
});
test('fractional results, invalid and unrelated events do not change valid progress', async () => {
  const {w,send,buttons,quiz,page} = await load();
  send('ctm:result',{component:'math-exercise',id:'a',score:0.5,status:'partial'});
  assert.equal(quiz().querySelector('.ctm-progress-total').textContent,'0,5 av 2');
  assert.match(buttons(quiz())[0].textContent,/½ partly correct/);
  assert.match(buttons(quiz())[1].textContent,/not attempted/);
  assert.equal(page().querySelector('.ctm-progress-total').textContent,'0 av 1');
  assert.match(buttons(page())[0].textContent,/not attempted/);
  for (const detail of [
    {component:'math-exercise',id:'a',score:0,status:'invalid'},
    {component:'math-exercise',id:'a',score:2,status:'correct'},
    {component:'py-exercise',id:'a',score:1,status:'correct'},
    {component:'math-exercise',id:'a',score:'1',status:'correct'}
  ]) send('ctm:result',detail);
  assert.equal(quiz().querySelector('.ctm-progress-total').textContent,'0,5 av 2');
  w.close();
});
test('early restore is buffered; outdated results remain visible and do not earn current credit', async () => {
  const {w,send,buttons,quiz,page} = await load({early:[['ctm:store-restore',{component:'math-exercise',id:'a',state:'changed',outdated:true,result:{score:1,status:'correct'}}]]});
  assert.match(buttons(quiz())[0].getAttribute('aria-label'),/outdated/);
  assert.equal(quiz().querySelector('.ctm-progress-total').textContent,'0 av 2');
  send('ctm:result',{component:'math-exercise',id:'a',score:1,status:'correct'});
  assert.doesNotMatch(buttons(quiz())[0].getAttribute('aria-label'),/outdated/);
  assert.equal(quiz().querySelector('.ctm-progress-total').textContent,'1 av 2');
  assert.match(buttons(quiz())[1].textContent,/not attempted/);
  assert.equal(page().querySelector('.ctm-progress-total').textContent,'0 av 1');
  send('ctm:store-clear',{});
  assert.match(buttons(quiz())[0].textContent,/not attempted/);
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

test('one exercise reset preserves other quiz and page tiles; page and course clears reset their scope', async () => {
  const {w,send,buttons,quiz,page} = await load();
  w.CTMStore = {course:'course',page:'page'};
  const a = {component:'math-exercise',id:'a',score:1,status:'correct'};
  const b = {component:'py-exercise',id:'b',score:0.5,status:'partial'};
  const outside = {component:'math-exercise',id:'outside',score:1,status:'correct'};
  const check = (q,p) => {
    assert.equal(quiz().querySelector('.ctm-progress-total').textContent,q);
    assert.equal(page().querySelector('.ctm-progress-total').textContent,p);
  };
  for (const e of [a,b,outside]) send('ctm:result',e);
  check('1,5 av 2','1 av 1');
  send('ctm:store-clear',{course:'course',page:'page',id:'a'});
  check('0,5 av 2','1 av 1');
  assert.match(buttons(quiz())[0].textContent,/not attempted/);
  assert.match(buttons(quiz())[1].textContent,/partly correct/);
  assert.match(buttons(page())[0].textContent,/correct/);
  for (const detail of [
    {course:'other',page:'page'}, {course:'course',page:'other'},
    {course:'course',page:'page',id:'absent'}
  ]) {send('ctm:store-clear',detail);check('0,5 av 2','1 av 1');}
  send('ctm:store-clear',{course:'course',page:'page'});
  check('0 av 2','0 av 1');
  for (const e of [a,b,outside]) send('ctm:result',e);
  send('ctm:store-clear',{course:'course'});
  check('0 av 2','0 av 1');
  w.close();
});

test('duplicate DOM labels across components never create ambiguous tiles', async () => {
  for (const component of ['py-exercise','pyodide-interaktiv']) {
    const {w,quiz,page,buttons,send} = await load({extraExercises:[{component,id:'a',quiz:'q'}]});
    assert.equal(buttons(quiz()).length,1);
    assert.equal(buttons(page()).length,1);
    assert.equal(quiz().querySelector('.ctm-progress-total').textContent,'0 av 1');
    send('ctm:result',{component:'math-exercise',id:'a',score:1,status:'correct'});
    assert.equal(quiz().querySelector('.ctm-progress-total').textContent,'0 av 1');
    assert.match(buttons(quiz())[0].textContent,/not attempted/);
    w.close();
  }
});

test('catalogue status labels render exactly one icon and speak plain text', async () => {
  for (const labels of [uiMessages.en,uiMessages.nb]) {
    const {w,quiz,buttons,send} = await load({messages:labels});
    for (const [status,score,icon] of [['correct',1,'✓'],['partial',0.5,'½'],['wrong',0,'✗']]) {
      send('ctm:result',{component:'math-exercise',id:'a',score,status});
      assert.equal(buttons(quiz())[0].textContent.split(icon).length-1,1);
      assert.doesNotMatch(buttons(quiz())[0].getAttribute('aria-label'),/[✓½✗–]/);
    }
    assert.equal(buttons(quiz())[1].textContent.split('–').length-1,1);
    assert.doesNotMatch(buttons(quiz())[1].getAttribute('aria-label'),/[✓½✗–]/);
    w.close();
  }
});

test('tile navigation finds the registered component root when its DOM id differs from its label', async () => {
  const {w,quiz,buttons} = await load();
  const target = w.document.getElementById('a');
  target.id = 'generated-math-root-42';
  target.setAttribute('data-ctm-id','a');
  target.setAttribute('data-ctm-component','math-exercise');
  const decoy = w.document.createElement('div');
  decoy.id = 'a';
  decoy.setAttribute('data-ctm-id','a');
  decoy.setAttribute('data-ctm-component','py-exercise');
  w.document.querySelector('main').prepend(decoy);
  let revealed;
  w.CTMNav = {reveal:async element => {revealed=element;element.setAttribute('tabindex','-1');element.focus();}};
  buttons(quiz())[0].click();
  await Promise.resolve();
  assert.equal(revealed,target);
  assert.equal(w.document.activeElement,target);
  assert.notEqual(revealed,decoy);
  w.close();
});

test('mixed component registration batches produce tiles in source DOM order', async () => {
  const {w,quiz,buttons,send} = await load({configure:manifest => {
    manifest.exercises.find(e=>e.id==='outside').quiz='q';
    manifest.exercises.sort((a,b)=>a.component.localeCompare(b.component));
  }});
  send('ctm:result',{component:'math-exercise',id:'a',score:1,status:'correct'});
  send('ctm:result',{component:'py-exercise',id:'b',score:0.5,status:'partial'});
  send('ctm:result',{component:'math-exercise',id:'outside',score:0,status:'wrong'});
  assert.deepEqual(buttons(quiz()).map(b=>b.dataset.status),['correct','partial','wrong']);
  const revealed=[];
  w.CTMNav={reveal:async element=>{revealed.push(element.id);}};
  for (const button of buttons(quiz())) {button.click();await Promise.resolve();}
  assert.deepEqual(revealed,['a','b','outside']);
  assert.equal(quiz().querySelector('.ctm-progress-total').textContent,'1,5 av 3');
  w.close();
});
