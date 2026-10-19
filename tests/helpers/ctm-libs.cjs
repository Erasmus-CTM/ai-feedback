// Paths of this repository's extensions, and installing them into test projects.
const fs = require('node:fs');
const path = require('node:path');

const repository = path.join(__dirname, '..', '..');
const extensions = path.join(repository, '_extensions');
const library = path.join(extensions, 'ctm-libs');
const alias = path.join(extensions, 'ai-feedback');
const feedback = path.join(library, 'feedback');

// Copies ctm-libs (and the ai-feedback alias) into `<dir>/_extensions[/<owner>]`,
// as `quarto add` does: it installs every extension of the repository.
function install(dir, {owner = '', withAlias = true} = {}) {
  const target = path.join(dir, '_extensions', owner);
  fs.cpSync(library, path.join(target, 'ctm-libs'), {recursive: true});
  if (withAlias) fs.cpSync(alias, path.join(target, 'ai-feedback'), {recursive: true});
  return target;
}

function version(folder = library) {
  return fs.readFileSync(path.join(folder, '_extension.yml'), 'utf8').match(/\nversion:\s*['"]?([\w.-]+)/)[1];
}

module.exports = {repository, extensions, library, alias, feedback, install, version};
