// AGPL-3.0-or-later. Read-only Quarto/Pandoc template probe; no production filter changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {JSDOM} = require('jsdom');
const C = require('./helpers/ctm-libs.cjs');

const out = path.resolve(process.env.CTM_MATHJAX_PROBE_DIR || 'mathjax-template-probe');
fs.mkdirSync(out, {recursive: true});
const version = args => {
  const run = spawnSync(C.quarto, args, {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr || String(run.error));
  return run.stdout.trim();
};
const evidence = {quarto: version(['--version']), pandoc: version(['pandoc', '--version']),
  boundary: 'Actual rendered HTML only; no browser, CORS or full-course acceptance claim.',
  cases: [], complete: false};
assert.equal(evidence.quarto, '1.8.27', 'this checkpoint probes the exact course Quarto version');
const customURL = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml-full.js?author=1&custom=2';
const polyfillURL = 'https://cdnjs.cloudflare.com/polyfill/v3/polyfill.min.js?features=es6';
const config = 'window.MathJax = {tex: {macros: {RR: "\\\\mathbb{R}"}}};';
const source = '---\ntitle: Actual MathJax template probe\n---\n\nInline $x^2+1$.\n\n$$\\int_0^1 x\\,dx$$\n';

function inspect(html) {
  const document = new JSDOM(html).window.document;
  const scripts = [...document.querySelectorAll('script')];
  const polyfill = scripts.filter(s => s.getAttribute('src') === polyfillURL);
  const loaders = scripts.filter(s => /mathjax/i.test(s.getAttribute('src') || ''));
  const author = document.getElementById('ctm-author-mathjax-config');
  return {polyfillCount: polyfill.length,
    mathjax: loaders.map(s => ({html: s.outerHTML,
      attributes: Object.fromEntries([...s.attributes].map(a => [a.name, a.value]).sort())})),
    authorConfig: author && author.textContent,
    math: [...document.querySelectorAll('.math')].map(n => ({className: n.className, text: n.textContent})),
    scriptsWithoutPolyfill: scripts.filter(s => !polyfill.includes(s)).map(s => s.outerHTML)};
}
function render(name, page, custom, disabled) {
  const dir = C.tempdir('ctm-mathjax-template-');
  try {
    const method = custom
      ? '    html-math-method:\n      method: mathjax\n      url: "' + customURL + '"\n'
      : '';
    C.write(dir, {
      '_quarto.yml': 'project:\n  type: default\nformat:\n  html:\n' + method
        + '    include-in-header:\n      text: |\n        <script id="ctm-author-mathjax-config">' + config + '</script>\n'
        + 'filters: [probe.lua]\n',
      [page]: source,
      'probe.lua': 'function Meta(meta)\n'
        + '  local method = PANDOC_WRITER_OPTIONS.html_math_method\n'
        + '  method = type(method) == "table" and method.method or method\n'
        + '  io.stderr:write("CTM_MATHJAX_PROBE_METHOD " .. tostring(method) .. "\\n")\n'
        + (disabled ? '  meta.mathjax = false\n' : '')
        + '  return meta\nend\n',
    });
    const result = C.render(dir, [page, '--to', 'html']);
    fs.writeFileSync(path.join(out, name + '.log'), result.stdout + result.stderr);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /CTM_MATHJAX_PROBE_METHOD [Mm]ath[Jj]ax/,
      'the actual writer is using MathJax');
    const html = C.html(dir, page);
    fs.writeFileSync(path.join(out, name + '.html'), html);
    return inspect(html);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}
try {
  for (const custom of [false, true]) {
    for (const page of ['page.qmd', 'nested/page.qmd']) {
      const name = (custom ? 'custom' : 'default') + (page.startsWith('nested/') ? '-nested' : '-root');
      const baseline = render(name + '-baseline', page, custom, false);
      const disabled = render(name + '-metadata-false', page, custom, true);
      const record = {name, page, customURL: custom ? customURL : null, baseline, disabled, passed: false};
      evidence.cases.push(record);
      assert.equal(baseline.polyfillCount, 1, 'baseline must actually exercise the legacy polyfill');
      assert.equal(disabled.polyfillCount, 0, 'metadata false removes the template polyfill');
      assert.equal(baseline.mathjax.length, 1, 'one actual MathJax loader in baseline');
      assert.deepEqual(disabled.mathjax, baseline.mathjax, 'original MathJax URL and every script attribute survive');
      if (custom) assert.equal(disabled.mathjax[0].attributes.src, customURL, 'author URL/query is retained');
      assert.equal(baseline.authorConfig, config, 'the real header includes author MathJax configuration');
      assert.equal(disabled.authorConfig, config, 'author MathJax configuration survives');
      assert.equal(baseline.math.length, 2, 'actual inline and display math are emitted');
      assert.deepEqual(disabled.math, baseline.math, 'all math content and classes survive');
      assert.deepEqual(disabled.scriptsWithoutPolyfill, baseline.scriptsWithoutPolyfill,
        'every other actual script and inline configuration is byte-identical');
      record.passed = true;
      console.log('PASS ' + name + ': only the legacy polyfill script is removed');
    }
  }
  assert.equal(evidence.cases.length, 4);
  evidence.complete = true;
} catch (error) {
  evidence.failure = {message: error.message, stack: error.stack};
  throw error;
} finally {
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
}
