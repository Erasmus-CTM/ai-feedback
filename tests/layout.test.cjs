const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../_extensions/ctm-libs/ui/ctm-layout.js'),'utf8');

function environment(noObserver=false){
  const microtasks=[],frames=new Map(),events={},nodes={},mutations=[],observers=[];let next=0;
  const document={readyState:'loading',getElementById:id=>nodes[id]||null,addEventListener:(name,fn)=>{events[name]=fn;}};
  const root={queueMicrotask:fn=>microtasks.push(fn),requestAnimationFrame:fn=>{const id=next++;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    addEventListener:(name,fn)=>{events[name]=fn;},removeEventListener:(name,fn)=>{if(events[name]===fn)delete events[name];},
    MutationObserver:class{constructor(callback){this.callback=callback;mutations.push(this);}observe(target,options){this.active=true;this.options=options;}disconnect(){this.active=false;}}};
  if(!noObserver)root.ResizeObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(target){this.target=target;}disconnect(){this.disconnected=true;}};
  vm.runInNewContext(source,{window:root,document});
  return {api:root.CTMLayout,root,document,events,nodes,frames,microtasks,mutations,observers,
    microtask:()=>{while(microtasks.length)microtasks.shift()();},frame:()=>{const pending=[...frames.values()];frames.clear();for(const run of pending)run();},
    mutate:()=>mutations.filter(observer=>observer.active).forEach(observer=>observer.callback())};
}
function editor(){
  const calls=[],handlers={};let height=26;
  const value={getContentHeight:()=>height,layout:dimensions=>calls.push(dimensions),
    onDidContentSizeChange:callback=>{handlers.content=callback;return{dispose:()=>{handlers.content=null;}};},
    onDidDispose:callback=>{handlers.dispose=callback;return{dispose:()=>{handlers.dispose=null;}};}};
  return {value,calls,handlers,setHeight:next=>{height=next;handlers.content?.({contentHeight:next});}};
}
test('shared UI initializes once after complete parsed content and before DOMContentLoaded',()=>{
  const e=environment(),calls=[];e.api.ready(()=>calls.push('store'));e.api.ready(()=>calls.push('progress'));
  assert.equal(e.mutations[0].options.characterData,true,'streamed text may append to an existing parser text node');
  assert.deepEqual(calls,[]);e.nodes['ctm-store-manifest']={textContent:'{'};e.mutate();e.microtask();assert.deepEqual(calls,[]);
  e.nodes['ctm-store-manifest'].textContent='{"v":1}';e.mutate();e.microtask();assert.deepEqual(calls,['store','progress']);
  assert.equal(e.document.readyState,'loading');assert.ok(e.mutations.every(observer=>!observer.active));
  e.events.DOMContentLoaded();e.microtask();assert.deepEqual(calls,['store','progress']);
});
test('reveal-only marker and late or unmarked consumers retain a readiness path',()=>{
  const e=environment();let count=0;e.api.ready(()=>count++);e.nodes['ctm-layout-ready']={};e.mutate();e.microtask();assert.equal(count,1);
  const fallback=environment();fallback.api.ready(()=>count++);fallback.events.DOMContentLoaded();fallback.microtask();assert.equal(count,2);
  fallback.document.readyState='complete';fallback.api.ready(()=>count++);fallback.microtask();assert.equal(count,3);
});
test('the initial fit stays synchronous; later notifications coalesce into a rendering frame',()=>{
  const e=environment(),model=editor(),container={style:{height:''}};e.api.fitEditor(model.value,container,{minHeight:80});
  assert.equal(container.style.height,'80px');assert.equal(model.calls.length,1);assert.equal(model.calls[0],undefined);
  const observer=e.observers[0];observer.callback([{target:container,contentRect:{width:400.5,height:78}}]);
  model.setHeight(180);observer.callback([{target:container,contentRect:{width:713.5,height:178}}]);
  assert.equal(e.frames.size,1);assert.equal(model.calls.length,1);assert.equal(container.style.height,'80px');
  e.frame();assert.equal(container.style.height,'180px');assert.equal(model.calls.length,2);
  assert.equal(model.calls[1].width,713.5);assert.equal(model.calls[1].height,178);assert.equal(e.frames.size,0);
  model.setHeight(26);e.frame();assert.equal(container.style.height,'80px');assert.equal(e.frames.size,0);
});
test('zero hidden boxes keep Monaco minimum dimensions and later visible boxes replace them',()=>{
  const e=environment(),model=editor(),container={style:{height:''}};e.api.fitEditor(model.value,container);
  e.observers[0].callback([{target:container,contentRect:{width:0,height:0}}]);e.frame();assert.equal(model.calls[1].width,5);assert.equal(model.calls[1].height,5);
  e.observers[0].callback([{target:container,contentRect:{width:761,height:232}}]);e.frame();assert.equal(model.calls[2].width,761);assert.equal(model.calls[2].height,232);
  assert.equal(e.frames.size,0);
});
test('editor disposal cancels pending work, observation and content subscriptions',()=>{
  const e=environment(),model=editor(),container={style:{height:''}};const binding=e.api.fitEditor(model.value,container);
  model.setHeight(180);assert.equal(e.frames.size,1);model.handlers.dispose();e.frame();assert.equal(model.calls.length,1);assert.equal(container.style.height,'26px');
  assert.equal(e.observers[0].disconnected,true);assert.equal(model.handlers.content,null);binding.request();assert.equal(e.frames.size,0);
  e.observers[0].callback([{target:container,contentRect:{width:400,height:200}}]);assert.equal(e.frames.size,0);
});
test('explicit layout has a window resize fallback when native ResizeObserver is unavailable',()=>{
  const e=environment(true),model=editor(),container={style:{height:''}};const binding=e.api.fitEditor(model.value,container);
  e.frame();assert.equal(container.style.height,'26px');assert.equal(model.calls.length,1);assert.equal(model.calls[0],undefined);
  e.events.resize();e.frame();assert.equal(model.calls.length,2);binding.dispose();assert.equal(e.events.resize,undefined);
});
