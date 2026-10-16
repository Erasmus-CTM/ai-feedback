const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const F=require('../_extensions/ai-feedback/feedback-core.js');
const quarto=process.env.QUARTO_BIN||'quarto';
const available=!spawnSync(quarto,['--version']).error;
test('Quarto validates explicit selections, inheritance and renamed prompts before browser use',{skip:available?false:'Quarto required'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feedback-policies-'));
 try{
  fs.cpSync(path.join(__dirname,'../_extensions/ai-feedback'),path.join(dir,'_extensions/ai-feedback'),{recursive:true});
  const yaml=String.raw`ai-feedback:
  policies:
    child:
      extends: parent
      max-words: 80
    parent:
      base-prompt: |
        Preserve \(x^2\).
        extends: null
      steps:
        - step-prompt: Ask about \(x^2\).
    reset:
      extends: parent
`;
  fs.writeFileSync(path.join(dir,'base.yml'),yaml);
  fs.writeFileSync(path.join(dir,'page.yml'),'ai-feedback:\n  policies:\n    reset:\n      extends: null\n      max-words: 95\n');
  function render(metadata,policyFile='base.yml'){
   fs.writeFileSync(path.join(dir,'lesson.qmd'),'---\nformat: html\nfilters: [ai-feedback]\nai-feedback:\n  policy-files: '+policyFile+'\n'+metadata+'---\n\n::: {.ai-feedback}\nExplain a half.\n:::\n');
   return spawnSync(quarto,['render','lesson.qmd'],{cwd:dir,encoding:'utf8',timeout:60000});
  }
  function config(){const html=fs.readFileSync(path.join(dir,'lesson.html'),'utf8');return JSON.parse(html.match(/window\.__aiFeedbackPolicies = (.*?);<\/script>/s)[1]);}
  let r=render('');assert.equal(r.status,0,r.stderr);assert.equal(F.resolvePolicy('math-exercise','en',{},config()).steps.length,4);
  r=render('  page-policy: child\n');assert.equal(r.status,0,r.stderr);
  let p=F.resolvePolicy('math-exercise','en',{},config());assert.equal(p['max-words'],80);assert.equal(p.steps.length,1);assert.ok(p['base-prompt'].includes(String.raw`\(x^2\)`));assert.ok(p['base-prompt'].includes('extends: null'));
  r=render('  page-policy-files: page.yml\n  page-policy: reset\n');assert.equal(r.status,0,r.stderr);p=F.resolvePolicy('math-exercise','en',{},config());assert.equal(p.steps.length,4);assert.equal(p['max-words'],95);
  for (const parent of ['null','~','','Null']) {
   fs.writeFileSync(path.join(dir,'page.yml'),'ai-feedback:\n  policies:\n    reset: {"extends": '+parent+', max-words: 95}\n');
   r=render('  page-policy-files: page.yml\n  page-policy: reset\n');assert.equal(r.status,0,r.stderr);assert.equal(F.resolvePolicy('math-exercise','en',{},config()).steps.length,4);
  }
  fs.writeFileSync(path.join(dir,'raw.yml'),`ai-feedback:
  policies:
    _parent_:
      base-prompt: 'Keep this line.
        extends: null
        End.'
    child:
      extends: _parent_
`);
  r=render('  page-policy: _parent_\n','raw.yml');assert.equal(r.status,0,r.stderr);assert.equal(config().pagePolicy,'_parent_');
  r=render('  page-policy: child\n','raw.yml');assert.equal(r.status,0,r.stderr);assert.equal(F.resolvePolicy('plain-text','en',{},config())['base-prompt'],'Keep this line. extends: null End.');
  r=render('  page-policy: [child]\n','raw.yml');assert.notEqual(r.status,0);
  assert.equal(fs.existsSync(path.join(dir,'deno.lock')),false);
  for(const [body,pattern] of [
   ['ai-feedback:\n  policies:\n    x:\n      prompt: OLD\n',/base-prompt/],
   ['ai-feedback:\n  policies:\n    x:\n      steps:\n        - prompt: OLD\n',/step-prompt/],
   ['ai-feedback:\n  policies:\n    x:\n      extends: missing\n',/unknown parent/i],
   ['ai-feedback:\n  policies:\n    alpha:\n      extends: beta\n    beta:\n      extends: alpha\n',/circular/i],
   ['ai-feedback:\n  policies:\n    x:\n      extends: ""\n',/non-empty/i],
   ['ai-feedback:\n  policies:\n    x: {extends: CTMNULLPARENT08MARKER}\n',/Unknown parent/],
   ['ai-feedback:\n  defaults:\n    max-words: 80\n',/only define policies/i],
  ]){fs.writeFileSync(path.join(dir,'invalid.yml'),body);r=render('','invalid.yml');assert.notEqual(r.status,0,body);assert.match(r.stderr,pattern);}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
