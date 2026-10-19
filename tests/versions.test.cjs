// One version for the library, its ai-feedback alias and the browser files:
// older components' loaders compare the alias manifest with the version
// ctm-libs registers, and AIFeedback.version is what consumers' gates read.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ctmLibs = require('./helpers/ctm-libs.cjs');

test('ctm-libs, the ai-feedback alias, feedback-core.js and package.json share one version', () => {
  const version = ctmLibs.version();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(ctmLibs.version(ctmLibs.alias), version, 'alias _extension.yml');
  assert.equal(require(path.join(ctmLibs.feedback, 'feedback-core.js')).version, version, 'feedback-core.js VERSION');
  const pkg = JSON.parse(fs.readFileSync(path.join(ctmLibs.repository, 'package.json'), 'utf8'));
  assert.equal(pkg.version, version, 'package.json');
  assert.equal(pkg.name, '@erasmus-ctm/ctm-libs');
  const lock = JSON.parse(fs.readFileSync(path.join(ctmLibs.repository, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, version, 'package-lock.json');
  assert.equal(lock.packages[''].version, version, 'package-lock.json packages[""]');
});

test('the alias is a thin extension: two Lua files and its manifest', () => {
  assert.deepEqual(fs.readdirSync(ctmLibs.alias).sort(), ['_extension.yml', 'ai-feedback.lua', 'feedback-quarto.lua']);
  assert.match(fs.readFileSync(path.join(ctmLibs.alias, '_extension.yml'), 'utf8'), /filters:\n\s+- ai-feedback\.lua/);
  assert.match(fs.readFileSync(path.join(ctmLibs.library, '_extension.yml'), 'utf8'), /filters:\n\s+- ctm-libs\.lua/);
});
