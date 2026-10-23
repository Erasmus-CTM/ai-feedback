// Store/copy/export contracts in Chromium, Firefox and WebKit without Python.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import playwright from 'playwright';
const ROOT=process.cwd(), names=process.argv.slice(2).length?process.argv.slice(2):['chromium'];
const FIXTURE="<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"quarto:offset\" content=\"../\"><title>Store browser fixture</title>\n<script src=\"/assets/ctm-layout.js\" defer><script src=\"/assets/ctm-copy.js\" defer></script><script src=\"/assets/ctm-store.js\" defer></script><script src=\"/assets/ctm-export.js\" defer></script></head><body>\n<main><h1>Browser answers</h1><div class=\"ctm-save-bar\" hidden><p class=\"ctm-save-notice\"></p><button data-ctm-clear-page>Delete page</button><button data-ctm-clear-course>Delete course</button><button data-ctm-save-toggle>Do not save</button><button data-ctm-export>Export answers</button><span class=\"ctm-save-status\" role=\"status\" aria-live=\"polite\"></span></div>\n<section id=\"ex\"><label for=\"answer\">Answer</label><textarea id=\"answer\"></textarea><button id=\"check\">Check fixture</button><button id=\"reset\">Reset fixture</button><button id=\"copy\">Copy fixture</button><p id=\"state\"></p><pre id=\"previous\"></pre></section></main>\n<script id=\"ctm-store-manifest\" type=\"application/json\">{\"v\":1,\"course\":\"/browser-course/\",\"save\":true,\"export\":true,\"exercises\":[{\"id\":\"ex\",\"component\":\"code\",\"save\":true}],\"messages\":{\"exportTitle\":\"Export answers\",\"copyAll\":\"Copy all\",\"downloadMarkdown\":\"Download .md\",\"downloadHTML\":\"Download .html\",\"exportClose\":\"Close export\",\"locale\":\"en\"}}</script>\n<script>\ndocument.addEventListener('DOMContentLoaded',function(){\n  var input=document.getElementById('answer');\n  window.checks=0;\n  window.handle=CTMStore.register({component:'code',id:'ex',source:'__SOURCE__',element:document.getElementById('ex'),\n    read:function(){return input.value?{code:input.value}:null;},write:function(inputs){input.value=inputs.code;},clear:function(){input.value='';},\n    exportItem:function(){return {title:'Fixture exercise',parts:[{kind:'code',text:input.value},{kind:'output',text:'last output'}]};}});\n  var restored=handle.restore();document.getElementById('state').textContent=restored.state;\n  if(restored.record && restored.state!=='restored')document.getElementById('previous').textContent=restored.record.inputs.code;\n  input.addEventListener('input',function(){handle.changed();});\n  document.getElementById('check').onclick=function(){window.checks++;handle.result({status:'partial',score:.5});};\n  document.getElementById('reset').onclick=function(){handle.clear();};\n  document.getElementById('copy').onclick=function(){window.copyOutcome=CTMCopy.text(input.value,{label:'Copy fixture'}).then(function(value){window.copyMethod=value.method;});};\n});\n</script></body></html>";
const scripts=Object.fromEntries(['ctm-layout.js','ctm-store.js','ctm-copy.js','ctm-export.js'].map(name=>[name,fs.readFileSync(path.join(ROOT,'_extensions/ctm-libs/ui',name))]));
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/assets/')){
    const body=scripts[url.pathname.slice('/assets/'.length)];
    if(!body){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type','text/javascript');res.end(body);return;
  }
  res.setHeader('Content-Type','text/html;charset=utf-8');
  res.end(FIXTURE.replace('__SOURCE__',url.searchParams.has('changed')?'fedcba9876543210':'0123456789abcdef'));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
