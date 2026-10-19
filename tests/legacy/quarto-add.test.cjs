// The old install command keeps working (step-1 design §13 B4, §16.4):
// `quarto add Erasmus-CTM/ai-feedback@<branch or tag>` follows GitHub's
// redirect to the renamed repository and installs both of its extensions,
// ctm-libs and the ai-feedback alias, so `filters: [ai-feedback]` renders.
// Quarto does not resolve commits, so CTM_ADD_REF is a branch or a tag; the
// check is on the installed folders, not on the exit status of quarto add.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {spawnSync} = require('node:child_process');
const C = require('../helpers/ctm-libs.cjs');
const ref = process.env.CTM_ADD_REF;
const skip = !C.hasQuarto ? 'Quarto required' : !ref ? 'CTM_ADD_REF not set (see .github/workflows/legacy-consumers.yml)' : false;

test('quarto add Erasmus-CTM/ai-feedback@' + (ref || '<ref>') + ' installs ctm-libs and the alias, and the old filter renders', {skip}, () => {
  const dir = C.tempdir('ctm-quarto-add-');
  try {
    const add = spawnSync(C.quarto, ['add', 'Erasmus-CTM/ai-feedback@' + ref, '--no-prompt'], {cwd: dir, encoding: 'utf8', timeout: 300000});
    const owner = path.join(dir, '_extensions', 'Erasmus-CTM');
    for (const name of ['ctm-libs', 'ai-feedback']) {
      assert.ok(fs.existsSync(path.join(owner, name, '_extension.yml')), name + ' installed\n' + add.stdout + add.stderr);
    }
    assert.equal(C.version(path.join(owner, 'ai-feedback')), C.version(path.join(owner, 'ctm-libs')));
    C.write(dir, {'page.qmd': '---\ntitle: t\nfilters: [ai-feedback]\n---\n\n::: {.ai-feedback}\nExplain.\n:::\n'});
    const r = C.render(dir, ['page.qmd']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(C.html(dir, 'page.qmd'), /feedback-core\.js/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
