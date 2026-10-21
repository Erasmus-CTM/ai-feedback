// Decision 3 and §2.3/§16.5 of the step-1 design: a component finds ctm-libs
// through its ctm-bootstrap.lua (sibling first, then the project's
// _extensions with owner folders), needs the CTM Assessment package unless
// CTM_COMPONENT_DEV=1, and a page never mixes two ctm-libs versions.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const C = require('./helpers/ctm-libs.cjs');
const skip = C.hasQuarto ? false : 'Quarto required';
const INSTALL = /Install CTM Assessment: quarto add https:\/\/erasmus-ctm\.github\.io\/ctm-assessment\/ctm-assessment\.tar\.gz/;

function page(filters = 'probe') {
  return '---\ntitle: t\nfilters: [' + filters + ']\n---\n' + C.probe('where', 'return {dir = ctm.dir, version = ctm.version, api = ctm.api}');
}
function withProject(setup, run) {
  const dir = C.tempdir('ctm-bootstrap-');
  try { setup(dir); return run(dir); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}
const relative = (dir, value) => path.relative(fs.realpathSync(dir), fs.realpathSync(value)).split(path.sep).join('/');

test('the bootstrap is the canonical file components copy, with default API level 1; ctm-libs is at level 2', () => {
  const text = fs.readFileSync(C.bootstrap, 'utf8');
  assert.match(text, /^-- CTM bootstrap: byte-identical in every CTM component/);
  assert.match(text, /local API = 1\n/);
  assert.match(fs.readFileSync(path.join(C.library, 'lua', 'ctm.lua'), 'utf8'), /api = 2\}/);
});

test('package layout: the component uses the ctm-libs next to it', {skip}, () => withProject(dir => {
  C.installPackage(dir); C.install(dir); C.installProbe(dir);
  C.write(dir, {'page.qmd': page()});
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
  const where = C.probes(C.html(dir, 'page.qmd')).where;
  assert.equal(relative(dir, where.dir), '_extensions/ctm-libs');
  assert.equal(where.version, C.version());
  assert.equal(where.api, 2);
}));

test('without ctm-libs the render stops with the install command', {skip}, () => withProject(dir => {
  C.installPackage(dir); C.installProbe(dir);
  C.write(dir, {'page.qmd': page()});
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /probe is part of CTM Assessment and needs its library ctm-libs, which is not installed/);
  assert.match(r.stderr, INSTALL);
}));

