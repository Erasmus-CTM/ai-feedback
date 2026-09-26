const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const F=require('../_extensions/ai-feedback/feedback-core.js');
const request={profile:'python',task:'Add the values.',responses:[{id:'code',format:'code',value:'print(2)'}],criteria:['Do not import math.'],feedback:{language:'nb'}};
const config=(defaults={},integrations={})=>({layers:[{defaults,integrations}]});
test('shipped policies preserve review modes, four math steps and three Python hints',()=>{
  for(const [name,count] of [['non-python',0],['py-exercise',0],['math-exercise',4],['pyodide-interaktiv',3]]){
    const p=F.resolvePolicy(name,'nb',{},config());assert.equal(p.steps.length,count);assert.equal(p.language,'nb');assert.equal(p['reset-on-run'],true);
  }
  const p=F.resolvePolicy('math-exercise','de',{},config());assert.equal(p['max-words'],120);assert.equal(p.steps[3]['allow-full-solution'],true);
});
test('local common, integration and later files replace scalars and whole step lists',()=>{
  const c={layers:[{defaults:{'max-words':180,steps:[{prompt:'First'},{prompt:'Second'}]}},{integrations:{'math-exercise':{'max-words':300,steps:[{prompt:'Local final'}]}}}]};
  const p=F.resolvePolicy('math-exercise','en',{},c);assert.equal(p['max-words'],300);assert.deepEqual(p.steps,[{prompt:'Local final'}]);assert.equal(p['allow-full-solution'],false);
  c.layers.push({integrations:{'math-exercise':{steps:[],'reset-on-run':false}}});assert.equal(F.resolvePolicy('math-exercise','en',{},c).steps.length,0);assert.equal(F.resolvePolicy('math-exercise','en',{},c)['reset-on-run'],false);
});
test('all integrations can use new steps with step-specific limits and solution permission',()=>{
  globalThis.__aiFeedbackPolicies=config({steps:[{prompt:'Nudge'},{prompt:'Explain fully','allow-full-solution':true,'max-words':400}],language:'es'});
  for(const name of ['non-python','py-exercise','math-exercise','pyodide-interaktiv']){
    const first=F.applyPolicy(name,request,1);assert.equal(first.feedback.allowFullRewrite,false);
    const last=F.applyPolicy(name,request,99);assert.equal(last.feedback.level,2);assert.equal(last.feedback.maxWords,400);assert.equal(last.feedback.allowFullRewrite,true);assert.equal(last.feedback.language,'es');assert.ok(last.criteria.includes('Do not import math.'));
    assert.match(F.buildPrompt(last),/CURRENT HINT LEVEL: 2 OF 2/);
  }
  delete globalThis.__aiFeedbackPolicies;
});
test('common/integration prompts combine, replacing their own shipped scope',()=>{
  globalThis.__aiFeedbackPolicies=config({prompt:'COMMON'},{'pyodide-interaktiv':{prompt:'SPECIFIC'}});
  const r=F.applyPolicy('pyodide-interaktiv',request,1);assert.deepEqual(r.criteria,['Do not import math.','COMMON','SPECIFIC']);delete globalThis.__aiFeedbackPolicies;
});
for(const policy of [{steps:false},{steps:[{}]},{steps:['bad']},{'reset-on-run':'false'},{'max-words':5},{'allow-full-solution':'yes'},{unknown:true}])test('invalid policy fails clearly: '+JSON.stringify(policy),()=>{
 assert.throws(()=>F.resolvePolicy('math-exercise','en',{},config(policy)),e=>e.code==='INVALID_REQUEST');
});
const {JSDOM}=require('jsdom');
function attached({reset=true,client}={}){
 const w=new JSDOM('<button>Feedback</button><div id="out"></div>',{url:'https://course.invalid/task',runScripts:'outside-only'}).window;w.AbortController=AbortController;
 for(const f of ['feedback-core.js','feedback-dom.js','ai-feedback.js'])w.eval(fs.readFileSync(path.join(__dirname,'../_extensions/ai-feedback',f),'utf8'));
 w.__aiFeedbackPolicies=config({'reset-on-run':reset,steps:[{prompt:'First'},{prompt:'Second'},{prompt:'Third'}]});
 let value='print(2)';
 const api=w.AIFeedback.attach({integration:'py-exercise',id:'one',button:w.document.querySelector('button'),output:w.document.querySelector('#out'),client,getRequest:()=>({...request,responses:[{id:'code',format:'code',value}]})});
 return {w,api,edit:v=>{value=v;api.cancel({clearOutput:true});},level:()=>w.document.querySelector('.ai-feedback-hint')?.textContent};
}
test('edits preserve progress, Run resets by default, Reset always resets, final step saturates',async()=>{
 const {w,api,edit,level}=attached();await api.request();assert.equal(level(),'Hint 1');edit('print(3)');await api.request();assert.equal(level(),'Hint 2');await api.request();await api.request();assert.equal(level(),'Hint 3');api.reset('run');await api.request();assert.equal(level(),'Hint 1');api.reset();await api.request();assert.equal(level(),'Hint 1');w.close();
});
test('reset-on-run false preserves progress but explicit Reset clears it',async()=>{
 const {w,api,level}=attached({reset:false});await api.request();api.reset('run');await api.request();assert.equal(level(),'Hint 2');api.reset();await api.request();assert.equal(level(),'Hint 1');w.close();
});
test('policy change invalidates progress and does not inherit final solution access',async()=>{
 const {w,api,level}=attached();await api.request();await api.request();w.__aiFeedbackPolicies=config({steps:[{prompt:'New start'},{prompt:'New end'}]});await api.request();assert.equal(level(),'Hint 1');w.close();
});
test('Reset cancels pending reply without consuming or restoring a hint',async()=>{
 let finish;const {w,api,level}=attached({client:{request:()=>new Promise(r=>{finish=r;})}});
 const pending=api.request();await new Promise(r=>setImmediate(r));api.reset('run');finish({text:'OLD',format:'markdown'});await pending;assert.equal(w.document.querySelector('#out').textContent,'');assert.equal(level(),undefined);w.close();
});

test('explicit activity max-issues remains authoritative while absent values inherit policy',()=>{
 globalThis.__aiFeedbackPolicies=config({'max-issues':5});
 assert.equal(F.applyPolicy('non-python',{...request,feedback:{maxIssues:1}},1).feedback.maxIssues,1);
 assert.equal(F.applyPolicy('non-python',request,1).feedback.maxIssues,5);
 delete globalThis.__aiFeedbackPolicies;
});
test('blocked browser storage still permits progressive feedback',async()=>{
 const {w,api,level}=attached();Object.defineProperty(w,'sessionStorage',{get(){throw new Error('blocked');}});
 await api.request();await api.request();assert.equal(level(),'Hint 2');w.close();
});
