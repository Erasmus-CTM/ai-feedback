const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../_extensions/ctm-libs/runtime/coi-serviceworker.js'),'utf8');
function service(response){const listeners={},requests=[];const context={Headers,Request,Response,self:{addEventListener:(name,handler)=>listeners[name]=handler,clients:{claim:async()=>{}},skipWaiting(){}},fetch:async req=>{requests.push(req);if(response instanceof Error)throw response;return response;}};vm.runInNewContext(source,context);return{requests,request(req){let result;listeners.fetch({request:req,respondWith:value=>result=value});return result;}};}
test('HEAD retains the exact native response and its encoded representation metadata',async()=>{
 const native=new Response(null,{headers:{'Content-Encoding':'br','Content-Length':'8998','Content-Type':'application/wasm'}}),sw=service(native);
 const request=new Request('https://cdn.test/wheel.whl',{method:'HEAD'}),got=await sw.request(request);
 assert.equal(got,native);assert.equal(sw.requests[0],request);assert.equal(got.headers.get('Content-Encoding'),'br');assert.equal(got.headers.get('Content-Length'),'8998');assert.equal(got.headers.get('Cross-Origin-Embedder-Policy'),null);
});
test('GET document response still receives COOP/COEP and retains its body',async()=>{
 const native=new Response('<p>actual body</p>',{headers:{'Content-Type':'text/html'}}),sw=service(native),got=await sw.request(new Request('https://course.test/page'));
 assert.notEqual(got,native);assert.equal(got.headers.get('Cross-Origin-Opener-Policy'),'same-origin');assert.equal(got.headers.get('Cross-Origin-Embedder-Policy'),'credentialless');assert.equal(await got.text(),'<p>actual body</p>');
});
test('opaque/error responses remain untouched',async()=>{
 const native=Response.error(),sw=service(native);assert.equal(await sw.request(new Request('https://cdn.test/image')),native);
});
test('fetch failures retain their original error identity',async()=>{
 const error=new Error('native network error');await assert.rejects(service(error).request(new Request('https://cdn.test/wheel')),e=>e===error);
});
test('no-cors requests still omit credentials',async()=>{
 const sw=service(new Response('image'));await sw.request(new Request('https://cdn.test/image',{mode:'no-cors',credentials:'include'}));assert.equal(sw.requests[0].credentials,'omit');
});
test('unsupported cache mode is not intercepted',()=>{
 const skipped=service(new Response('x'));assert.equal(skipped.request({method:'HEAD',cache:'only-if-cached',mode:'cors'}),undefined);assert.equal(skipped.requests.length,0);
});