test('without the package the render stops with the install command; CTM_COMPONENT_DEV=1 builds against ctm-libs alone', {skip}, () => withProject(dir => {
  C.install(dir, {owner: 'Erasmus-CTM'}); C.installProbe(dir);
  C.write(dir, {'page.qmd': page()});
}, dir => {
  let r = C.render(dir, ['page.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /probe is part of CTM Assessment, which is not installed in this project/);
  assert.match(r.stderr, INSTALL);
  r = C.render(dir, ['page.qmd'], {CTM_COMPONENT_DEV: '1'});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(relative(dir, C.probes(C.html(dir, 'page.qmd')).where.dir), '_extensions/Erasmus-CTM/ctm-libs');
}));

test('a package under an owner folder counts, and the sibling ctm-libs wins over another copy', {skip}, () => withProject(dir => {
  C.installPackage(dir, {owner: 'Erasmus-CTM'});
  C.install(dir, {owner: 'Erasmus-CTM'}); C.installProbe(dir, {owner: 'Erasmus-CTM'});
  C.install(dir);
  C.write(dir, {'_quarto.yml': 'project:\n  type: default\n  render: [page.qmd]\n', 'page.qmd': page()});
}, dir => {
  const r = C.render(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(relative(dir, C.probes(C.html(dir, 'page.qmd')).where.dir), '_extensions/Erasmus-CTM/ctm-libs');
}));

test('two ctm-libs versions on one page stop the render; the same version from two folders renders', {skip}, () => withProject(dir => {
  C.installPackage(dir); C.install(dir);
  C.install(dir, {owner: 'other'}); C.installProbe(dir, {owner: 'other'});
  C.setVersion(path.join(dir, '_extensions', 'other', 'ctm-libs'), '9.9.9');
  C.write(dir, {'page.qmd': page('ctm-libs, other/probe')});
}, dir => {
  let r = C.render(dir, ['page.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /This page combines two CTM installations: .*\(0\.9\.0\) and .*other.ctm-libs \(9\.9\.9\)/s);
  C.setVersion(path.join(dir, '_extensions', 'other', 'ctm-libs'), C.version());
  r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
  // The first instance of the page is shared: the filter listed first created it.
  assert.equal(relative(dir, C.probes(C.html(dir, 'page.qmd')).where.dir), '_extensions/ctm-libs');
}));

test('a ctm-libs with an older interface level names the update', {skip}, () => withProject(dir => {
  C.installPackage(dir); C.install(dir); C.installProbe(dir);
  const entry = path.join(dir, '_extensions', 'ctm-libs', 'lua', 'ctm.lua');
  fs.writeFileSync(entry, fs.readFileSync(entry, 'utf8').replace('api = 2}', 'api = 0}'));
  C.write(dir, {'page.qmd': page()});
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /probe needs a newer ctm-libs than .*Update CTM Assessment: quarto add/s);
}));

// Step 3 (E2, M6, M7): a component that also works without the package
// (pyodide-interaktiv, decision 5) passes {standalone = <its install command>},
// and {api = n} for the interface level it needs.
const STANDALONE = 'return {standalone = "quarto add Erasmus-CTM/probe"}\n';
function options(dir, text, owner = '') { fs.writeFileSync(path.join(dir, '_extensions', owner, 'probe', 'probe-options.lua'), text); }

test('standalone: renders without the package, with the ctm-libs next to it', {skip}, () => withProject(dir => {
  C.install(dir, {owner: 'Erasmus-CTM'}); C.installProbe(dir, {owner: 'Erasmus-CTM'}); options(dir, STANDALONE, 'Erasmus-CTM');
  C.write(dir, {'page.qmd': page('Erasmus-CTM/probe')});
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(relative(dir, C.probes(C.html(dir, 'page.qmd')).where.dir), '_extensions/Erasmus-CTM/ctm-libs');
}));

test('standalone without ctm-libs: the render names the component\'s own install command', {skip}, () => withProject(dir => {
  C.installProbe(dir, {owner: 'Erasmus-CTM'}); options(dir, STANDALONE, 'Erasmus-CTM');
  C.write(dir, {'page.qmd': page('Erasmus-CTM/probe')});
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /probe needs its library ctm-libs, which is missing next to it\. Install probe again: quarto add Erasmus-CTM\/probe/);
  assert.doesNotMatch(r.stderr, INSTALL);
}));

test('standalone inside the package: the package\'s messages', {skip}, () => withProject(dir => {
  C.installPackage(dir); C.installProbe(dir); options(dir, STANDALONE);
  C.write(dir, {'page.qmd': page()});
}, dir => {
  const r = C.render(dir, ['page.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /probe is part of CTM Assessment and needs its library ctm-libs, which is not installed/);
  assert.match(r.stderr, INSTALL);
}));

test('opts.api above ctm-libs\' level stops with the right command', {skip}, () => withProject(dir => {
  C.install(dir, {owner: 'Erasmus-CTM'}); C.installProbe(dir, {owner: 'Erasmus-CTM'});
  options(dir, 'return {standalone = "quarto add Erasmus-CTM/probe", api = 3}\n', 'Erasmus-CTM');
  C.write(dir, {'page.qmd': page('Erasmus-CTM/probe')});
}, dir => {
  let r = C.render(dir, ['page.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /probe needs a newer ctm-libs than .*Erasmus-CTM.ctm-libs \(\S+\)\. Install probe again: quarto add Erasmus-CTM\/probe/s);
  // The same component inside the package: update the package. api = 2 is ctm-libs' own level: renders.
  C.installPackage(dir);
  r = C.render(dir, ['page.qmd']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /probe needs a newer ctm-libs than .*Update CTM Assessment: quarto add/s);
  options(dir, 'return {standalone = "quarto add Erasmus-CTM/probe", api = 2}\n', 'Erasmus-CTM');
  r = C.render(dir, ['page.qmd']);
  assert.equal(r.status, 0, r.stderr);
}));
