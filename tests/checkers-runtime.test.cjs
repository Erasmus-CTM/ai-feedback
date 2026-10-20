// ctm-checkers in the page's runtime (step-2 design §3.5 and T5):
// MathExerciseRuntime.ensureCheckers installs ctm-checkers once per runtime
// with the install code of its page script (CTMCheckers.install) and loads the
// whole library, and callCheckers runs a call with a call text that looks up
// no name in the namespace learner code shares, installs again and repeats
// the call once when the call text failed before ctm-checkers' call took the
// request, and removes the request and its names; a runtime that was stopped
// or restarted gets no further call. The first tests use fake runtimes; the
// others run Pyodide 0.28.3 with the ctm-checkers commit in tests/pins.json
// (CTM_CHECKERS_SOURCE, default _ctm-checkers-source).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctmLibs = require('./helpers/ctm-libs.cjs');

const source = fs.readFileSync(path.join(ctmLibs.library, 'runtime', 'pyodide-runtime.js'), 'utf8');

// The runtime script on a page: `context.dispatchEvent` sends the page's events.
function runtime(globals = {}) {
  const page = new EventTarget();
  const context = vm.createContext({ setTimeout, clearTimeout, WeakMap, Promise,
    addEventListener: page.addEventListener.bind(page), dispatchEvent: page.dispatchEvent.bind(page), ...globals });
  vm.runInContext(source, context);
  return context;
}

// A fake runtime that records what the runtime asks of it; `fail(code)` decides which runs fail.
// A Python exception of the call text, as Pyodide reports it.
const MISSING = 'Traceback (most recent call last):\n  File "<exec>", line 2, in <module>\nModuleNotFoundError: No module named \'ctm_checkers\'';
// The cleanup after a call: it removes the request and the call's names and returns whether the request was still there.
const CLEANUP = 'import builtins as _ctm_builtins\n_ctm_namespace = _ctm_builtins.globals()\ndel _ctm_builtins\n'
  + '_ctm_namespace.pop("_ctm_import", None)\n_ctm_namespace.pop("_ctm_globals", None)\n'
  + '_ctm_namespace.pop("_ctm_namespace").pop("_ctm_request", None) is not None';
