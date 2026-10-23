const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const C=require('./helpers/ctm-libs.cjs');
const available=require('node:child_process').spawnSync(C.quarto,['--version'],{encoding:'utf8'});
const skip=available.status===0?false:'Quarto required';
function project(files, run) {
  const dir=C.tempdir('ctm-variant-settings-');
  try {C.installPackage(dir);C.install(dir);C.installProbe(dir);C.write(dir,files);run(dir);}
  finally {fs.rmSync(dir,{recursive:true,force:true});}
}
const probe=C.probe('approval','ctm.variants.use()\nreturn {approval=ctm.variants.approval(), mode=ctm.variants.renderMode(), preview=ctm.variants.renderMode("preview")}');
test('variant approval reads nested leaves across project, metadata and page; emits chooser', {skip},()=>project({
  '_quarto.yml':'project:\n  type: default\n  render: [page.qmd, override.qmd]\nfilters: [ctm-libs, probe]\nctm-assessment:\n  variants:\n    approval: optional\n',
  '_metadata.yml':'ctm-assessment:\n  variants:\n    target: 25\n',
  '_quarto-first.yml':'ctm-assessment:\n  variants:\n    approval: required\n',
  '_quarto-second.yml':'ctm-assessment:\n  variants:\n    approval: optional\n',
  'page.qmd':'---\nctm-assessment:\n  variants:\n    another: true\n---\n'+probe,
  'override.qmd':'---\nctm-assessment:\n  variants:\n    approval: required\n---\n'+probe,
},dir=>{
  const r=C.render(dir,[],{CTM_VARIANTS:''});assert.equal(r.status,0,r.stderr);
  assert.deepEqual(C.probes(C.html(dir,'page.qmd')).approval,{approval:'optional',mode:'publish',preview:'preview'});
  assert.deepEqual(C.probes(C.html(dir,'override.qmd')).approval,{approval:'required',mode:'publish',preview:'preview'});
  assert.match(C.html(dir,'page.qmd'),/ctm-variants[^"\n]*\/variants\.js/);
  const profiles=C.render(dir,['page.qmd','--profile','first,second'],{CTM_VARIANTS:''});assert.equal(profiles.status,0,profiles.stderr);
  assert.equal(C.probes(C.html(dir,'page.qmd')).approval.approval,'required','first profile approval leaf wins over second while page siblings preserve it');
}));
test('required default and explicit environment overrides keep review separate from approval', {skip},()=>project({
  '_quarto.yml':'project:\n  type: default\nfilters: [ctm-libs, probe]\n',
  'page.qmd':probe,
},dir=>{
  for(const [env,approval,mode] of [['','required','publish'],['optional','optional','publish'],['required','required','publish'],['review','required','review']]) {
    const r=C.render(dir,['page.qmd'],{CTM_VARIANTS:env});assert.equal(r.status,0,r.stderr);
    const p=C.probes(C.html(dir,'page.qmd')).approval;assert.equal(p.approval,approval);assert.equal(p.mode,mode);
  }
  const bad=C.render(dir,['page.qmd'],{CTM_VARIANTS:'open'});assert.notEqual(bad.status,0);assert.match(bad.stderr,/CTM_VARIANTS must be required, optional or review/);
  C.write(dir,{'_quarto.yml':'project:\n  type: default\nfilters: [ctm-libs, probe]\nctm-assessment:\n  variants:\n    approval: open\n'});
  const schema=C.render(dir,['page.qmd'],{CTM_VARIANTS:''});assert.notEqual(schema.status,0);assert.match(schema.stderr,/variants.approval must be required or optional/);
}));
