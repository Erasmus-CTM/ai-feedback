const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const C = require('./helpers/ctm-libs.cjs');
const skip = C.hasQuarto ? false : 'Quarto required';
const cell = id => '\n~~~{.python #' + id + '}\nprint(1)\n~~~\n';
function render(body, code, endFilter = false) {
  const dir = C.tempdir('ctm-progress-');
  try {
    C.installPackage(dir); C.install(dir); C.installProbe(dir);
    C.write(dir, {'page.qmd':'---\ntitle: t\nfilters: [ctm-libs, probe' + (endFilter ? ', _extensions/ctm-libs/ctm-libs-end.lua' : '') + ']\n---\n' + body + C.probe('scope',code)});
    const result = C.render(dir,['page.qmd']);
    return {result,html:result.status === 0 ? C.html(dir,'page.qmd') : ''};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
test('quiz scope includes subsections and nested tabs and resumes after a tabset', {skip}, () => {
  const body = '## Outer {quiz=q}\n' + cell('a')
    + '\n::: {.panel-tabset}\n### One\n' + cell('b')
    + '\n:::: {.panel-tabset}\n#### Inner\n' + cell('c') + '\n::::\n'
    + '\n### Two\n' + cell('d') + '\n:::\n'
    + '\n### Subsection\n' + cell('e') + '\n## Next\n' + cell('outside');
  const code = 'local out = {}\nfor _, id in ipairs({"a","b","c","d","e","outside"}) do out[id] = ctm.progress.quizFor(id) or false end\nreturn out';
  const {result,html} = render(body,code);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(C.probes(html).scope,{a:'q',b:'q',c:'q',d:'q',e:'q',outside:false});
  assert.match(html,/data-ctm-quiz="q"/);
});
test('empty marker applies only to remainder of its heading section', {skip}, () => {
  const {result,html} = render('## Topic\n' + cell('before') + '\n::: {.quiz #marked}\n:::\n' + cell('after')
    + '\n## Next\n' + cell('next'),
    'return {before=ctm.progress.quizFor("before") or false, after=ctm.progress.quizFor("after"), next=ctm.progress.quizFor("next") or false}');
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(C.probes(html).scope,{before:false,after:'marked',next:false});
});
test('tab quiz inherits title and ends at the sibling tab; outer quiz resumes', {skip}, () => {
  const body = '## Outer {quiz=outer}\n' + cell('a') + '\n::: {.panel-tabset}\n### First\n'
    + '\n::: {.ctm-tab-target #tab quiz=inner}\n:::\n' + cell('b')
    + '\n### Second\n' + cell('c') + '\n:::\n' + cell('d');
  const {result,html} = render(body,
    'return {a=ctm.progress.quizFor("a"),b=ctm.progress.quizFor("b"),c=ctm.progress.quizFor("c"),d=ctm.progress.quizFor("d")}');
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(C.probes(html).scope,{a:'outer',b:'inner',c:'outer',d:'outer'});
});
for (const [name,body,code,message] of [
  ['duplicate','## A {quiz=q}\n'+cell('a')+'\n## B {quiz=q}\n'+cell('b'),'return true',/Duplicate quiz id/],
  ['reveal','::: {.reading-step}\n\n## Hidden {quiz=q}\n'+cell('a')+'\n:::','return true',/inside a reveal/],
  ['empty','## Empty {quiz=q}','return ctm.progress.finalize({})',/has no exercises/]
]) test('quiz render error: '+name,{skip},()=>{
  const {result}=render(body,code);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,message);
});

test('component source hash resolves quoted labels without another YAML parser', {skip}, () => {
  const body = '## Quiz {quiz=q}\n\n~~~python\n#| label: "quoted-label"\nprint("quoted-body")\n~~~\n';
  const code = [
    'local found',
    'doc.blocks:walk({CodeBlock=function(b)',
    '  if b.text:find("quoted%-body") and not b.classes:includes("ctm-probe") then',
    '    found = ctm.progress.quizFor("component-parsed-label",pandoc.utils.sha1(b.text):sub(1,16))',
    '  end',
    'end})',
    'return found'
  ].join('\n');
  const {result,html} = render(body,code);
  assert.equal(result.status,0,result.stderr);
  assert.equal(C.probes(html).scope,'q');
});
test('identical source in different quiz scopes has no source-only association', {skip}, () => {
  const body = '## Quiz {quiz=q}\n' + cell('inside') + '\n## Outside\n' + cell('outside');
  const code = 'return ctm.progress.quizFor("unknown",pandoc.utils.sha1("print(1)"):sub(1,16)) or false';
  const {result,html} = render(body,code);
  assert.equal(result.status,0,result.stderr);
  assert.equal(C.probes(html).scope,false);
});

test('production package end filter rejects an empty quiz without registered components', {skip}, () => {
  const {result} = render('## Empty {quiz=q}','return true',true);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/has no exercises/);
});

