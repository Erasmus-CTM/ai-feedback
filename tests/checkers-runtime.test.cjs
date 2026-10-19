// ctm-checkers in the page's runtime (step-2 design §3.5 and T5):
// MathExerciseRuntime.ensureCheckers installs ctm-checkers once per runtime
// with the install code of its page script (CTMCheckers.install), and
// callCheckers runs a call with a call text that looks up no name in the
// namespace learner code shares, installs again and repeats the call once when
// it fails, and removes the request in every case. The first tests use fake
// runtimes; the others run Pyodide 0.28.3 with the ctm-checkers commit in
// tests/pins.json (CTM_CHECKERS_SOURCE, default _ctm-checkers-source).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctmLibs = require('./helpers/ctm-libs.cjs');

const source = fs.readFileSync(path.join(ctmLibs.library, 'runtime', 'pyodide-runtime.js'), 'utf8');

function runtime(globals = {}) {
  const context = vm.createContext({ setTimeout, clearTimeout, WeakMap, Promise, ...globals });
  vm.runInContext(source, context);
  return context;
}

// A fake runtime that records what the runtime asks of it; `fail(code)` decides which runs fail.
function fakePy(fail = () => false) {
  const globals = new Map(), runs = [];
  return {
    globals: { set: async (name, value) => { globals.set(name, value); } },
    runPythonAsync: async (code) => {
      runs.push(code);
      if (fail(code, runs)) throw new Error('PythonError: the call failed');
      if (code.includes('.call(')) { const request = globals.get('_ctm_request'); globals.delete('_ctm_request'); return JSON.stringify({ request }); }
      if (code.includes('del _ctm_request')) globals.delete('_ctm_request');
      return undefined;
    },
    values: globals, runs,
  };
}

function payload() {
  const installs = [];
  return { installs, install: async (py) => { installs.push(py); } };
}

test('ensureCheckers installs once per runtime; a failed install, or forgetModules, installs again', async () => {
  const context = runtime();
  const R = context.MathExerciseRuntime;
  const checkers = payload();
  context.CTMCheckers = checkers;
  const a = fakePy(), b = fakePy();
  await Promise.all([R.ensureCheckers(a), R.ensureCheckers(a), R.ensureCheckers(b)]);
  assert.deepEqual(checkers.installs, [a, b]);
  await R.ensureCheckers(a);
  assert.equal(checkers.installs.length, 2);
  R.forgetModules(a);
  await R.ensureCheckers(a);
  assert.equal(checkers.installs.length, 3);
  let attempts = 0;
  const failing = { install: async () => { attempts++; if (attempts === 1) throw new Error('payload is damaged'); } };
  const c = fakePy();
  await assert.rejects(R.ensureCheckers(c, failing), /payload is damaged/);
  await R.ensureCheckers(c, failing);
  assert.equal(attempts, 2);
});

test('ensureCheckers without ctm-checkers.js on the page fails with a message', async () => {
  const R = runtime().MathExerciseRuntime;
  await assert.rejects(R.ensureCheckers(fakePy()), /ctm-checkers is not loaded on this page: its script ctm-checkers\.js is missing/);
});

test('callCheckers: the request in _ctm_request, a call text without name lookups, the request removed', async () => {
  const context = runtime();
  const R = context.MathExerciseRuntime;
  context.CTMCheckers = payload();
  const py = fakePy();
  const result = JSON.parse(await R.callCheckers(py, 'math_exercise.check', { student: 'x' }));
  assert.deepEqual(JSON.parse(result.request), { student: 'x' });
  const call = py.runs.find((code) => code.includes('.call('));
  assert.equal(call, 'import builtins as _ctm_builtins\n'
    + '_ctm_builtins.__import__("ctm_checkers.browser", fromlist=["call"]).call("math_exercise.check", _ctm_builtins.globals())');
  assert.ok(!py.values.has('_ctm_request'));
  assert.equal(py.runs[py.runs.length - 1], '_ctm_request = None\ndel _ctm_request');
});

test('callCheckers installs again and repeats a failed call once; a second failure reaches the caller', async () => {
  const context = runtime();
  const R = context.MathExerciseRuntime;
  const checkers = payload();
  context.CTMCheckers = checkers;
  let calls = 0;
  const once = fakePy((code) => code.includes('.call(') && ++calls === 1);
  assert.ok(JSON.parse(await R.callCheckers(once, 'math_exercise.check', { n: 1 })).request);
  assert.equal(checkers.installs.length, 2);
  assert.ok(!once.values.has('_ctm_request'));
  const always = fakePy((code) => code.includes('.call('));
  await assert.rejects(R.callCheckers(always, 'math_exercise.check', { n: 2 }), /the call failed/);
  assert.equal(always.runs.filter((code) => code.includes('.call(')).length, 2);
  assert.ok(!always.values.has('_ctm_request'));
  assert.equal(checkers.installs.length, 4);
});

