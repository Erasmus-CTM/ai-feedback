const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('./helpers/ctm-libs.cjs');
const source = fs.readFileSync(path.join(C.library, 'assets.js'), 'utf8');
function resolver(baseURI, mode, bases) {
  const context = vm.createContext({URL, document: {baseURI}, CTM_ASSETS: {v: 1, mode, bases}});
  vm.runInContext(source, context);
  return context.CTMAssets;
}
test('asset URLs are absolute at root and nested pages, with CDN bases unchanged', () => {
  const cdn = resolver('https://course.test/sub/page.html', 'cdn', {katex: 'https://cdn.test/katex@1/'});
  assert.equal(cdn.url('katex', 'dist/katex.mjs'), 'https://cdn.test/katex@1/dist/katex.mjs');
  for (const [page, base] of [['https://course.test/page.html', './_ctm-assets/'], ['https://course.test/sub/page.html', '../_ctm-assets/']]) {
    const local = resolver(page, 'local', {pyodide: base + 'pyodide/1/'});
    assert.equal(local.url('pyodide'), 'https://course.test/_ctm-assets/pyodide/1/');
    assert.equal(local.url('pyodide', 'pyodide.js'), 'https://course.test/_ctm-assets/pyodide/1/pyodide.js');
    for (const bad of ['../escape', '%2e%2e/escape', '//other.test/', 'https://other.test/', '/root', 'a\\b', 'file?x', 'file#x']) {
      assert.throws(() => local.url('pyodide', bad), /inside the selected asset/);
    }
    assert.throws(() => local.url('missing'), /unknown asset/);
  }
});
test('the shared runtime consumes the page-selected Pyodide base and preserves its canonical version line', async () => {
  const script = fs.readFileSync(path.join(C.library, 'runtime', 'pyodide-runtime.js'), 'utf8');
  assert.match(script, /\n\s*var indexURL = 'https:\/\/[^']+';/);
  const calls = [];
  const py = {};
  const context = vm.createContext({CTMAssets: {url: name => {assert.equal(name, 'pyodide'); return 'https://course.test/_ctm-assets/pyodide/test/';}},
    importScripts: url => calls.push(url), loadPyodide: async options => {calls.push(options.indexURL); return py;}});
  vm.runInContext(script, context);
  assert.equal(context.MathExerciseRuntime.indexURL, 'https://course.test/_ctm-assets/pyodide/test/');
  assert.equal(await context.MathExerciseRuntime.ensurePyodide(), py);
  assert.deepEqual(calls, ['https://course.test/_ctm-assets/pyodide/test/']);
});
const table = JSON.parse(fs.readFileSync(path.join(C.library, 'assets.json'), 'utf8'));
const runtime = fs.readFileSync(path.join(C.library, 'runtime', 'pyodide-runtime.js'), 'utf8');
const pyVersion = runtime.match(/var indexURL = '[^']+\/v([^/]+)\/full\/';/)[1];
function project({local = true, resources = true, theme = true, extra = '', front = '', nested = false, manifest = true} = {}) {
  const dir = C.tempdir('ctm-assets-');
  C.install(dir); C.installProbe(dir);
  const file = nested ? 'sub/page.qmd' : 'page.qmd';
  const versions = Object.fromEntries(Object.entries(table.assets).map(([k,v]) => [k,v.version]));
  versions.pyodide = pyVersion;
  C.write(dir, {
    '_quarto.yml': 'project:\n  type: default\n  render: [' + file + ']\n' + (resources ? '  resources: ["_ctm-assets/**"]\n' : '') +
      'filters: [ctm-libs, probe]\nformat:\n  html:\n' + (theme ? '    theme: [default, offline.scss]\n' : '') +
      'ctm-assessment:\n  assets: ' + (local ? 'local' : 'cdn') + '\nai-feedback:\n  enabled: false\n' + extra,
    'offline.scss': '/*-- scss:defaults --*/\n$web-font-path: false;\n',
    [file]: '---\ntitle: Asset probe\n' + front + '---\n\n$x^2$\n' + C.probe('asset', 'return {mode=ctm.assets.mode(), url=ctm.assets.url("pyodide"), katex=ctm.assets.url("katex", "dist/katex.mjs")}'),
    ['_ctm-assets/pyodide/' + pyVersion + '/pyodide-lock.json']: JSON.stringify({packages: {numpy: {}}})
  });
  if (manifest) C.write(dir, {'_ctm-assets/manifest.json': JSON.stringify({v:1,versions,files:{}})});
  return {dir,file,versions};
}
test('local assets select nested Lua paths, inline JS config and Quarto MathJax without a polyfill', {skip: !C.hasQuarto}, () => {
  const p = project({nested: true});
  try {
    const result = C.render(p.dir);
    assert.equal(result.status, 0, result.stderr);
    const html = C.html(p.dir, p.file), got = C.probes(html).asset;
    assert.equal(got.mode, 'local');
    assert.equal(got.url, '../_ctm-assets/pyodide/' + pyVersion + '/');
    assert.equal(got.katex, '../_ctm-assets/' + table.assets.katex.local.replace('{version}', table.assets.katex.version) + 'dist/katex.mjs');
    assert.match(html, /globalThis\.CTM_ASSETS=/);
    assert.match(html, /id="MathJax-script" async type="text\/javascript"/);
    assert.match(html, /_ctm-assets\/npm\/mathjax@[^"]+\/es5\/tex-chtml-full\.js/);
    assert.doesNotMatch(html, /polyfill\.io|https:\/\/cdn\.jsdelivr\.net\/npm\/mathjax/);
  } finally {fs.rmSync(p.dir, {recursive:true,force:true});}
});
test('CDN mode preserves normal MathJax and accepts existing URL overrides without a bundle', {skip: !C.hasQuarto}, () => {
  const p = project({local:false,manifest:false,resources:false,theme:false,extra:'pyodide:\n  base-url: https://custom.test/python/\njsxgraph:\n  src_jxg: https://custom.test/board.js\n'});
  try {
    const result = C.render(p.dir); assert.equal(result.status,0,result.stderr);
    assert.equal(C.probes(C.html(p.dir,p.file)).asset.mode,'cdn');
    assert.match(C.html(p.dir,p.file), /https:\/\/cdn\.jsdelivr\.net\/npm\/mathjax/);
  } finally {fs.rmSync(p.dir,{recursive:true,force:true});}
});
test('local preflight rejects missing bundle, wrong versions, missing resources/theme, overrides and packages outside subset', {skip: !C.hasQuarto}, () => {
  const cases = [
    [{manifest:false}, /manifest is missing or invalid/],
    [{resources:false}, /project\.resources/],
    [{theme:false}, /offline\.scss theme/],
    [{extra:'pyodide:\n  base-url: https://custom.test/\n'}, /pyodide\.base-url/],
    [{front:'pyodide:\n  build-variant: debug\n'}, /pyodide\.build-variant/],
    [{extra:'jsxgraph:\n  src_jxg: https://custom.test/board.js\n'}, /author HTTP jsxgraph\.src_jxg/],
    [{extra:'pyodide:\n  packages: [not-in-bundle]\n'}, /outside the local subset/]
  ];
  for (const [options, message] of cases) {
    const p=project(options);
    try {const r=C.render(p.dir);assert.notEqual(r.status,0);assert.match(r.stderr,message);}
    finally {fs.rmSync(p.dir,{recursive:true,force:true});}
  }
  const p=project();
  try {
    p.versions.katex='wrong';
    C.write(p.dir,{'_ctm-assets/manifest.json':JSON.stringify({v:1,versions:p.versions,files:{}})});
    const r=C.render(p.dir);assert.notEqual(r.status,0);assert.match(r.stderr,/version mismatch for katex/);
  } finally {fs.rmSync(p.dir,{recursive:true,force:true});}
});

test('local worker receives an absolute page URL and loads only subset packages without micropip', async () => {
  const W = require('./helpers/worker.cjs');
  const page = W.pageContext();
  page.CTM_ASSETS = {v:1,mode:'local'};
  page.CTMAssets = {url: name => {assert.equal(name,'pyodide');return 'https://course.test/_ctm-assets/pyodide/test/';}};
  const started=page.CTMWorker.start({indexURL:'https://ignored.test/'});
  const worker=page.workers[0], cfg=worker.posted[0].config;
  assert.equal(cfg.indexURL,'https://course.test/_ctm-assets/pyodide/test/');
  assert.equal(cfg.assetsMode,'local');
  worker.reply({type:'result',id:worker.posted[0].id,value:true});
  await started;
  const network=W.fakeNet({packages:{numpy:{imports:['numpy']}}});
  const calls=[];
  const local=W.workerContext({globals:{fetch:network.fetch},pyodide:()=>({
    loadPackage:async names=>calls.push(Array.from(names)),
    pyimport:()=>{throw new Error('local mode must not call micropip');}
  })});
  await local.init({assetsMode:'local',packages:['numpy']});
  assert.equal(local.result(0).type,'result');
  assert.deepEqual(calls,[['numpy']]);
  assert.ok(network.log.every(entry=>entry.file==='pyodide-lock.json'));
  const missing=W.workerContext({globals:{fetch:network.fetch},pyodide:()=>({
    loadPackage:async()=>{throw new Error('unknown package must be rejected before loading');}
  })});
  await missing.init({assetsMode:'local',packages:['not-installed']});
  assert.equal(missing.result(0).type,'error');
  assert.match(missing.result(0).message,/outside the local Pyodide subset/);
});
