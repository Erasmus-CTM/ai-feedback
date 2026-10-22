// AGPL-3.0-or-later. Exercise the real production Meta return and MathJax loader.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const C = require('./helpers/ctm-libs.cjs');
const table = JSON.parse(fs.readFileSync(path.join(C.library, 'assets.json'), 'utf8'));
const runtime = fs.readFileSync(path.join(C.library, 'runtime/pyodide-runtime.js'), 'utf8');
const pyVersion = runtime.match(/var indexURL = '[^']+\/v([^/]+)\/full\/';/)[1];
const customURL = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml-full.js?author=1&custom=2';
const polyfillURL = 'https://cdnjs.cloudflare.com/polyfill/v3/polyfill.min.js?features=es6';
const config = 'window.MathJax = {tex: {macros: {RR: "\\\\mathbb{R}"}}};';
function inspect(html) {
  const doc = new JSDOM(html).window.document;
  const scripts = [...doc.querySelectorAll('script')];
  const polyfill = scripts.filter(s => s.getAttribute('src') === polyfillURL);
  return {
    polyfill: polyfill.length,
    scripts: scripts.filter(s => !polyfill.includes(s)).map(s => s.outerHTML),
    mathjax: scripts.filter(s => /mathjax/i.test(s.getAttribute('src') || '')).map(s => s.outerHTML),
    config: doc.getElementById('author-config').textContent,
    math: [...doc.querySelectorAll('.math')].map(n => ({className:n.className,text:n.textContent}))
  };
}
function render(local, nested, custom, legacy = false) {
  const dir = C.tempdir('ctm-production-mathjax-');
  const page = nested ? 'sub/page.qmd' : 'page.qmd';
  try {
    C.install(dir);
    if (legacy) {
      const file = path.join(dir, '_extensions/ctm-libs/lua/assets.lua');
      const source = fs.readFileSync(file, 'utf8');
      const flag = 'if tostring(method):lower() == "mathjax" then meta.mathjax = false end';
      assert.ok(source.includes(flag), 'baseline mutation must remove the actual production flag');
      // Retain the existing local-mode behavior while restoring the old CDN template flag.
      fs.writeFileSync(file, source.replace(flag, 'if M.mode() == "local" and tostring(method):lower() == "mathjax" then meta.mathjax = false end'));
    }
    const versions = Object.fromEntries(Object.entries(table.assets).map(([k,v]) => [k,v.version]));
    versions.pyodide = pyVersion;
    C.write(dir, {
      '_quarto.yml': 'project:\n  type: default\n  resources: ["_ctm-assets/**"]\nformat:\n  html:\n    theme: [default, offline.scss]\n'
        + (custom ? '    html-math-method:\n      method: mathjax\n      url: "' + customURL + '"\n' : '')
        + '    include-in-header:\n      text: |\n        <script id="author-config">' + config + '</script>\n'
        + 'filters: [ctm-libs]\nctm-assessment:\n  assets: ' + (local ? 'local' : 'cdn') + '\nai-feedback:\n  enabled: false\n',
      'offline.scss': '/*-- scss:defaults --*/\n$web-font-path: false;\n',
      '_ctm-assets/manifest.json': JSON.stringify({v:1,versions,files:{}}),
      [page]: '---\ntitle: Production MathJax\n---\n\nInline $x^2+1$.\n\n$$\\int_0^1 x\\,dx$$\n'
    });
    const result = C.render(dir, [page, '--to', 'html'], {CTM_COMPONENT_DEV:'1'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const log = (result.stdout + result.stderr).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
    assert.doesNotMatch(log, /\b(?:warning|error)\b/i);
    const html = C.html(dir, page);
    if (process.env.CTM_MATHJAX_RENDER_DIR) {
      const out = path.resolve(process.env.CTM_MATHJAX_RENDER_DIR);
      fs.mkdirSync(out,{recursive:true});
      const name = [local?'local':'cdn',nested?'nested':'root',custom?'custom':'default',legacy?'legacy':'production'].join('-');
      fs.writeFileSync(path.join(out,name+'.html'),html);
      fs.writeFileSync(path.join(out,name+'.log'),result.stdout+result.stderr);
    }
    return inspect(html);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
}
for (const local of [false,true]) for (const nested of [false,true]) for (const custom of [false,true]) {
  test('production MathJax preserves ' + (local?'local':'CDN') + '/' + (nested?'nested':'root') + '/' + (custom?'custom':'default'), {skip:!C.hasQuarto}, () => {
    const baseline = render(local,nested,custom,true), actual = render(local,nested,custom);
    assert.equal(baseline.polyfill, local?0:1, 'positive legacy baseline');
    assert.equal(actual.polyfill,0);
    assert.equal(actual.mathjax.length,1);
    assert.deepEqual(actual.scripts,baseline.scripts,'every other script and attribute stays identical');
    assert.deepEqual(actual.mathjax,baseline.mathjax);
    assert.equal(actual.config,config);
    assert.deepEqual(actual.math,baseline.math);
    assert.equal(actual.math.length,2);
    const script = JSDOM.fragment(actual.mathjax[0]).firstChild;
    if (local) {
      assert.equal(script.getAttribute('src'),(nested?'..':'.') + '/_ctm-assets/' + table.assets.mathjax3.local.replace('{version}',table.assets.mathjax3.version) + 'es5/tex-chtml-full.js');
      assert.equal(script.id,'MathJax-script');
      assert.equal(script.hasAttribute('async'),true);
      assert.equal(script.getAttribute('type'),'text/javascript');
    } else if (custom) assert.equal(script.getAttribute('src'),customURL);
    else assert.match(script.getAttribute('src'),/^https:\/\/cdn\.jsdelivr\.net\/npm\/mathjax/);
  });
}
