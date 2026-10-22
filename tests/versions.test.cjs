// One version for the library and the browser files.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ctmLibs = require('./helpers/ctm-libs.cjs');

test('ctm-libs, feedback-core.js and package.json share one version', () => {
  const version = ctmLibs.version();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(require(path.join(ctmLibs.feedback, 'feedback-core.js')).version, version, 'feedback-core.js VERSION');
  const pkg = JSON.parse(fs.readFileSync(path.join(ctmLibs.repository, 'package.json'), 'utf8'));
  assert.equal(pkg.version, version, 'package.json');
  assert.equal(pkg.name, '@erasmus-ctm/ctm-libs');
  const lock = JSON.parse(fs.readFileSync(path.join(ctmLibs.repository, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, version, 'package-lock.json');
  assert.equal(lock.packages[''].version, version, 'package-lock.json packages[""]');
});


test('the library ships no ai-feedback extension alias', () => {
  assert.equal(fs.existsSync(path.join(ctmLibs.extensions, 'ai-feedback')), false);
  assert.match(fs.readFileSync(path.join(ctmLibs.library, '_extension.yml'), 'utf8'), /filters:\n\s+- ctm-libs\.lua/);
});
