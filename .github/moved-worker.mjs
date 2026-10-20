// One-off check of consolidation step 3 (M13), removed with the alias (L3x):
// the blocks that runtime/pyodide-worker.js and runtime/coi-serviceworker.js
// took from pyodide-interaktiv 1.8 (qpyodide-document-engine-initialization.js
// at 8a16aa7) are unchanged but for whitespace and the log prefix; the blocks
// that D2 and the plugin hooks changed are printed as a diff for review.
//   node .github/moved-worker.mjs <pyodide-interaktiv 8a16aa7 checkout>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const old = process.argv[2];
const OLD = fs.readFileSync(path.join(old, '_extensions/pyodide-interaktiv/qpyodide-document-engine-initialization.js'), 'utf8');
const NEW = fs.readFileSync('_extensions/ctm-libs/runtime/pyodide-worker.js', 'utf8');
const RENAMES = [['qpyodide: ', 'CTMWorker: ']];
const normalize = text => RENAMES.reduce((t, [a, b]) => t.split(a).join(b), text).replace(/\s+/g, ' ').trim();

// From the line containing `start` to the brace that closes the first brace
// after it (a function or method), or to the line containing `end`.
function block(text, start, end) {
  const from = text.indexOf(start);
  assert.ok(from >= 0, 'not found: ' + start);
  const lineStart = text.lastIndexOf('\n', from) + 1;
  if (end) {
    const to = text.indexOf(end, from + start.length);
    assert.ok(to >= 0, 'not found: ' + end);
    return text.slice(lineStart, text.indexOf('\n', to));
  }
  let depth = 0, i = text.indexOf('{', from);
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) break;
  }
  return text.slice(lineStart, i + 1);
}

const VERBATIM = [
  ['stdin', 'function stdin() {'],
  ['postStatus', 'function postStatus(text) {'],
  ['runPythonRaw', 'async function runPythonRaw(code) {'],
  ['loadPyodide and the streams', 'pyodide = await mod.loadPyodide({', '  });'],
  ['the control commands', 'case "setInterrupt":', 'inputDataBuf   = msg.inputDataBuf;'],
  ['the Python commands', 'case "runPython":', 'pyodide.globals.set(msg.name, pyodide.toPy(msg.value));'],
  ['the proxy\'s Pyodide-like methods', 'runPythonAsync: (code) => rpc("runPython", { code }),', 'set: (name, value) => rpc("setGlobal", { name, value })'],
  ['interrupt', 'interrupt() {'],
  ['clearInterrupt', 'clearInterrupt() {'],
  ['abortInput', 'abortInput() {'],
  ['provideInput', 'provideInput(text) {'],
  ['the shared buffers', '// Enable the shared buffer if the page is cross-origin isolated.', 'console.warn('],
];
const CHANGED = [
  ['init (the two stages of D2)', 'async function init(', null],
  ['handleMessage (plugin commands)', 'async function handleMessage(msg) {', null],
  ['the command queue (D2 yields to commands)', 'let commandQueue = Promise.resolve();', '};'],
  ['rpc (after a restart, calls reject at once: B1)', 'function rpc(type, payload = {}) {', 'worker.postMessage({ type, id, ...payload });'],
  ['restart (publish, onRestart; whenSetup rejected: B1)', 'restart(reason) {', null],
];
let failed = 0;
const summary = ['## Moved from pyodide-interaktiv 1.8 (8a16aa7)', ''];
for (const [name, start, end] of VERBATIM) {
  const a = normalize(block(OLD, start, end)), b = normalize(block(NEW, start, end));
  const same = a === b;
  if (!same) { failed++; console.error('CHANGED, expected verbatim: ' + name); }
  summary.push(`- ${same ? 'unchanged' : '**changed**'}: ${name}`);
}
const coi = ['_extensions/pyodide-interaktiv/coi-serviceworker.js', '_extensions/ctm-libs/runtime/coi-serviceworker.js'];
const coiSame = fs.readFileSync(path.join(old, coi[0])).equals(fs.readFileSync(coi[1]));
if (!coiSame) failed++;
summary.push(`- ${coiSame ? 'byte for byte' : '**changed**'}: coi-serviceworker.js`, '', '### Changed on purpose (for review)', '');
const tmp = fs.mkdtempSync('/tmp/moved-');
for (const [name, start, end] of CHANGED) {
  fs.writeFileSync(path.join(tmp, 'a'), block(OLD, start, end) + '\n');
  fs.writeFileSync(path.join(tmp, 'b'), block(NEW, start, end) + '\n');
  let diff = '';
  try { execFileSync('diff', ['-u', '-w', path.join(tmp, 'a'), path.join(tmp, 'b')]); } catch (error) { diff = String(error.stdout); }
  summary.push(`<details><summary>${name}</summary>`, '', '```diff', diff.split('\n').slice(2).join('\n'), '```', '', '</details>', '');
}
fs.rmSync(tmp, {recursive: true, force: true});
const text = summary.join('\n') + '\n';
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text); else console.log(text);
if (failed) process.exit(1);
console.log('The moved blocks are unchanged; the changed ones are in the summary.');