test('callCheckers does not repeat a call that the learner stopped', async () => {
  const context = runtime();
  const R = context.MathExerciseRuntime;
  const checkers = payload();
  context.CTMCheckers = checkers;
  context.mainPyodide = { restart() {} };
  const py = fakePy((code) => { if (code.includes('.call(')) { R.stop('Stopped by the learner'); return true; } return false; });
  await assert.rejects(R.callCheckers(py, 'math_exercise.check', {}), /the call failed/);
  assert.equal(py.runs.filter((code) => code.includes('.call(')).length, 1);
  assert.equal(checkers.installs.length, 1);
});

test('the calls of one runtime run one after another (one _ctm_request at a time)', async () => {
  const context = runtime();
  const R = context.MathExerciseRuntime;
  context.CTMCheckers = payload();
  const seen = [];
  const py = fakePy();
  const run = py.runPythonAsync;
  py.runPythonAsync = async (code) => {
    if (code.includes('.call(')) { seen.push(py.values.get('_ctm_request')); await new Promise((resolve) => setTimeout(resolve, 5)); }
    return run(code);
  };
  const results = await Promise.all([1, 2, 3].map((n) => R.callCheckers(py, 'math_exercise.check', { n })));
  assert.deepEqual(results.map((text) => JSON.parse(JSON.parse(text).request).n), [1, 2, 3]);
  assert.deepEqual(seen.map((text) => JSON.parse(text).n), [1, 2, 3]);
});

test('scriptURL is the URL of the runtime script on a page, none in a worker', () => {
  const page = runtime({ document: { currentScript: { src: 'https://example.org/site_libs/ctm-runtime/pyodide-runtime.js' } } });
  assert.equal(page.MathExerciseRuntime.scriptURL, 'https://example.org/site_libs/ctm-runtime/pyodide-runtime.js');
  assert.equal(runtime({ importScripts() {} }).MathExerciseRuntime.scriptURL, undefined);
});

test('a copy with ensureCheckers replaces a runtime without it (ctm-libs 0.9) that loaded first', () => {
  const older = runtime().MathExerciseRuntime;
  delete older.ensureCheckers;
  delete older.callCheckers;
  const context = runtime({ MathExerciseRuntime: older });
  assert.notEqual(context.MathExerciseRuntime, older);
  assert.equal(typeof context.MathExerciseRuntime.ensureCheckers, 'function');
});

// ---------------------------------------------------------------------------
// With Pyodide 0.28.3 and ctm-checkers.
// ---------------------------------------------------------------------------

const checkersSource = path.resolve(ctmLibs.repository, process.env.CTM_CHECKERS_SOURCE || '_ctm-checkers-source');
const checkersFolder = path.join(checkersSource, '_extensions', 'ctm-checkers');
const haveCheckers = fs.existsSync(path.join(checkersFolder, 'checkers.json'));
// In CI the checkout must be there; elsewhere the tests say what they need.
const skipPyodide = haveCheckers ? false
  : (process.env.CI ? false : 'needs ctm-checkers (tests/pins.json) in _ctm-checkers-source or CTM_CHECKERS_SOURCE');

let pyodide;
async function realPyodide() {
  if (!pyodide) {
    const { loadPyodide } = require('pyodide');
    // PYODIDE_PACKAGES: a folder with the wheels of SymPy and mpmath (offline); default: jsDelivr.
    pyodide = loadPyodide(process.env.PYODIDE_PACKAGES ? { packageCacheDir: process.env.PYODIDE_PACKAGES } : {})
      .then(async (py) => { await py.loadPackage('sympy', { messageCallback() {} }); return py; });
  }
  return pyodide;
}

// The runtime and ctm-checkers.js in one context: a page, or a worker that
// loads them with importScripts; `change` edits the script's text first.
function pageWithCheckers({ worker = false, change = (text) => text } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(checkersFolder, 'checkers.json'), 'utf8'));
  const script = path.join(checkersFolder, manifest.script);
  const context = vm.createContext({ setTimeout, clearTimeout, WeakMap, Promise });
  if (worker) {
    context.importScripts = (...files) => { for (const file of files) vm.runInContext(fs.readFileSync(file, 'utf8'), context); };
    vm.runInContext('importScripts(' + JSON.stringify(path.join(ctmLibs.library, 'runtime', 'pyodide-runtime.js')) + ', ' + JSON.stringify(script) + ')', context);
  } else {
    vm.runInContext(change(fs.readFileSync(script, 'utf8')), context);
    vm.runInContext(source, context);
  }
  return { context, manifest, R: context.MathExerciseRuntime };
}