test('every block carries source-order identity and an explicit quiz scope even for identical text', {skip}, () => {
  const body='## Quiz {quiz=q}\n'+cell('inside')+'\n## Outside\n'+cell('outside');
  const code=[
    'local out = {}',
    'doc.blocks:walk({CodeBlock=function(b)',
    ' if not b.classes:includes("ctm-probe") then out[#out+1]={',
    '  order=b.attributes["__ctm-order"],runtime=b.attributes["__ctm-runtime-id"],',
    '  quiz=ctm.progress.quizFor("same",pandoc.utils.sha1(b.text):sub(1,16),b) or false}',
    ' end',
    'end})',
    'return out'
  ].join('\n');
  const {result,html}=render(body,code);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(C.probes(html).scope,[
    {order:'1',runtime:'ctm-block-1',quiz:'q'},
    {order:'2',runtime:'ctm-block-2',quiz:false}
  ]);
});

test('production end filter strips private annotations on pages with only ordinary code', {skip}, () => {
  const {result,html}=render('~~~{.python #ordinary data-keep="kept"}\nprint(1)\n~~~\n','return true',true);
  assert.equal(result.status,0,result.stderr);
  assert.doesNotMatch(html,/data-__ctm-/);
  assert.match(html,/data-keep="kept"/);
});
test('end cleanup preserves registered component counts, source order, quiz and public data attributes', {skip}, () => {
  const body='## Quiz {quiz=q}\n~~~{.python #ordinary data-keep="kept" data-ctm-example="public"}\nprint(1)\n~~~\n'
    + '~~~{.math-registration #math-one}\nquestion\n~~~\n'
    + '~~~{.py-registration #py-one}\npass\n~~~\n'
    + '## Outside\n~~~{.math-registration}\nother question\n~~~\n';
  const code=[
    'local out={}',
    'doc.blocks:walk({CodeBlock=function(b)',
    ' local component=b.classes:includes("math-registration") and "math-exercise"',
    '   or b.classes:includes("py-registration") and "py-exercise"',
    ' if component then',
    '  local registered=ctm.ui.exercise({component=component,id=b.identifier,',
    '   source=pandoc.utils.sha1(b.text):sub(1,16),block=b})',
    '  out[#out+1]=registered.attributes',
    ' end',
    'end})',
    'return out'
  ].join('\n');
  const {result,html}=render(body,code,true);
  assert.equal(result.status,0,result.stderr);
  assert.doesNotMatch(html,/data-__ctm-/);
  assert.match(html,/data-keep="kept"/);
  assert.match(html,/data-ctm-example="public"/);
  const manifest=JSON.parse(html.match(/id="ctm-store-manifest">([\s\S]*?)<\/script>/)[1]);
  assert.equal(manifest.exercises.length,3);
  assert.deepEqual(manifest.exercises.map(e=>e.component),['math-exercise','py-exercise','math-exercise']);
  assert.deepEqual(manifest.exercises.map(e=>e.id),['math-one','py-one','']);
  assert.deepEqual(manifest.exercises.map(e=>e.order),[2,3,4]);
  assert.deepEqual(manifest.exercises.map(e=>e.runtimeId),['ctm-block-2','ctm-block-3','ctm-block-4']);
  assert.deepEqual(manifest.exercises.map(e=>e.quiz||null),['q','q',null]);
  assert.deepEqual(manifest.quizzes.map(q=>q.id),['q']);
  assert.deepEqual(C.probes(html).scope.map(a=>a['data-ctm-runtime-id']),['ctm-block-2','ctm-block-3','ctm-block-4']);
});
