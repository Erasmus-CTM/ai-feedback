const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {JSDOM} = require('jsdom');
const C = require('./helpers/ctm-libs.cjs');
function fixture() {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {url:'https://course.example/lesson',runScripts:'outside-only'});
  for (const name of ['feedback-core.js','feedback-dom.js','ai-feedback.js']) dom.window.eval(fs.readFileSync(path.join(C.feedback,name),'utf8'));
  const {window:w} = dom;
  function activity(id, resetOnVariant, extra = {}) {
    const el=w.document.createElement('div'); el.className='ai-feedback-activity';
    const data=w.document.createElement('script'); data.className='ai-feedback-data';
    data.textContent=JSON.stringify({id,resetOnVariant,task:'Explain your work.',contextMode:'none',uiLanguage:'en',...extra});
    el.append(data); w.document.body.append(el); w.AIFeedback.initActivity(el);
    return {el,input:el.querySelector('textarea'),output:el.querySelector('.ai-feedback-output'),button:el.querySelector('.ai-feedback-button')};
  }
  function emit(type,label) {w.document.dispatchEvent(new w.CustomEvent(type,{detail:{label,variant:{n:7,id:'i',hash:'h'}}}));}
  return {dom,w,activity,emit};
}
test('accepted choice resets only explicitly linked activity; hydration and other labels preserve it', () => {
  const f=fixture();
  try {
    const linked=f.activity('linked','q'), other=f.activity('other','other'), ordinary=f.activity('ordinary');
    for(const a of [linked,other,ordinary]) {a.input.value='old explanation';a.output.textContent='old feedback';}
    let inputs=0; linked.input.addEventListener('input',()=>inputs++);
    f.emit('math-exercise:variant-change','q'); f.emit('math-exercise:variant-accepted','elsewhere');
    assert.equal(linked.input.value,'old explanation'); assert.equal(inputs,0);
    f.emit('math-exercise:variant-accepted','q');
    assert.equal(linked.input.value,'');assert.equal(linked.output.textContent,'');assert.equal(inputs,1);
    for(const a of [other,ordinary]) {assert.equal(a.input.value,'old explanation');assert.equal(a.output.textContent,'old feedback');}
  } finally {f.dom.window.close();}
});
test('accepted choice aborts in-flight feedback and late provider response cannot restore old output', async () => {
  const f=fixture();
  try {
    let finish, signal;
    f.w.AIFeedback.createClient=()=>({request:(_,opts)=>{signal=opts.signal;return new Promise(resolve=>{finish=resolve;});}});
    f.w.AIFeedback.saveConfig({mode:'api',storage:'session',baseUrl:'https://provider.example',model:'test'});
    const a=f.activity('explain','q'); a.input.value='old explanation';a.button.click();
    for(let i=0;!finish && i<20;i++) await new Promise(resolve=>setImmediate(resolve));
    assert.ok(finish,'provider request started: '+a.output.textContent);assert.equal(signal.aborted,false);
    f.emit('math-exercise:variant-accepted','q');assert.equal(signal.aborted,true);
    finish({text:'OLD PROVIDER RESPONSE',format:'text'});
    for(let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));
    assert.equal(a.input.value,'');assert.equal(a.output.textContent,'');assert.equal(a.button.disabled,false);
  } finally {f.dom.window.close();}
});
test('accepted choice during asynchronous context collection prevents provider submission', async () => {
  const f=fixture();
  try {
    let finish, submitted=0;
    f.w.AIFeedback.contextMaterials=()=>[];
    f.w.AIFeedback.collectVisualContexts=()=>new Promise(resolve=>{finish=resolve;});
    f.w.AIFeedback.createClient=()=>({request:async()=>{submitted++;return {text:'unexpected',format:'text'};}});
    f.w.AIFeedback.saveConfig({mode:'api',storage:'session',baseUrl:'https://provider.example',model:'test'});
    const a=f.activity('explain','q',{contextMode:'explicit',contextRefs:'board'});
    a.input.value='old explanation';a.button.click();
    for(let i=0;!finish && i<20;i++) await new Promise(resolve=>setImmediate(resolve));
    assert.ok(finish,'asynchronous collection started');
    f.emit('math-exercise:variant-accepted','q');
    finish({materials:[],attachments:[]});
    for(let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));
    assert.equal(submitted,0);assert.equal(a.output.textContent,'');assert.equal(a.button.disabled,false);
  } finally {f.dom.window.close();}
});
test('Quarto preserves explicit reset-on-variant label in activity data', {skip:C.hasQuarto?false:'Quarto required'}, () => {
  const dir=C.tempdir('ctm-variant-feedback-');
  try {
    C.installPackage(dir);C.install(dir);
    C.write(dir,{'_quarto.yml':'project:\n  type: default\nfilters: [ctm-libs]\n','lesson.qmd':'---\ntitle: Reset\n---\n::: {.ai-feedback #explain reset-on-variant="stack-tangent"}\nExplain your work.\n:::\n'});
    const result=C.render(dir,['lesson.qmd']);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
    const dom=new JSDOM(C.html(dir,'lesson.qmd'));
    const data=JSON.parse(dom.window.document.querySelector('script.ai-feedback-data').textContent);
    assert.equal(data.resetOnVariant,'stack-tangent');dom.window.close();
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