// What every runtime on a page offers (pyodide-interaktiv's worker proxy): globals.set and runPythonAsync.
function proxyOf(py) {
  return { globals: { set: (name, value) => py.globals.set(name, value) }, runPythonAsync: (code) => py.runPythonAsync(code) };
}

const REQUEST = { student: '2*x', correct: 'x+x', vars: 'x', mode: 'equivalent', reject: '', tolerance: '', decplaces: '', sigfigs: '',
  form: '', partial_credit: false, form_credit: 0.5 };

test('the runtime and the tests use the same Pyodide version', () => {
  const version = require('pyodide/package.json').version;
  assert.equal(runtime().MathExerciseRuntime.indexURL, `https://cdn.jsdelivr.net/pyodide/v${version}/full/`);
});

test('Pyodide: ctm-checkers installs through globals.set and runPythonAsync only, and grades', { skip: skipPyodide, timeout: 600000 }, async () => {
  assert.ok(haveCheckers, 'ctm-checkers is missing: check out the commit of tests/pins.json into ' + checkersSource);
  const py = await realPyodide();
  const { R, manifest, context } = pageWithCheckers();
  const proxy = proxyOf(py);
  await R.ensureGuard(proxy);
  await R.ensureCheckers(proxy);
  assert.equal(py.runPython('import sys\nsys.modules["ctm_checkers"].__version__'), manifest.version);
  assert.deepEqual(JSON.parse(await R.callCheckers(proxy, 'math_exercise.check', REQUEST)), { status: 'correct', score: 1.0 });
  assert.equal(py.runPython('"_ctm_request" in globals()'), false);

  // Learner code rebinds what other call texts look up: this one needs none of it.
  py.runPython('__import__ = None\nglobals = None\n_ctm_import = None\n_ctm_globals = dict\nbuiltins = None');
  assert.deepEqual(JSON.parse(await R.callCheckers(proxy, 'math_exercise.check', { ...REQUEST, student: '3*x' })), { status: 'wrong', score: 0.0 });
  py.runPython('del __import__, globals, _ctm_import, _ctm_globals, builtins');

  // Learner code removes the library: the call fails once, ctm-checkers is installed again, the call is repeated.
  const installs = [];
  const counted = { install: (target) => { installs.push(target); return context.CTMCheckers.install(target); } };
  await R.ensureCheckers(proxy, counted);   // installed already: nothing runs
  assert.equal(installs.length, 0);
  py.runPython('import sys\nfor name in [n for n in sys.modules if n == "ctm_checkers" or n.startswith("ctm_checkers.")]: del sys.modules[name]\n'
    + 'sys.path[:] = [p for p in sys.path if not p.startswith("/tmp/ctm-checkers/")]');
  assert.deepEqual(JSON.parse(await R.callCheckers(proxy, 'math_exercise.check', REQUEST, counted)), { status: 'correct', score: 1.0 });
  assert.equal(installs.length, 1);
  assert.equal(py.runPython('"_ctm_request" in globals()'), false);

  // _ctm_guard keeps ctm_checkers' modules: a checker that removes them is undone by the restore.
  assert.equal(py.runPython([
    'import sys, _ctm_guard',
    '_state = _ctm_guard.snapshot()',
    'for name in [n for n in sys.modules if n.startswith("ctm_checkers")]: del sys.modules[name]',
    '_ctm_guard.restore(_state)',
    'del _state',
    '"ctm_checkers.browser" in sys.modules and "ctm_checkers" in sys.modules',
  ].join('\n')), true);

  // forgetModules: the next call installs again.
  R.forgetModules(proxy);
  await R.ensureCheckers(proxy, counted);
  assert.equal(installs.length, 2);

  // A damaged script (its wheel data changed) is refused.
  const damaged = pageWithCheckers({ change: (text) => text.replace(/data: '([A-Za-z0-9+/]{24})/, (all, start) => "data: '" + [...start].reverse().join('')) });
  assert.notEqual(damaged.context.CTMCheckers.data, context.CTMCheckers.data);
  await assert.rejects(damaged.R.ensureCheckers(proxyOf(py)), /payload is damaged/);
});

test('Pyodide: in a worker (importScripts), the same install and call', { skip: skipPyodide, timeout: 600000 }, async () => {
  assert.ok(haveCheckers, 'ctm-checkers is missing: check out the commit of tests/pins.json into ' + checkersSource);
  const py = await realPyodide();
  const { R, manifest } = pageWithCheckers({ worker: true });
  assert.equal(R.scriptURL, undefined);
  const proxy = proxyOf(py);
  await R.ensureCheckers(proxy);
  assert.equal(py.runPython('import sys\nsys.modules["ctm_checkers"].__version__'), manifest.version);
  assert.deepEqual(JSON.parse(await R.callCheckers(proxy, 'math_exercise.check', REQUEST)), { status: 'correct', score: 1.0 });
});