// As ctm-checkers' call does first: it takes the request out of the namespace.
const TAKE = { request: true };
function fakePy(fail = () => false) {
  const globals = new Map(), runs = [];
  return {
    globals: { set: async (name, value) => { globals.set(name, value); } },
    runPythonAsync: async (code) => {
      runs.push(code);
      if (code === CLEANUP) { const left = globals.has('_ctm_request'); globals.delete('_ctm_request'); return left; }
      const failure = fail(code, runs);
      if (failure) {
        // A failure of the call itself (TAKE): the request was taken; of the call text: it is still there.
        if (failure.take) { globals.delete('_ctm_request'); throw new Error(failure.message); }
        throw new Error(typeof failure === 'string' ? failure : 'PythonError: ' + MISSING);
      }
      if (code.includes('.call(')) { const request = globals.get('_ctm_request'); globals.delete('_ctm_request'); return JSON.stringify({ request }); }
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
  // After the install, the whole library is loaded and the install code's names removed, once.
  assert.equal(a.runs.length, 1);
  assert.match(a.runs[0], /pkgutil\.walk_packages\(package\.__path__, "ctm_checkers\."/);
  assert.match(a.runs[0], /\ndel _ctm_import\n_ctm_globals = None\ndel _ctm_globals$/);
  await R.ensureCheckers(a);
  assert.equal(checkers.installs.length, 2);
  R.forgetModules(a);
  await R.ensureCheckers(a);
  assert.equal(checkers.installs.length, 3);
  let attempts = 0;
  const failing = { install: async () => {
    attempts++;
    if (attempts === 1) throw new Error('Traceback (most recent call last):\n  File "<exec>", line 22, in <module>\nRuntimeError: ctm-checkers: the payload is damaged (sha256 mismatch)');
  } };
  const c = fakePy();
  await assert.rejects(R.ensureCheckers(c, failing), /payload is damaged/);
  await R.ensureCheckers(c, failing);
  assert.equal(attempts, 2);
});

test('ensureCheckers and callCheckers keep one install per runtime and payload (ctm-checkers, its STACK engine)', async () => {
  const context = runtime();
  const R = context.MathExerciseRuntime;
  const base = Object.assign(payload(), { name: 'ctm-checkers' });
  const stack = Object.assign(payload(), { name: 'ctm-checkers-stack', part: 'stack' });
  context.CTMCheckers = base;
  const py = fakePy();
  await Promise.all([R.ensureCheckers(py), R.ensureCheckers(py, stack), R.ensureCheckers(py, stack), R.ensureCheckers(py)]);
  // The STACK payload (which installs ctm-checkers too) is installed although ctm-checkers already was.
  assert.deepEqual([base.installs.length, stack.installs.length], [1, 1]);
  // A call text that failed before the call installs that call's payload again.
  let calls = 0;
  const once = fakePy((code) => code.includes('.call(') && ++calls === 1);
  assert.ok(JSON.parse(await R.callCheckers(once, 'stack.grade', { answers: {} }, stack)).request);
  assert.deepEqual([base.installs.length, stack.installs.length], [1, 3]);
});

test('ctm-checkers installed after its STACK engine replaced it: the runtime installs the STACK engine again', async () => {
  const context = runtime();
  const R = context.MathExerciseRuntime;
  const base = Object.assign(payload(), { name: 'ctm-checkers' });
  const stack = Object.assign(payload(), { name: 'ctm-checkers-stack', part: 'stack' });
  context.CTMCheckers = base;
  const py = fakePy();
  await R.ensureCheckers(py, stack);
  await R.ensureCheckers(py);
  await R.ensureCheckers(py, stack);
  assert.deepEqual([base.installs.length, stack.installs.length], [1, 2]);
  // ctm-checkers first, then the STACK engine: nothing is installed again.
  const other = fakePy();
  await R.ensureCheckers(other);
  await R.ensureCheckers(other, stack);
  await R.ensureCheckers(other);
  await R.ensureCheckers(other, stack);
  assert.deepEqual([base.installs.length, stack.installs.length], [2, 3]);
});

// Every order of a direct install of the STACK engine, of ctm-checkers, a
// STACK call and a math call, started together: a fake package where
// ctm-checkers' install replaces the STACK engine and a STACK call without it
// fails in ctm-checkers' call (the request taken), as in Pyodide. Nothing
// overlaps, and a call never meets an install half-way.
test('installs and calls of one runtime run in one queue, in every order of direct installs and calls', async () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
  const steps = ['install STACK', 'install ctm-checkers', 'STACK call', 'math call'];
  const orders = [];
  (function permute(done, rest) {
    if (!rest.length) { orders.push(done); return; }
    rest.forEach((step, i) => permute([...done, step], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  })([], steps);
  for (const order of [['install STACK', 'install ctm-checkers', 'STACK call'], ...orders]) {
    const context = runtime();
    const R = context.MathExerciseRuntime;
    let modules = new Set(), busy = 0, overlaps = 0;
    async function work(change) { if (busy++) overlaps++; await tick(); change(); await tick(); busy--; }
    const base = { name: 'ctm-checkers', install: () => work(() => { modules = new Set(['base']); }) };
    const stack = { name: 'ctm-checkers-stack', part: 'stack', install: () => work(() => { modules = new Set(['base', 'stack']); }) };
    context.CTMCheckers = base;
    const py = fakePy((code) => code.includes('"stack.grade"') && !modules.has('stack')
      && { take: true, message: 'ModuleNotFoundError: No module named \'ctm_checkers.stack\'' });
    const call = py.runPythonAsync;
    py.runPythonAsync = async (code) => { if (code.includes('.call(')) await work(() => {}); return call(code); };
    const run = {
      'install STACK': () => R.ensureCheckers(py, stack).then(() => 'installed'),
      'install ctm-checkers': () => R.ensureCheckers(py).then(() => 'installed'),
      'STACK call': () => R.callCheckers(py, 'stack.grade', { answers: {} }, stack).then(() => 'graded'),
      'math call': () => R.callCheckers(py, 'math_exercise.check', { n: 1 }).then(() => 'checked'),
    };
    const results = await Promise.all(order.map((step) => run[step]().catch((error) => error.message)));
    assert.deepEqual(results, order.map((step) => ({ 'STACK call': 'graded', 'math call': 'checked' })[step] || 'installed'), order.join(', '));
    assert.equal(overlaps, 0, order.join(', '));
    assert.equal(await run['STACK call'](), 'graded', order.join(', '));
  }
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
  assert.equal(py.runs[py.runs.length - 1], CLEANUP);
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
  await assert.rejects(R.callCheckers(always, 'math_exercise.check', { n: 2 }), /No module named 'ctm_checkers'/);
  assert.equal(always.runs.filter((code) => code.includes('.call(')).length, 2);
  assert.ok(!always.values.has('_ctm_request'));
  assert.equal(checkers.installs.length, 4);
});

test('callCheckers does not repeat a call whose error ctm-checkers\' call raised (the answer of the request)', async () => {
  const context = runtime();
  const R = context.MathExerciseRuntime;
  const checkers = payload();
  context.CTMCheckers = checkers;
  // With a traceback, and without one (learner code set sys.tracebacklimit = 0): ctm-checkers' call took the request.
  const errors = ['Traceback (most recent call last):\n  File "<exec>", line 2, in <module>\n'
    + '  File "/tmp/ctm-checkers/be41199f84e499ac/ctm_checkers-0.1.1.dev0-py3-none-any.whl/ctm_checkers/browser.py", line 52, in call\n'
    + '    admission(request)\nValueError: SyntaxError: unsupported input', 'ValueError: SyntaxError: unsupported input'];
  for (const message of errors) {
    const py = fakePy((code) => code.includes('.call(') && { take: true, message });
    await assert.rejects(R.callCheckers(py, 'math_exercise.check', { student: '__x' }), /SyntaxError: unsupported input/);
    assert.equal(py.runs.filter((code) => code.includes('.call(')).length, 1);
    assert.equal(py.runs[py.runs.length - 1], CLEANUP);
  }
  assert.equal(checkers.installs.length, 2);
});

test('an error without a traceback is not a stop: the runtime gets the next call (sys.tracebacklimit = 0, a JS rejection)', async () => {
  const context = runtime();
  const R = context.MathExerciseRuntime;
  context.CTMCheckers = payload();
  let answerErrors = 1;
  const py = fakePy((code) => code.includes('.call(') && answerErrors-- > 0 && { take: true, message: 'ValueError: SyntaxError: unsupported input' });
  await assert.rejects(R.callCheckers(py, 'math_exercise.check', { n: 1 }), /^Error: ValueError: SyntaxError: unsupported input$/);
  // A JS rejection of a live runtime (the request could not be sent).
  const set = py.globals.set;
  py.globals.set = async () => { py.globals.set = set; throw new Error('DataCloneError: could not be cloned'); };
  await assert.rejects(R.callCheckers(py, 'math_exercise.check', { n: 2 }), /^Error: DataCloneError/);
  assert.equal(JSON.parse(JSON.parse(await R.callCheckers(py, 'math_exercise.check', { n: 3 })).request).n, 3);
  assert.equal(py.runs.filter((code) => code === CLEANUP).length, 3);
  assert.equal(py.runs.filter((code) => code.includes('.call(')).length, 2);
  // A call text that failed before the call, without a traceback: installed again and repeated once.
  let missing = 1;
  const removed = fakePy((code) => code.includes('.call(') && missing-- > 0 && 'ModuleNotFoundError: No module named \'ctm_checkers\'');
  assert.equal(JSON.parse(JSON.parse(await R.callCheckers(removed, 'math_exercise.check', { n: 4 })).request).n, 4);
  assert.equal(removed.runs.filter((code) => code.includes('.call(')).length, 2);
});

test('callCheckers does not repeat a call that the learner stopped', async () => {
  const context = runtime();
  const R = context.MathExerciseRuntime;
  const checkers = payload();
  context.CTMCheckers = checkers;
  context.mainPyodide = { restart() {} };
  const py = fakePy((code) => { if (code.includes('.call(')) { R.stop('Stopped by the learner'); return true; } return false; });
  await assert.rejects(R.callCheckers(py, 'math_exercise.check', {}), /No module named/);
  assert.equal(py.runs.filter((code) => code.includes('.call(')).length, 1);
  assert.equal(checkers.installs.length, 1);
});

test('a call rejected with exactly the error of restart() without a reason: that runtime gets nothing more, also without the event', async () => {
  const context = runtime();
  const R = context.MathExerciseRuntime;
  context.CTMCheckers = payload();
  const py = fakePy((code) => code.includes('.call(') && 'Python was restarted.');
  await assert.rejects(R.callCheckers(py, 'math_exercise.check', {}), /^Error: Python was restarted\.$/);
  assert.ok(!py.runs.includes(CLEANUP));
  const sent = py.runs.length;
  await assert.rejects(R.callCheckers(py, 'math_exercise.check', {}), /^Error: Python was restarted\.$/);
  assert.equal(py.runs.length, sent);
  // A Python error that only mentions it is not a restart.
  const other = fakePy((code, runs) => code.includes('.call(') && runs.filter((c) => c.includes('.call(')).length === 1
    && { take: true, message: 'Exception: Python was restarted.' });
  await assert.rejects(R.callCheckers(other, 'math_exercise.check', {}), /^Error: Exception: Python was restarted\.$/);
  assert.ok(JSON.parse(await R.callCheckers(other, 'math_exercise.check', { n: 2 })).request);
});

test('callCheckers sends nothing more to a runtime that pyodide-interaktiv restarted (its qpyodide-runtime-restart event)', async () => {
  const context = runtime();
  const R = context.MathExerciseRuntime;
  const checkers = payload();
  context.CTMCheckers = checkers;
  // As pyodide-interaktiv's restart(): the event first (mainPyodide is still this runtime), then the pending call is rejected.
  const py = fakePy((code) => {
    if (!code.includes('.call(')) return false;
    context.dispatchEvent(new Event('qpyodide-runtime-restart'));
    return 'Python was restarted.';
  });
  context.mainPyodide = py;
  await assert.rejects(R.callCheckers(py, 'math_exercise.check', {}), /^Error: Python was restarted\.$/);
  assert.equal(py.runs.filter((code) => code.includes('.call(')).length, 1);
  assert.equal(checkers.installs.length, 1);
  // That runtime gets nothing more: no cleanup, and a later call fails at once without being sent.
  assert.ok(!py.runs.includes(CLEANUP));
  const sent = py.runs.length;
  await assert.rejects(R.callCheckers(py, 'math_exercise.check', {}), /^Error: Python was restarted\.$/);
  await assert.rejects(R.ensureCheckers(py), /^Error: Python was restarted\.$/);
  assert.equal(py.runs.length, sent);
});

// pyodide-interaktiv's worker proxy (qpyodide-document-engine-initialization.js,
// 58543b9): every call is a message to the worker; restart() sends the page's
// qpyodide-runtime-restart event, terminates the worker and rejects the
// pending calls with Error(reason), and a call made on this proxy afterwards
// goes to the terminated worker and never settles. `answer(code)` is the
// worker's answer to runPythonAsync.
function workerProxy(page, answer) {
  let terminated = false;
  const pending = new Set(), sent = [];
  function rpc(what, work) {
    sent.push({ what, terminated });
    if (terminated) return new Promise(() => {});
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      pending.add(entry);
      Promise.resolve().then(work).then((value) => { if (pending.delete(entry)) resolve(value); },
        (error) => { if (pending.delete(entry)) reject(error); });
    });
  }
  return {
    sent,
    globals: { set: (name) => rpc('set ' + name, () => undefined) },
    runPythonAsync: (code) => rpc(code, () => answer(code)),
    restart(reason) {
      page.dispatchEvent(new Event('qpyodide-runtime-restart'));
      terminated = true;
      const error = new Error(reason || 'Python was restarted.');
      for (const entry of pending) entry.reject(error);
      pending.clear();
    },
  };
}
// How a promise ends within `ms`: {value}, {error} or {hang: true}.
function settles(promise, ms = 1000) {
  return Promise.race([promise.then((value) => ({ value }), (error) => ({ error: String(error) })),
    new Promise((resolve) => setTimeout(() => resolve({ hang: true }), ms))]);
}
async function until(condition) {
  for (let i = 0; i < 500 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(condition());
}

test('a Stop or restart during a call on pyodide-interaktiv\'s worker: the call and those waiting behind it fail at once, the stopped worker gets nothing more, other runtimes go on', async () => {
  // pyodide-interaktiv's own Stop restarts its proxy; MathExerciseRuntime.stop() (math-exercise's Stop) does the same for mainPyodide.
  for (const [how, reason] of [['restart', 'Python was restarted.'], ['stop', 'Stopped by the learner']]) {
    const context = runtime();
    const R = context.MathExerciseRuntime;
    context.CTMCheckers = payload();
    // A check that runs until it is stopped (an answer such as 9**9**9**9).
    const worker = workerProxy(context, (code) => (code.includes('.call(') ? new Promise(() => {}) : undefined));
    context.mainPyodide = worker;
    const running = R.callCheckers(worker, 'math_exercise.check', { n: 1 });
    const waiting = R.callCheckers(worker, 'math_exercise.check', { n: 2 });
    await until(() => worker.sent.some((message) => message.what.includes('.call(')));
    // Another runtime is not held up by this one.
    const other = fakePy();
    assert.ok(JSON.parse(await R.callCheckers(other, 'math_exercise.check', { n: 3 })).request, how);
    if (how === 'restart') worker.restart(); else R.stop(reason);
    assert.deepEqual(await settles(running), { error: 'Error: ' + reason }, how);
    assert.deepEqual(await settles(waiting), { error: 'Error: ' + reason }, how);
    assert.deepEqual(await settles(R.callCheckers(worker, 'math_exercise.check', { n: 4 })), { error: 'Error: ' + reason }, how);
    assert.deepEqual(worker.sent.filter((message) => message.terminated), [], how + ': nothing is sent to the terminated worker');
    assert.equal(worker.sent.filter((message) => message.what.includes('.call(')).length, 1, how);
  }
});

test('a restart during the install: the calls for that runtime fail at once', async () => {
  const context = runtime();
  const R = context.MathExerciseRuntime;
  let worker = null;
  context.CTMCheckers = { install: (py) => py.runPythonAsync('install') };
  worker = workerProxy(context, (code) => (code === 'install' ? new Promise(() => {}) : undefined));
  context.mainPyodide = worker;
  const first = R.callCheckers(worker, 'math_exercise.check', { n: 1 });
  const second = R.callCheckers(worker, 'math_exercise.check', { n: 2 });
  await until(() => worker.sent.length > 0);
  worker.restart();
  assert.deepEqual(await settles(first), { error: 'Error: Python was restarted.' });
  assert.deepEqual(await settles(second), { error: 'Error: Python was restarted.' });
  assert.deepEqual(worker.sent.map((message) => message.what), ['install']);
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
  // Nothing of the install or the call stays in the namespace learner code shares.
  assert.deepEqual(py.runPython('sorted(n for n in globals() if n.startswith("_ctm_"))').toJs(), []);

  // Learner code rebinds what other call texts look up: this one needs none of it.
  py.runPython('__import__ = None\nglobals = None\n_ctm_import = None\n_ctm_globals = dict\nbuiltins = None');
  assert.deepEqual(JSON.parse(await R.callCheckers(proxy, 'math_exercise.check', { ...REQUEST, student: '3*x' })), { status: 'wrong', score: 0.0 });
  py.runPython('del __import__, globals, builtins');
  // The call's cleanup removed the _ctm_ names (reserved for CTM), the learner's too.
  assert.deepEqual(py.runPython('sorted(n for n in globals() if n.startswith("_ctm_"))').toJs(), []);

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

  // An answer the admission rule rejects: the call's own error, not repeated.
  await assert.rejects(R.callCheckers(proxy, 'math_exercise.check', { ...REQUEST, student: '__import__("os")' }, counted),
    /ValueError: SyntaxError: unsupported input/);
  assert.equal(installs.length, 1);
  assert.equal(py.runPython('"_ctm_request" in globals()'), false);

  // _ctm_guard keeps ctm_checkers' modules: a checker that removes them is undone by the restore.
  assert.equal(py.runPython([
    'import sys, _ctm_guard',
    '_state = _ctm_guard.snapshot()',
    'for name in [n for n in sys.modules if n.startswith("ctm_checkers")]: del sys.modules[name]',
    '_ctm_guard.restore(_state)',
    'del _state, _ctm_guard',
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

const CUSTOM = { response: { kind: 'expressions', raw: ['x+1'], inputs: {} }, vars: 'x',
  checker: 'def check(response, symbols):\n    return {"correct": response["expressions"][0] == symbols["x"] + 1}\n' };

test('Pyodide: learner code that deletes or overwrites the installed wheel breaks no later call (the whole library is loaded at install)', { skip: skipPyodide, timeout: 600000 }, async () => {
  assert.ok(haveCheckers, 'ctm-checkers is missing: check out the commit of tests/pins.json into ' + checkersSource);
  const py = await realPyodide();
  const { R, context } = pageWithCheckers();
  const proxy = proxyOf(py);
  const installs = [];
  const counted = { install: (target) => { installs.push(target); return context.CTMCheckers.install(target); } };
  await R.ensureGuard(proxy);
  assert.deepEqual(JSON.parse(await R.callCheckers(proxy, 'math_exercise.check', REQUEST, counted)), { status: 'correct', score: 1.0 });
  // Every module of the library is in memory, the first check_custom's too.
  assert.equal(py.runPython('import sys\n"ctm_checkers.math_exercise.custom" in sys.modules and "ctm_checkers.matrix" in sys.modules'), true);
  const custom = async (raw) => JSON.parse(await R.callCheckers(proxy, 'math_exercise.check_custom',
    { ...CUSTOM, response: { ...CUSTOM.response, raw: [raw] } }, counted)).status;
  // Before the first check_custom, learner code removes the wheel ...
  py.runPython('import shutil as _learner\n_learner.rmtree("/tmp/ctm-checkers")\ndel _learner');
  assert.equal(await custom('x+1'), 'correct');
  assert.equal(await custom('x+2'), 'wrong');
  // ... writes other bytes in its place, and empties a package's __path__.
  py.runPython(['import os as _learner, sys as _learner_sys',
    '_wheel = _learner_sys.modules["ctm_checkers"].__file__.split("/ctm_checkers/")[0]',
    '_learner.makedirs(_learner.path.dirname(_wheel), exist_ok=True)',
    'open(_wheel, "wb").write(b"not a wheel")',
    '_learner_sys.modules["ctm_checkers.math_exercise"].__path__[:] = []',
    'del _learner, _learner_sys, _wheel'].join('\n'));
  assert.equal(await custom('x+1'), 'correct');
  assert.deepEqual(JSON.parse(await R.callCheckers(proxy, 'math_exercise.check', REQUEST, counted)), { status: 'correct', score: 1.0 });
  // An answer the admission rule rejects is still the call's own error, not repeated.
  await assert.rejects(R.callCheckers(proxy, 'math_exercise.check', { ...REQUEST, student: '__import__("os")' }, counted),
    /ValueError: SyntaxError: unsupported input/);
  assert.equal(installs.length, 1, 'no install after the first');
  assert.deepEqual(py.runPython('sorted(n for n in globals() if n.startswith("_ctm_"))').toJs(), []);
});

test('Pyodide: with sys.tracebacklimit = 0 (no traceback in errors) a rejected answer stops nothing, a removed library is installed again; and after the learner undoes it', { skip: skipPyodide, timeout: 600000 }, async () => {
  assert.ok(haveCheckers, 'ctm-checkers is missing: check out the commit of tests/pins.json into ' + checkersSource);
  const py = await realPyodide();
  const { R, context } = pageWithCheckers();
  const proxy = proxyOf(py);
  const installs = [];
  const counted = { install: (target) => { installs.push(target); return context.CTMCheckers.install(target); } };
  await R.ensureGuard(proxy);
  const remove = 'import sys as _learner\nfor _name in [n for n in _learner.modules if n == "ctm_checkers" or n.startswith("ctm_checkers.")]: del _learner.modules[_name]\n'
    + '_learner.path[:] = [p for p in _learner.path if not p.startswith("/tmp/ctm-checkers/")]\ndel _learner, _name';
  const dunder = { ...REQUEST, student: '__import__("os")' };
  try {
    py.runPython('import sys as _learner\n_learner.tracebacklimit = 0\ndel _learner');
    for (const round of ['without tracebacks', 'after the learner undid it']) {
      const before = installs.length;
      await assert.rejects(R.callCheckers(proxy, 'math_exercise.check', dunder, counted), (error) => {
        assert.match(String(error.message), /ValueError: SyntaxError: unsupported input/, round);
        assert.equal(/Traceback \(most recent call last\)/.test(String(error.message)), round !== 'without tracebacks', round);
        return true;
      });
      assert.deepEqual(JSON.parse(await R.callCheckers(proxy, 'math_exercise.check', REQUEST, counted)), { status: 'correct', score: 1.0 }, round);
      assert.equal(installs.length, before + (round === 'without tracebacks' ? 1 : 0), round);   // the first round's call installs
      py.runPython(remove);
      assert.deepEqual(JSON.parse(await R.callCheckers(proxy, 'math_exercise.check', REQUEST, counted)), { status: 'correct', score: 1.0 }, round);
      assert.equal(installs.length, before + (round === 'without tracebacks' ? 2 : 1), round + ': installed again once');
      assert.deepEqual(py.runPython('sorted(n for n in globals() if n.startswith("_ctm_"))').toJs(), [], round);
      if (round === 'without tracebacks') py.runPython('import sys as _learner\ndel _learner.tracebacklimit\ndel _learner');
    }
  } finally {
    py.runPython('import sys as _learner\n_learner.__dict__.pop("tracebacklimit", None)\ndel _learner');
  }
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

test('Pyodide: stack-sympy\'s worker: both page scripts, the STACK engine installed and loaded once, its calls', { skip: skipPyodide, timeout: 600000 }, async () => {
  assert.ok(haveCheckers, 'ctm-checkers is missing: check out the commit of tests/pins.json into ' + checkersSource);
  const manifest = JSON.parse(fs.readFileSync(path.join(checkersFolder, 'checkers.json'), 'utf8'));
  assert.ok(manifest.parts && manifest.parts.stack, 'ctm-checkers 0.2 or later (tests/pins.json) has parts.stack');
  const py = await realPyodide();
  const context = vm.createContext({ setTimeout, clearTimeout, WeakMap, Promise });
  context.importScripts = (...files) => { for (const file of files) vm.runInContext(fs.readFileSync(file, 'utf8'), context); };
  vm.runInContext('importScripts(' + [path.join(ctmLibs.library, 'runtime', 'pyodide-runtime.js'), path.join(checkersFolder, manifest.script),
    path.join(checkersFolder, manifest.parts.stack.script)].map((file) => JSON.stringify(file)).join(', ') + ')', context);
  const R = context.MathExerciseRuntime, stack = context.CTMCheckersStack;
  const proxy = proxyOf(py);
  await Promise.all([R.ensureCheckers(proxy, stack), R.ensureCheckers(proxy, stack)]);
  // The whole library is loaded at install, the STACK engine included.
  assert.equal(py.runPython('import sys\n"ctm_checkers.stack.engine" in sys.modules'), true);
  // stack-sympy's grading request: the question and variant as the card holds them.
  const scope = py.toPy({ xml: fs.readFileSync(path.join(checkersSource, 'examples', 'stack', 'polynomial-expansion.xml'), 'utf8') });
  let prepared;
  try {
    prepared = JSON.parse(py.runPython('import json\nfrom ctm_checkers.stack.importer import import_xml\nfrom ctm_checkers.stack.engine import instantiate\n'
      + 'q = import_xml(xml)[0]\njson.dumps({"question": q, "variant": instantiate(q, 1)})', { globals: scope }));
  } finally { scope.destroy(); }
  const graded = JSON.parse(await R.callCheckers(proxy, 'stack.grade', { ...prepared, answers: { ans: 'x^2+7*x+12' } }, stack));
  assert.equal(graded.ok, true);
  assert.equal(graded.result.score, 1);
  const tests = JSON.parse(await R.callCheckers(proxy, 'stack.tests', { ...prepared, answers: {} }, stack));
  assert.equal(tests.result.passed, true);
  assert.deepEqual(py.runPython('sorted(n for n in globals() if n.startswith("_ctm_"))').toJs(), []);
});

// Both page scripts in one runtime (step 6 shares the runtime): a fresh page
// (the runtime's bookkeeping starts empty) and stack-sympy's grading request
// (the question and variant as the card holds them).
function pageWithStack() {
  const manifest = JSON.parse(fs.readFileSync(path.join(checkersFolder, 'checkers.json'), 'utf8'));
  assert.ok(manifest.parts && manifest.parts.stack, 'ctm-checkers 0.2 or later (tests/pins.json) has parts.stack');
  const context = vm.createContext({ setTimeout, clearTimeout, WeakMap, Promise });
  for (const file of [path.join(ctmLibs.library, 'runtime', 'pyodide-runtime.js'), path.join(checkersFolder, manifest.script),
    path.join(checkersFolder, manifest.parts.stack.script)]) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  return { R: context.MathExerciseRuntime, stack: context.CTMCheckersStack };
}
let gradeRequest;
async function stackRequest(py) {
  if (!gradeRequest) {
    const scope = py.toPy({ xml: fs.readFileSync(path.join(checkersSource, 'examples', 'stack', 'polynomial-expansion.xml'), 'utf8') });
    try {
      const page = pageWithStack();
      await page.R.ensureCheckers(proxyOf(py), page.stack);
      const prepared = JSON.parse(py.runPython('import json\nfrom ctm_checkers.stack.importer import import_xml\nfrom ctm_checkers.stack.engine import instantiate\n'
        + 'q = import_xml(xml)[0]\njson.dumps({"question": q, "variant": instantiate(q, 1)})', { globals: scope }));
      gradeRequest = { ...prepared, answers: { ans: 'x^2+7*x+12' } };
    } finally { scope.destroy(); }
  }
  return gradeRequest;
}

// ctm-checkers' own install replaces the package, the STACK engine installed
// before included, and the runtime must install that again.
test('Pyodide: ctm-checkers and its STACK engine in one runtime, in every order, and a repeated failed math call', { skip: skipPyodide, timeout: 900000 }, async () => {
  assert.ok(haveCheckers, 'ctm-checkers is missing: check out the commit of tests/pins.json into ' + checkersSource);
  const py = await realPyodide();
  const request = await stackRequest(py);
  const REMOVE = 'import sys\nfor name in [n for n in sys.modules if n == "ctm_checkers" or n.startswith("ctm_checkers.")]:\n    del sys.modules[name]\n'
    + 'sys.path[:] = [p for p in sys.path if not p.startswith("/tmp/ctm-checkers/")]';
  for (const order of ['math first', 'stack first', 'concurrent', 'repeated math call']) {
    const { R, stack } = pageWithStack();
    const proxy = proxyOf(py);
    const math = async () => JSON.parse(await R.callCheckers(proxy, 'math_exercise.check', REQUEST)).status;
    const grade = async () => JSON.parse(await R.callCheckers(proxy, 'stack.grade', request, stack)).result.score;
    let results;
    if (order === 'math first') results = [await math(), await grade(), await math(), await grade()];
    else if (order === 'stack first') results = [await grade(), await math(), await grade(), await math()];
    else if (order === 'concurrent') results = [...await Promise.all([math(), grade(), math(), grade()])];
    else {
      results = [await grade()];
      // Learner code removes ctm-checkers: the math call installs ctm-checkers again and repeats.
      await py.runPythonAsync(REMOVE);
      results.push(await math(), await grade(), await math());
    }
    assert.deepEqual(results.map(String).sort(), ['1', '1', 'correct', 'correct'], order);
    assert.equal(py.runPython('import sys\n"ctm_checkers.stack.engine" in sys.modules'), true, order);
    assert.deepEqual(py.runPython('sorted(n for n in globals() if n.startswith("_ctm_"))').toJs(), [], order);
  }
});

// Direct installs too, as components make them: stack-sympy's worker installs
// the STACK engine when it starts, math-exercise installs ctm-checkers when it
// loads SymPy (ensureCheckers outside callCheckers). Every order of the four,
// started together (each before the others end) and one after another, and
// the review's case (the STACK engine, then ctm-checkers, then a STACK call,
// together): no call may run while an install replaces the package.
test('Pyodide: direct installs and calls of ctm-checkers and its STACK engine in one runtime, in every order', { skip: skipPyodide, timeout: 1800000 }, async () => {
  assert.ok(haveCheckers, 'ctm-checkers is missing: check out the commit of tests/pins.json into ' + checkersSource);
  const py = await realPyodide();
  const request = await stackRequest(py);
  const expected = { 'install STACK': 'installed', 'install ctm-checkers': 'installed', 'STACK call': '1', 'math call': 'correct' };
  const orders = [];
  (function permute(done, rest) {
    if (!rest.length) { orders.push(done); return; }
    rest.forEach((step, i) => permute([...done, step], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  })([], Object.keys(expected));
  const runs = [['together', ['install STACK', 'install ctm-checkers', 'STACK call']]];
  for (const how of ['together', 'one after another']) for (const order of orders) runs.push([how, order]);
  const failures = [];
  for (const [how, order] of runs) {
    const { R, stack } = pageWithStack();
    const proxy = proxyOf(py);
    const outcome = (promise) => promise.then(String, (error) => 'error: ' + String(error && error.message).trim().split('\n').pop());
    const steps = {
      'install STACK': () => outcome(R.ensureCheckers(proxy, stack).then(() => 'installed')),
      'install ctm-checkers': () => outcome(R.ensureCheckers(proxy).then(() => 'installed')),
      'STACK call': () => outcome(R.callCheckers(proxy, 'stack.grade', request, stack).then((text) => JSON.parse(text).result.score)),
      'math call': () => outcome(R.callCheckers(proxy, 'math_exercise.check', REQUEST).then((text) => JSON.parse(text).status)),
    };
    let results;
    if (how === 'together') results = await Promise.all(order.map((step) => steps[step]()));
    else { results = []; for (const step of order) results.push(await steps[step]()); }
    // Afterwards both calls still work.
    results.push(await steps['STACK call'](), await steps['math call']());
    const want = [...order.map((step) => expected[step]), '1', 'correct'];
    const leftovers = py.runPython('sorted(n for n in globals() if n.startswith("_ctm_"))').toJs();
    if (JSON.stringify(results) !== JSON.stringify(want) || leftovers.length) failures.push({ how, order: order.join(', '), results, leftovers });
  }
  assert.deepEqual(failures, [], 'of ' + runs.length + ' runs');
});
