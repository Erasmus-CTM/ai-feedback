const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
function checkStore(source, assert) {
  var count = 0;
  function ok(value, reason) { assert(value, reason); count++; }
  function setup(config, existing, quota) {
    var local = Object.assign({}, existing), session = {}, events = [], status = {textContent: ''};
    function storage(map) { return {
      get length() { return Object.keys(map).length; }, key: function(i) { return Object.keys(map)[i]; },
      getItem: function(key) { return Object.prototype.hasOwnProperty.call(map,key) ? map[key] : null; },
      setItem: function(key,value) { if (map === local && quota && quota()) throw Error('QuotaExceededError'); map[key]=value; },
      removeItem: function(key) { delete map[key]; }
    }; }
    var document = {readyState:'complete', getElementById:function(){return {textContent:JSON.stringify(config || {})};},
      querySelector:function(selector){return selector === 'meta[name="quarto:offset"]' ? {content:'../'} : selector === '.ctm-save-status' ? status : null;},
      addEventListener:function(){}, dispatchEvent:function(event){events.push(event);}};
    var window = {localStorage:storage(local),sessionStorage:storage(session),addEventListener:function(){},
      crypto:{getRandomValues:function(bytes){for(var i=0;i<bytes.length;i++)bytes[i]=i+1;}}};
    function URL(){this.pathname='/course/';}
    function CustomEvent(type,opts){this.type=type;this.detail=opts.detail;}
    function Encoder(){}
    Encoder.prototype.encode=function(text){return new Uint8Array(unescape(encodeURIComponent(text)).length);};
    new Function('window','document','location','URL','CustomEvent','TextEncoder',source)(window,document,
      {pathname:'/course/chapter/x.html',href:'https://example.test/course/chapter/x.html'},URL,CustomEvent,Encoder);
    var input={code:'answer'},writes=[],clears=0;
    function register(extra){return window.CTMStore.register(Object.assign({component:'code',id:'ex',source:'0123456789abcdef',
      read:function(){return input;},write:function(value,meta){writes.push({value:value,meta:meta});},clear:function(){clears++;}},extra));}
    return {store:window.CTMStore,local:local,session:session,events:events,register:register,writes:writes,
      input:function(value){input=value;},clears:function(){return clears;}};
  }
  function record(extra){return Object.assign({v:1,component:'code',source:'0123456789abcdef',inputs:{code:'old'}},extra);}
  var x=setup(),key=x.store.key('ex'),h=x.register();
  ok(x.store.enabled(),'default on');
  ok(key==='ctm|1|%2Fcourse%2F|chapter%2Fx|ex','encoded canonical key');
  x.local[key]=JSON.stringify(record()); ok(h.restore().state==='restored' && x.writes[0].value.code==='old','restore inputs without checking');
  x.local[key]=JSON.stringify(record({source:'changed'}));ok(h.restore().state==='changed' && x.writes.length===1,'source mismatch no fill');
  x.local[key]=JSON.stringify(record({v:4}));h.result({status:'correct',score:1});ok(JSON.parse(x.local[key]).v===4,'unknown future version preserved');
  h.clear();h.changed();h.result({status:'invalid',score:0});ok(JSON.parse(x.local[key]).inputs.code==='answer' && !JSON.parse(x.local[key]).result,'invalid check flushes pending input without grade');
  h.clear();x.input({code:'ø'.repeat(33000)});h.result({status:'wrong',score:0});ok(!x.local[key],'64KiB measures UTF8');
  h.result({status:'wrong',score:0});ok(x.events.filter(function(event){return event.type==='ctm:store-message';}).length===1,'oversize notice once');
  x.input({code:'answer'});h.result({status:'partial',score:.5});ok(JSON.parse(x.local[key]).result.score===.5,'last result stored');
  x.store.seed();x.local['ctm|1|other|x|ex']='other';var cleared=x.clears();x.store.setEnabled(false);
  ok(!x.local[key] && x.local['ctm|1|other|x|ex']==='other','off deletes only this course');
  ok(x.clears()===cleared,'off preserves active editor');
  ok(!!x.session['ctm|1|%2Fcourse%2F|~seed'] && !x.local['ctm|1|%2Fcourse%2F|~seed'],'off seed in session');
  x.store.setEnabled(true);ok(!x.session['ctm|1|%2Fcourse%2F|~seed'] && !!x.local['ctm|1|%2Fcourse%2F|~seed'],'seed follows on');
  var v=setup(),vk=v.store.key('ex'),deployed=[{n:2,id:'two',hash:'b'},{n:1,id:'one',hash:'a'}];
  var vh=v.register({variant:function(){return deployed[0];},variants:function(){return deployed;}});
  v.local[vk]=JSON.stringify(record({variant:{n:1,id:'one',hash:'a'},seen:[1]}));
  ok(vh.restore().variant.n===1,'variant hash exact');
  deployed[1].hash='edited';ok(vh.restore().state==='changed','variant n fallback changed');
  deployed.pop();ok(vh.restore().state==='withdrawn','variant withdrawn');
  vh.result({status:'correct',score:1});ok(JSON.stringify(JSON.parse(v.local[vk]).seen)==='[1,2]','seen cycle retained');
  var l=setup(),lk=l.store.key('ex'),removed=0,reads=0;
  l.local[lk]=JSON.stringify(record());var lh=l.register({legacy:[{read:function(){reads++;return {inputs:{code:'legacy'}};},remove:function(){removed++;}}]});
  ok(lh.restore().state==='restored' && l.writes[0].value.code==='legacy' && removed===1,'legacy after new wins');
  l.store.setEnabled(false);lh.restore();ok(reads===1,'off never reads legacy');
  var q=setup({},null,function(){return true;}),deleted=false;
  var qh=q.register({legacy:[{read:function(){return {inputs:{code:'legacy'}};},remove:function(){deleted=true;}}]});
  qh.restore();ok(!deleted,'quota never deletes legacy');
  ok(qh.restore().state==='restored','quota memory restores');
  q.local[q.store.key('persisted')]=JSON.stringify(record());q.store.setEnabled(false);ok(!q.local[q.store.key('persisted')],'quota still deletes durable keys');
  var n=setup(),nk=n.store.key('ex');n.local[nk]=JSON.stringify(record());removed=0;
  var nh=n.register({legacy:[{read:function(){return {inputs:null};},remove:function(){removed++;}}]});
  ok(nh.restore().state==='empty' && !n.local[nk] && removed===1,'legacy starter deletes safely');
  var m=setup({exercises:[{id:'ex',save:false}]}),mh=m.register();mh.result({status:'correct',score:1});ok(!m.local[m.store.key('ex')],'duplicate manifest disabled');
  var full=true,r=setup({}, {'ctm|1|%2Fcourse%2F|chapter%2Fx|old':JSON.stringify(record())},function(){return full;});
  r.register().result({status:'wrong',score:0});full=false;r.store.setEnabled(false);var reload=setup({},r.local);
  ok(!reload.store.enabled(),'quota recovery persists off preference across reload');
  ok(!reload.local[reload.store.key('old')],'durable deletion survives reload');
  return count;
}
test('shared store contracts and durable quota recovery',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../_extensions/ctm-libs/ui/ctm-store.js'),'utf8');
 assert.equal(checkStore(source,assert.ok),26);
});
