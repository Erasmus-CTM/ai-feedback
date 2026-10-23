const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const runtime = fs.readFileSync(path.join(__dirname, '../_extensions/ctm-libs/runtime/pyodide-runtime.js'), 'utf8');
const source = runtime.slice(runtime.indexOf('// Monaco 0.46 supports'));
function deferred() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;});return {promise,resolve,reject}; }
function fixture({gate, environment={}, trustedTypes}={}) {
 const workers=[], amd=[], bootstrap=[];
 const w={document:{},MonacoEnvironment:environment, trustedTypes,
  Worker:function(url, options){this.url=url;this.options=options;workers.push(this);},
  require(deps,done){amd.push(deps);done({getWorkerBootstrapUrl(url,label){bootstrap.push([url,label]);return 'blob:canonical-bootstrap';}})} };
 w.require.toUrl = name => 'https://cdn.test/monaco/min/'+name;
 if(gate)w.qpyodideCoiSettled=gate;
 vm.createContext(w);vm.runInContext(source,w);
 return {w,workers,amd,bootstrap,hook:w.MonacoEnvironment.getWorker};
}
test('unsettled or retired document creates no lazy worker, bootstrap or authored factory', async()=>{
 for(const custom of [false,true]) {
  let calls=0;const gate=deferred(),f=fixture({gate:gate.promise,environment:custom?{getWorker(){calls++;return {};}}:{}});
  let finished=false;f.hook.call(f.w.MonacoEnvironment,'workerMain.js','editorWorkerService').then(()=>{finished=true;});
  await Promise.resolve();assert.equal(finished,false);assert.equal(calls,0);assert.equal(f.workers.length,0);assert.equal(f.amd.length,0);assert.equal(f.bootstrap.length,0);
 }
});
test('staying document resolves one canonical AMD bootstrap per lazy worker with label',async()=>{
 const gate=deferred(),f=fixture({gate:gate.promise});const pending=f.hook.call(f.w.MonacoEnvironment,'workerMain.js','editorWorkerService');
 assert.equal(f.workers.length,0);gate.resolve();const worker=await pending;
 assert.equal(f.workers.length,1);assert.equal(worker,f.workers[0]);assert.equal(worker.options.name,'editorWorkerService');
 assert.deepEqual(f.bootstrap,[['https://cdn.test/monaco/min/vs/base/worker/workerMain.js','editorWorkerService']]);
 assert.equal(worker.url,'blob:canonical-bootstrap');
});
test('authored async factory retains receiver, arguments, result and rejection after decision',async()=>{
 const gate=deferred(),result={},error=new Error('authored worker failed');let calls=0;
 const environment={getWorker(id,label){assert.equal(this,environment);assert.equal(id,'custom-id');assert.equal(label,'python');calls++;return calls===1?Promise.resolve(result):Promise.reject(error);}};
 const f=fixture({gate:gate.promise,environment});const pending=f.hook.call(environment,'custom-id','python');assert.equal(calls,0);gate.resolve();assert.equal(await pending,result);
 await assert.rejects(f.hook.call(environment,'custom-id','python'),e=>e===error);assert.equal(f.amd.length,0);assert.equal(f.workers.length,0);
});
test('authored worker URL and Monaco own Trusted Types policy retain callbacks and exact arguments',async()=>{
 const gate=deferred(),scriptURL={},options={},policy={createScriptURL(url){assert.equal(this,policy);assert.equal(url,'authored-worker.js');return scriptURL;}};
 const environment={getWorkerUrl(id,label){assert.equal(this,environment);assert.deepEqual([id,label],['workerMain.js','json']);return 'authored-worker.js';},createTrustedTypesPolicy(name,value){assert.equal(this,environment);assert.equal(name,'defaultWorkerFactory');assert.equal(value,options);return policy;}};
 const f=fixture({gate:gate.promise,environment});assert.equal(environment.createTrustedTypesPolicy('defaultWorkerFactory',options),policy);
 f.w.require=()=>{throw new Error('authored URL must not require a default AMD factory');};
 const pending=f.hook.call(environment,'workerMain.js','json');assert.equal(f.workers.length,0);gate.resolve();const worker=await pending;
 assert.equal(worker.url,scriptURL);assert.equal(worker.options.name,'json');assert.equal(f.bootstrap.length,0);
});
test('no COI component preserves immediate worker startup and global Trusted Types delegation',async()=>{
 let calls=0;const policy={createScriptURL:url=>'trusted:'+url},trustedTypes={createPolicy(name,options){assert.equal(this,trustedTypes);assert.equal(name,'defaultWorkerFactory');assert.equal(typeof options.createScriptURL,'function');calls++;return policy;}};
 const f=fixture({trustedTypes});assert.equal(f.w.MonacoEnvironment.createTrustedTypesPolicy('defaultWorkerFactory',{createScriptURL:x=>x}),policy);
 const pending=f.hook.call(f.w.MonacoEnvironment,'workerMain.js','editor');assert.equal(f.workers.length,1);assert.equal((await pending).url,'trusted:blob:canonical-bootstrap');assert.equal(calls,1);
});
test('policy and AMD failures remain observable; reloading helper does not wrap authored hook twice',async()=>{
 const error=new Error('policy denied'),environment={createTrustedTypesPolicy(){throw error;}};const f=fixture({environment});
 assert.throws(()=>environment.createTrustedTypesPolicy('defaultWorkerFactory',{}),e=>e===error);
 const hook=f.hook;vm.runInContext(source,f.w);assert.equal(f.w.MonacoEnvironment.getWorker,hook);
 f.w.require=(deps,ok,fail)=>fail(error);await assert.rejects(hook.call(environment,'workerMain.js','editor'),e=>e===error);
});
test('COI rejection cannot start workers; gate is read at request time after module setup',async()=>{
 const f=fixture(),gate=deferred(),error=new Error('decision failed');f.w.qpyodideCoiSettled=gate.promise;
 const pending=f.hook.call(f.w.MonacoEnvironment,'workerMain.js','editor');gate.reject(error);await assert.rejects(pending,e=>e===error);assert.equal(f.workers.length,0);
});
