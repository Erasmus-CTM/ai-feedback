const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), crypto = require('node:crypto');
const W = require('./helpers/worker.cjs');
const bytes = Buffer.from('a real wheel fixture');
function worker(fetch) {
  const w = W.workerContext({globals:{fetch, URL, AbortController, Response, Headers, ReadableStream, crypto:globalThis.crypto}});
  w.context.wheelHash = crypto.createHash('sha256').update(bytes).digest('hex');
  vm.runInContext(`config={indexURL:'https://wheel.test/'}; RANGE=8; STALL=1000; RETRY_AFTER=[0,0];
    lockPackages={wheel:{name:'wheel',file_name:'wheel.whl',sha256:wheelHash}};`,w.context);
  return w;
}
const response = (body, status=200, headers={}) => new Response(body,{status,headers});
const run = (w, code) => vm.runInContext(code,w.context);
async function verified(w) {
  const result = await run(w, "fetch('https://wheel.test/wheel.whl')");
  assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);
}
test('identity representation retains exact range prefetch and verifies the complete wheel',async()=>{
  const calls=[];const w=worker(async(url,init)=>{
    calls.push(init);
    if(init.method==='HEAD')return response(null);
    const [,from,to]=/bytes=(\d+)-(\d+)/.exec(init.headers.Range).map(Number);
    const end=Math.min(to,bytes.length-1);
    return response(bytes.subarray(from,end+1),206,{'Content-Range':`bytes ${from}-${end}/${bytes.length}`});
  });
  await run(w,"prefetch(['wheel'])");assert.deepEqual(calls.map(c=>c.method||c.headers.Range),['HEAD','bytes=0-7','bytes=8-15','bytes=16-23']);
  await verified(w);assert.equal(calls.length,4,'install consumes verified bytes, without a second GET');
});
test('Brotli representation uses whole-file prefetch, never decoded offsets or partial compressed streams',async()=>{
  const calls=[];const w=worker(async(url,init)=>{
    calls.push(init);
    if(init.method==='HEAD')return response(null,200,{'Content-Encoding':'br','Content-Length':'16'});
    assert.equal(init.headers.Range,undefined);
    // Fetch exposes decoded bytes, while response headers name wire encoding.
    return response(bytes,200,{'Content-Encoding':'br','Content-Length':'16'});
  });
  await run(w,"prefetch(['wheel'])");await verified(w);assert.equal(calls.length,2);assert.equal(calls[0].method,'HEAD');
});
test('unsupported HEAD falls back to verified whole GET without repeated metadata attempts',async()=>{
  const calls=[];const w=worker(async(url,init)=>{calls.push(init);return init.method==='HEAD'?response(null,405):response(bytes);});
  await run(w,"prefetch(['wheel'])");await verified(w);assert.equal(calls.length,2);assert.equal(calls[1].headers.Range,undefined);
});
test('exposed partial responses reject wrong boundaries, unsafe totals and truncated body lengths',async()=>{
  for(const [header,body] of [['bytes 1-8/20',bytes.subarray(0,8)],['bytes 0-8/20',bytes.subarray(0,9)],['bytes 0-7/7',bytes.subarray(0,8)],['bytes 0-7/9007199254740992',bytes.subarray(0,8)],['bytes 0-7/20',bytes.subarray(0,4)],['nonsense',bytes.subarray(0,8)]]){
    const w=worker(async()=>response(body,206,{'Content-Range':header}));
    await assert.rejects(run(w,"fetchRange('https://wheel.test/wheel.whl',0)"),/range|Range/);
    assert.equal(run(w,'verified.size'),0);
  }
});
test('whole response after a partial range replaces earlier chunks instead of appending a second copy',async()=>{
  let gets=0;const w=worker(async(url,init)=>{
    if(init.method==='HEAD')return response(null);
    gets++;return gets===1?response(bytes.subarray(0,8),206,{'Content-Range':`bytes 0-7/${bytes.length}`}):response(bytes);
  });
  await run(w,"prefetch(['wheel'])");await verified(w);assert.equal(gets,2);
});
test('a changed representation after HEAD is consumed then refetched whole without advancing decoded offsets',async()=>{
  const calls=[];const w=worker(async(url,init)=>{
    calls.push(init);if(init.method==='HEAD')return response(null);
    if(init.headers.Range)return response(bytes.subarray(0,4),206,{'Content-Encoding':'br','Content-Range':'bytes 0-7/16'});
    return response(bytes);
  });
  await run(w,"prefetch(['wheel'])");await verified(w);assert.deepEqual(calls.map(c=>c.method||c.headers.Range||'whole'),['HEAD','bytes=0-7','whole']);
});
test('a changing total retries the same offset and never verifies mixed representations',async()=>{
  const offsets=[];const w=worker(async(url,init)=>{
    if(init.method==='HEAD')return response(null);
    offsets.push(init.headers.Range);const start=Number(/bytes=(\d+)/.exec(init.headers.Range)[1]);
    return response(bytes.subarray(start,start+8),206,{'Content-Range':`bytes ${start}-${start+7}/${start?30:bytes.length}`});
  });
  await assert.rejects(run(w,"prefetch(['wheel'])"),/total changed/);
  assert.deepEqual(offsets,['bytes=0-7','bytes=8-15','bytes=8-15','bytes=8-15']);assert.equal(run(w,'verified.size'),0);
});

test('unexposed CORS encoding metadata chooses whole prefetch instead of guessing identity',async()=>{
  const calls=[];const w=worker(async(url,init)=>{calls.push(init);if(init.method==='HEAD')return {status:200,type:'cors',headers:new Headers(),arrayBuffer:async()=>new ArrayBuffer(0)};return response(bytes);});
  await run(w,"prefetch(['wheel'])");await verified(w);assert.equal(calls.length,2);assert.equal(calls[1].headers.Range,undefined);
});
test('encoded partial decoder failure is retained and falls back once without repeating a bad fragment',async()=>{
  const calls=[];const w=worker(async(url,init)=>{
    calls.push(init);if(init.method==='HEAD')return response(null);
    if(init.headers.Range)return response(new ReadableStream({start(controller){controller.error(Error('actual compressed fragment decoder failed'));}}),206,{'Content-Encoding':'br'});
    return response(bytes);
  });
  const warnings=[];w.context.console={...console,warn:(...args)=>warnings.push(args.map(String).join(' '))};
  await run(w,"prefetch(['wheel'])");await verified(w);assert.equal(calls.length,3);assert.equal(calls[1].headers.Range,'bytes=0-7');assert.equal(calls[2].headers.Range,undefined);assert.match(warnings[0],/compressed fragment decoder failed/);
});

test('a whole-file GET never accepts a partial response even when it advertises compression',async()=>{
  const w=worker(async()=>response(bytes.subarray(0,4),206,{'Content-Encoding':'br','Content-Range':'bytes 0-7/16'}));
  await assert.rejects(run(w,"fetchRange('https://wheel.test/wheel.whl',null)"),/Unexpected partial/);assert.equal(run(w,'verified.size'),0);
});