try{
  for(const name of names){
    const options={headless:true};
    if(name==='chromium' && process.env.CHROMIUM_PATH)options.executablePath=process.env.CHROMIUM_PATH;
    const browser=await playwright[name].launch(options);
    try{
      const context=await browser.newContext();
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(String(error)));
      await page.goto(origin+'/course/chapter/page.html');
      await page.waitForFunction(()=>window.handle);
      await page.locator('#answer').fill('print(42)');
      await page.locator('#check').click();
      assert.equal(await page.evaluate(()=>window.checks),1);
      await page.reload();await page.waitForFunction(()=>window.handle);
      assert.equal(await page.locator('#answer').inputValue(),'print(42)');
      assert.equal(await page.evaluate(()=>window.checks),0,'reload never runs a check');
      assert.equal(await page.locator('#state').textContent(),'restored');
      await page.goto(origin+'/course/chapter/page');
      await page.waitForFunction(()=>window.handle);
      assert.equal(await page.locator('#answer').inputValue(),'print(42)','extensionless URL shares answer');
      await page.goto(origin+'/course/chapter/page.html?changed');
      await page.waitForFunction(()=>window.handle);
      assert.equal(await page.locator('#answer').inputValue(),'','changed source is never auto-filled');
      assert.equal(await page.locator('#previous').textContent(),'print(42)');
      assert.equal(await page.locator('#state').textContent(),'changed');
      await page.goto(origin+'/course/chapter/page.html');await page.waitForFunction(()=>window.handle);
      await page.locator('#answer').fill('<script>throw Error("must remain text")</script>');
      await page.locator('#check').click();
      await page.getByRole('button',{name:'Export answers',exact:true}).click();
      const exported=page.locator('#ctm-export-view');
      assert.match(await exported.locator('textarea').inputValue(),/last output/);
      assert.match(await exported.locator('textarea').inputValue(),/50 %/,'last result is exported');
      assert.equal(await exported.locator('button').first().textContent(),'Copy all');
      const html=await page.evaluate(()=>CTMExport.open().html);
      assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
      await page.getByRole('button',{name:'Close export',exact:true}).click();
      await page.evaluate(()=>{
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('blocked');}}});
        document.execCommand=()=>false;
      });
      await page.locator('#copy').click();await page.waitForFunction(()=>window.copyMethod==='select');
      const selected=page.locator('dialog textarea');
      assert.match(await selected.inputValue(),/must remain text/);
      assert.equal(await selected.evaluate(el=>el.selectionEnd-el.selectionStart), (await selected.inputValue()).length);
      await page.getByRole('button',{name:'Close',exact:true}).click();
      assert.equal(await page.evaluate(()=>document.activeElement.id),'copy','manual copy close restores keyboard focus');
      const other=await context.newPage();await other.goto(origin+'/course/chapter/page.html');await other.waitForFunction(()=>window.handle);
      await page.evaluate(()=>{localStorage.setItem('ctm|1|other-course|page|ex','other');document.getElementById('answer').value='pending';handle.changed();});
      await other.evaluate(()=>CTMStore.setEnabled(false));
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(()=>localStorage.getItem(CTMStore.key('ex'))),null,'other tab optout cancels pending autosave');
      assert.equal(await page.evaluate(()=>localStorage.getItem('ctm|1|other-course|page|ex')),'other','other course untouched');
      assert.equal(await page.locator('#answer').inputValue(),'pending','switch off preserves current editor');
      assert.equal(await page.evaluate(()=>CTMStore.enabled()),false);
      await other.evaluate(()=>CTMStore.setEnabled(true));
      await page.evaluate(()=>{document.getElementById('answer').value='saved';handle.result({status:'partial',score:.5});});
      await other.evaluate(()=>{handle.restore();document.getElementById('answer').value='pending clear';handle.changed();});
      await page.evaluate(()=>CTMStore.clearPage());
      await other.waitForTimeout(350);
      assert.equal(await other.evaluate(()=>localStorage.getItem(CTMStore.key('ex'))),null,'other tab page clear cancels pending autosave');
      await page.evaluate(()=>{document.getElementById('answer').value='saved again';handle.result({status:'partial',score:.5});});
      await other.evaluate(()=>{handle.restore();document.getElementById('answer').value='pending course clear';handle.changed();});
      await page.evaluate(()=>CTMStore.clearCourse());
      await other.waitForTimeout(350);
      assert.equal(await other.evaluate(()=>localStorage.getItem(CTMStore.key('ex'))),null,'other tab course clear cancels pending autosave');
      assert.deepEqual(errors,[],'no browser exceptions');
      await context.close();
      const blocked=await browser.newContext();
      await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('blocked','SecurityError');}}));
      const privatePage=await blocked.newPage();await privatePage.goto(origin+'/course/chapter/page.html');await privatePage.waitForFunction(()=>window.handle);
      await privatePage.locator('#answer').fill('in memory');await privatePage.locator('#check').click();
      assert.equal(await privatePage.evaluate(()=>handle.restore().state),'restored');
      assert.match(await privatePage.locator('.ctm-save-status').textContent(),/memory/);
      await blocked.close();
      console.log(name+': saved answers, cross-tab optout, copy fallback and selectable export passed');
    }finally{await browser.close();}
  }
}finally{await new Promise(resolve=>server.close(resolve));}
