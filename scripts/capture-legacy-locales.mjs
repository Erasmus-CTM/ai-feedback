#!/usr/bin/env node
// One-off: records the user-interface texts of math-exercise 0.9 (bf6caf3) and
// py-exercise 0.3 (c14c5f4) before they moved into the catalogues of
// ctm-libs (locales/). tests/locale.test.cjs requires the compiled catalogues
// to give byte-identical texts for every key, language and sample argument.
//
//   node scripts/capture-legacy-locales.mjs                     # fetch the files from GitHub
//   node scripts/capture-legacy-locales.mjs --math-dir A --py-dir B   # extension folders on disk
//
// Writes tests/goldens/legacy-locales.json.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = {
  'math-exercise': {repository: 'Erasmus-CTM/math-exercise', commit: 'bf6caf3c5666bdf1c12fc0530b52518bfc0cd62f', folder: '_extensions/math-exercise'},
  'py-exercise': {repository: 'Erasmus-CTM/py-exercise', commit: 'c14c5f48144c44c410972a0ac7bc75506046fa9e', folder: '_extensions/py-exercise'},
};
// Sample arguments: every function is called with every combination of these
// (by its number of parameters), covering numbers, names and the form names
// of math-exercise's resNotForm, including an unknown one.
const SAMPLES = {
  1: [0, 1, 2, 37, 'A', 'factored', 'expanded', 'single_fraction', 'lowest_terms', 'cubic'],
  2: [0, 1, 2, 37, 'A'],
  3: ['A', 1, 37],
};

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

async function read(name, file) {
  const local = option(name === 'math-exercise' ? '--math-dir' : '--py-dir');
  if (local) return fs.readFileSync(path.join(local, file), 'utf8');
  const {repository, commit, folder} = SOURCES[name];
  const url = `https://raw.githubusercontent.com/${repository}/${commit}/${folder}/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(url + ': ' + response.status);
  return response.text();
}

// The LOCALES object literal of a component's browser file.
function locales(source, endMarker) {
  const start = source.indexOf('var LOCALES = {');
  const end = source.lastIndexOf('};', source.indexOf(endMarker, start));
  return vm.runInNewContext('(' + source.slice(start + 'var LOCALES = '.length, end + 1) + ')');
}

function combinations(size) {
  if (size === 0) return [[]];
  const values = SAMPLES[size] || SAMPLES[3];
  return combinations(size - 1).flatMap(rest => values.map(value => [...rest, value]));
}

function record(table) {
  const out = {};
  for (const [lang, entries] of Object.entries(table)) {
    out[lang] = {};
    for (const [key, value] of Object.entries(entries)) {
      out[lang][key] = typeof value === 'function'
        ? {$calls: combinations(value.length).map(sample => [sample, value(...sample)])}
        : value;
    }
  }
  return out;
}

// Lua tables of strings: `name = "text"` lines inside the named table.
function luaStrings(source, table) {
  const block = source.match(new RegExp('local ' + table + ' = \\{([\\s\\S]*?)\\n\\}'))[1];
  const out = {};
  const nested = [...block.matchAll(/\n  (\w+) = \{([^}]*)\}/g)];
  if (nested.length) {
    for (const [, lang, body] of nested) out[lang] = Object.fromEntries([...body.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map(m => [m[1], m[2]]));
  } else {
    for (const [, lang, text] of block.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) out[lang] = text;
  }
  return out;
}

const mathJs = await read('math-exercise', 'math-exercise.js');
const mathLua = await read('math-exercise', 'math-exercise.lua');
const pyJs = await read('py-exercise', 'py-exercise.js');
const pyLua = await read('py-exercise', 'py-exercise.lua');
const golden = {
  sources: SOURCES,
  samples: SAMPLES,
  'math-exercise': {js: record(locales(mathJs, '// Active locale')), lua: {uiText: luaStrings(mathLua, 'uiText')}},
  'py-exercise': {js: record(locales(pyJs, '// Utilities')), lua: {noscriptMessages: luaStrings(pyLua, 'noscriptMessages')}},
};
const target = path.join(ROOT, 'tests', 'goldens', 'legacy-locales.json');
fs.mkdirSync(path.dirname(target), {recursive: true});
fs.writeFileSync(target, JSON.stringify(golden, null, 1) + '\n');
console.log('Wrote', path.relative(ROOT, target));
