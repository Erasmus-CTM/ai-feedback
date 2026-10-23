const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const C=require('./helpers/ctm-libs.cjs');
const skip=C.hasQuarto?false:'Quarto required';

function render({website=false,embed=false,standalone=false,revealOnly=false,latex=false},check){
  const dir=C.tempdir('ctm-layout-render-');
  try{
    C.installPackage(dir);C.install(dir);
    const component=`local ctm=rawget(_G,'__ctmLibs')
return {{Pandoc=function(doc)
  ctm.ui.exercise({component='math-exercise',id='saved',source='0123456789abcdef'})
  doc.blocks:insert(pandoc.RawBlock('html','<div id="late-component">Component tail</div>'))
  ${standalone?"doc=ctm.ui.finalize(doc)\n  doc.blocks:insert(pandoc.RawBlock('html','<p id=\"after-first-finalize\">Last standalone tail</p>'))\n  doc=ctm.ui.finalize(doc)":''}
  return doc
end}}`;
    const filters=['ctm-libs',...(revealOnly?[]:['component.lua']),...(standalone?[]:['_extensions/ctm-libs/ctm-libs-end.lua'])];
    C.write(dir,{'_quarto.yml':`project:\n  type: ${website?'website':'default'}\nfilters: [${filters.join(', ')}]\nctm-assessment:\n  progress: true\nformat:\n  html:\n    embed-resources: ${embed}\n`,
      'page.qmd':'---\ntitle: Layout lifecycle\n---\n\n::: {.reading-step}\nReveal body.\n:::\n\n<p id="authored-tail">Last authored paragraph.</p>\n',
      'component.lua':component});
    const result=C.render(dir,['page.qmd',...(latex?['--to','latex']:[])]);
    assert.equal(result.status,0,result.stderr);
    const target=path.join(dir,website?'_site':'',latex?'page.tex':'page.html');
    check(fs.readFileSync(target,'utf8'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

function checkHTML(html,{embed=false,standalone=false,revealOnly=false}={}){
  const document=new JSDOM(html).window.document;
  const markers=document.querySelectorAll('#ctm-layout-ready');assert.equal(markers.length,1);
  const marker=markers[0];assert.equal(marker.hidden,true);
  for(const id of ['authored-tail',...(revealOnly?[]:['late-component','ctm-store-manifest']),...(standalone?['after-first-finalize']:[])]){
    const element=document.getElementById(id);assert.ok(element,id);
    assert.ok(marker.compareDocumentPosition(element)&2,'all required content precedes the completion marker: '+id);
  }
  if(embed){
    assert.doesNotMatch(html,/quarto-contrib\/ctm-layout-/);
    assert.equal(html.split('root.CTMLayout = {version: 1').length,2,'one embedded canonical helper');
  }else{
    const scripts=[...document.head.querySelectorAll('script[src]')].map(node=>node.getAttribute('src'));
    const helpers=scripts.filter(src=>/\/ctm-layout-[^/]+\/ctm-layout\.js$/.test(src));assert.equal(helpers.length,1);
    const helper=scripts.indexOf(helpers[0]);
    for(const name of ['ctm-reveal','ctm-store','ctm-progress']){
      const dependent=scripts.findIndex(src=>src.includes('/'+name+'-'));
      if(dependent!==-1)assert.ok(helper<dependent,'helper precedes '+name);
    }
  }
}

test('the umbrella finalizer seals shared reveal/store/progress content after all components',{skip},()=>render({},html=>checkHTML(html)));
test('standalone re-finalization moves exactly one marker after the new manifest and tail',{skip},()=>render({standalone:true},html=>checkHTML(html,{standalone:true})));
test('reveal-only umbrella pages receive the same actual end marker',{skip},()=>render({revealOnly:true},html=>checkHTML(html,{revealOnly:true})));
test('embedded website delivery retains one canonical helper and the final marker',{skip},()=>render({website:true,embed:true},html=>checkHTML(html,{embed:true})));
test('non-HTML output has no layout dependency or completion marker',{skip},()=>render({latex:true},text=>assert.doesNotMatch(text,/ctm-layout-ready|ctm-layout\.js/)));
