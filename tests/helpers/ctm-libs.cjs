// Paths of this repository's extensions, and test projects that use them.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const repository = path.join(__dirname, '..', '..');
const extensions = path.join(repository, '_extensions');
const library = path.join(extensions, 'ctm-libs');
const feedback = path.join(library, 'feedback');
const bootstrap = path.join(repository, 'bootstrap', 'ctm-bootstrap.lua');
const quarto = process.env.QUARTO_BIN || 'quarto';
const hasQuarto = !spawnSync(quarto, ['--version']).error;

// Copies ctm-libs into `<dir>/_extensions[/<owner>]`,
// as `quarto add` does: it installs every extension of the repository.
function install(dir, {owner = ''} = {}) {
  const target = path.join(dir, '_extensions', owner);
  fs.cpSync(library, path.join(target, 'ctm-libs'), {recursive: true});
  return target;
}

// The probe component (tests/fixtures/probe) with the canonical bootstrap.
function installProbe(dir, {owner = ''} = {}) {
  const target = path.join(dir, '_extensions', owner, 'probe');
  fs.cpSync(path.join(__dirname, '..', 'fixtures', 'probe'), target, {recursive: true});
  fs.copyFileSync(bootstrap, path.join(target, 'ctm-bootstrap.lua'));
  return target;
}

// Marks the CTM Assessment package as installed (its manifest is what the bootstrap looks for).
function installPackage(dir, {owner = ''} = {}) {
  const target = path.join(dir, '_extensions', owner, 'ctm-assessment');
  fs.mkdirSync(target, {recursive: true});
  fs.writeFileSync(path.join(target, '_extension.yml'), 'title: CTM Assessment\nauthor: CTM team\nversion: ' + version() + '\ncontributes:\n  filters:\n    - ctm-assessment.lua\n');
  fs.writeFileSync(path.join(target, 'ctm-assessment.lua'), '-- Stand-in for the package filter (tests only).\nreturn {}\n');
  return target;
}

function version(folder = library) {
  return fs.readFileSync(path.join(folder, '_extension.yml'), 'utf8').match(/\nversion:\s*['"]?([\w.-]+)/)[1];
}

function setVersion(folder, value) {
  const manifest = path.join(folder, '_extension.yml');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(/\nversion:.*\n/, '\nversion: ' + value + '\n'));
}

function tempdir(prefix = 'ctm-libs-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Writes files ({relative path: text}) into dir.
function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), {recursive: true});
    fs.writeFileSync(path.join(dir, name), text);
  }
}

function render(dir, args = [], env = {}) {
  return spawnSync(quarto, ['render', ...args], {cwd: dir, encoding: 'utf8', timeout: 240000, env: {...process.env, ...env}});
}

function html(dir, file) {
  return fs.readFileSync(path.join(dir, file.replace(/\.(qmd|ipynb|md)$/, '.html')), 'utf8');
}

// The values of the page's ```{.ctm-probe #name} blocks.
function probes(text) {
  const found = {};
  for (const match of text.matchAll(/<script type="application\/json" class="ctm-probe" data-name="([^"]*)">([\s\S]*?)<\/script>/g)) {
    found[match[1]] = JSON.parse(match[2]);
  }
  return found;
}

function probe(name, code) {
  return '\n```{.ctm-probe #' + name + '}\n' + code + '\n```\n';
}

module.exports = {repository, extensions, library, feedback, bootstrap, quarto, hasQuarto,
  install, installProbe, installPackage, version, setVersion, tempdir, write, render, html, probes, probe};
