// The page-wide Python runtime (runtime/pyodide-runtime.js, global
// MathExerciseRuntime). Moved here with the file from math-exercise
// (tests/shared-runtime.test.mjs at bf6caf3, its runtime cases).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctmLibs = require('./helpers/ctm-libs.cjs');

const PYODIDE = '0.27.2';
const source = fs.readFileSync(path.join(ctmLibs.library, 'runtime', 'pyodide-runtime.js'), 'utf8');
const cdn = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE}/full/`;

function runtime(globals = {}) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(source, context);
  return context;
}

function documentStub(onAppend) {
  const scripts = [];
  return {
    scripts,
    querySelector(selector) {
      return scripts.find((script) => selector === `script[src="${script.src}"]`) ?? null;
    },
    createElement() {
      const listeners = {};
      return {
        dataset: {}, listeners,
        addEventListener(event, listener) { (listeners[event] ??= []).push(listener); },
        dispatch(event) {
          for (const listener of listeners[event] ?? []) listener();
          this[`on${event}`]?.();
        },
        remove() { scripts.splice(scripts.indexOf(this), 1); },
      };
    },
    head: {
      appendChild(script) { scripts.push(script); onAppend(script); },
    },
  };
}

test('the runtime loads Pyodide ' + PYODIDE + ' from jsDelivr', () => {
  assert.equal(runtime().MathExerciseRuntime.indexURL, cdn);
});

test('reuses an existing coatless promise or a ready main instance', async () => {
  const coatless = { loadPackage() {} };
  const fromCoatless = runtime({ qpyodideInstance: Promise.resolve(coatless) });
  assert.equal(await fromCoatless.MathExerciseRuntime.ensurePyodide(), coatless);
  assert.equal(fromCoatless.mainPyodide, coatless);

  const main = { runPythonAsync() {} };
  const fromMain = runtime({ mainPyodide: main });
  assert.equal(await fromMain.MathExerciseRuntime.ensurePyodide(), main);
  assert.equal(fromMain.__qExercisePyodide, undefined);
});

test('reuses top-level lexical instances from another classic script', async () => {
  const context = runtime({ instance: { from: 'lexical' } });
  vm.runInContext('let qpyodideInstance = Promise.resolve(instance)', context);
  assert.equal(await context.MathExerciseRuntime.ensurePyodide(), context.instance);
  assert.equal(context.mainPyodide, context.instance);
  assert.equal(context.qpyodideInstance, undefined);
});

test('shares one browser load and instance across concurrent callers', async () => {
  let loads = 0;
  let script;
  const document = documentStub((tag) => { script = tag; });
  const instance = { name: 'shared' };
  const context = runtime({ document });
  const api = context.MathExerciseRuntime;
  const first = api.ensurePyodide();
  const second = api.ensurePyodide();
  assert.equal(document.scripts.length, 1);
  assert.equal(script.src, cdn + 'pyodide.js');
  context.loadPyodide = async (opts) => {
    loads++;
    assert.equal(opts.indexURL, cdn);
    return instance;
  };
  script.dispatch('load');
  assert.deepEqual(await Promise.all([first, second]), [instance, instance]);
  assert.equal(loads, 1);
  assert.equal(context.mainPyodide, instance);
  assert.equal(await api.ensurePyodide(), instance);
  assert.equal(loads, 1);
});

test('a failed script or initialization clears the shared promise for retry', async () => {
  const document = documentStub(() => {});
  const context = runtime({ document });
  const api = context.MathExerciseRuntime;
  const first = api.ensurePyodide();
  const failedTag = document.scripts[0];
  failedTag.dispatch('error');
  await assert.rejects(first, /Failed to load/);
  assert.equal(context.__qExercisePyodide, undefined);
  assert.equal(document.scripts.length, 0);

  let attempts = 0;
  context.loadPyodide = async () => {
    if (++attempts === 1) throw new Error('temporary init failure');
    return { ready: true };
  };
  await assert.rejects(api.ensurePyodide(), /temporary init failure/);
  assert.equal(context.__qExercisePyodide, undefined);
  assert.equal((await api.ensurePyodide()).ready, true);
  assert.equal(attempts, 2);
});

test('worker imports Pyodide without reading document or window', async () => {
  const instance = { worker: true };
  const imports = [];
  const context = runtime({
    importScripts(src) {
      imports.push(src);
      context.loadPyodide = async ({ indexURL }) => {
        assert.equal(indexURL, cdn);
        return instance;
      };
    },
  });
  assert.equal(await context.MathExerciseRuntime.ensurePyodide(), instance);
  assert.deepEqual(imports, [cdn + 'pyodide.js']);
  assert.equal(context.mainPyodide, instance);
});

test('a load that never finishes (failed WebAssembly) times out and can be retried', async () => {
  let calls = 0;
  const ready = { runPythonAsync() {} };
  const context = runtime({ setTimeout, clearTimeout, __qExercisePyodideTimeout: 50,
    loadPyodide: () => (++calls === 1 ? new Promise(() => {}) : Promise.resolve(ready)) });
  await assert.rejects(context.MathExerciseRuntime.ensurePyodide(), error => error.code === 'pyodide-timeout');
  assert.equal(context.__qExercisePyodide, undefined);
  assert.equal(await context.MathExerciseRuntime.ensurePyodide(), ready);
  assert.equal(calls, 2);
});

test('concurrent installs of different modules keep their own sources, and repeated installs run once', async () => {
  const globals = new Map(), runs = [];
  const py = { globals: { set: async (k, v) => { await new Promise(r => setTimeout(r, 5)); globals.set(k, v); } },
    runPythonAsync: async code => { runs.push(code); const name = code.match(/ModuleType\("([^"]+)"\)/)[1]; const variable = code.match(/exec\((\w+),/)[1];
      assert.equal(globals.get(variable), 'source of ' + name); } };
  const context = runtime({ setTimeout, clearTimeout, WeakMap });
  const R = context.MathExerciseRuntime;
  await Promise.all([R.installModule(py, '_ctm_a', 'source of _ctm_a'), R.installModule(py, '_ctm_b', 'source of _ctm_b'), R.installModule(py, '_ctm_a', 'source of _ctm_a')]);
  assert.equal(runs.length, 2);
});

test('whenSlow waits until the runtime can be stopped; very long delays do not overflow', async () => {
  const context = runtime({ setTimeout, clearTimeout });
  const R = context.MathExerciseRuntime;
  let fired = 0;
  R.whenSlow(10, () => { fired++; });
  await new Promise(r => setTimeout(r, 40));
  assert.equal(fired, 0);                       // no stoppable runtime yet
  context.mainPyodide = { restart() {} };
  await new Promise(r => setTimeout(r, 1100));
  assert.equal(fired, 1);
  let early = 0;
  const cancel = R.whenSlow(99999999 * 1000, () => { early++; });
  await new Promise(r => setTimeout(r, 20));
  cancel();
  assert.equal(early, 0);
});

test('a copy with the current interface replaces an older runtime that loaded first', () => {
  const older = { indexURL: 'x', loadScript() {}, ensurePyodide() {} };
  const context = runtime({ MathExerciseRuntime: older });
  assert.notEqual(context.MathExerciseRuntime, older);
  assert.equal(typeof context.MathExerciseRuntime.stopCount, 'function');
  const current = context.MathExerciseRuntime;
  vm.runInContext(source, context);
  assert.equal(context.MathExerciseRuntime, current);
});
