// Page-wide Python runtime of CTM Assessment (ctm-libs; HTML dependency
// ctm-runtime, a classic script loaded once per page), used by math-exercise
// and py-exercise. stack-sympy vendors a pinned revision (see its
// vendor/provenance.json).
(function (root) {
  'use strict';

  // An older copy (another component's release) may have loaded first; a
  // copy with the current interface replaces it (shared state lives on root).
  if (root.MathExerciseRuntime && typeof root.MathExerciseRuntime.whenSlow === 'function') return;

  var indexURL = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';
  var LOAD_TIMEOUT = root.__qExercisePyodideTimeout || 180000; // override for tests

  function loadScript(src) {
    if (src === indexURL + 'pyodide.js' && typeof root.loadPyodide === 'function') {
      return Promise.resolve();
    }

    if (typeof document === 'undefined') {
      if (typeof root.importScripts !== 'function') {
        return Promise.reject(new Error('Cannot load Pyodide: no document or importScripts'));
      }
      try {
        root.importScripts(src);
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error);
      }
    }

    return new Promise(function (resolve, reject) {
      var script = document.querySelector('script[src="' + src + '"]');
      if (script && script.dataset.qLoaded === '1') { resolve(); return; }

      function loaded() {
        script.dataset.qLoaded = '1';
        resolve();
      }
      function failed() {
        // A failed tag must not trap a later attempt waiting for an event that
        // will never fire. This also permits a retry after a temporary outage.
        if (typeof script.remove === 'function') script.remove();
        reject(new Error('Failed to load: ' + src));
      }

      if (script) {
        script.addEventListener('load', loaded, { once: true });
        script.addEventListener('error', failed, { once: true });
        return;
      }
      script = document.createElement('script');
      script.src = src;
      script.onload = loaded;
      script.onerror = failed;
      document.head.appendChild(script);
    });
  }

  // Waits for Python at most LOAD_TIMEOUT: a load that never finishes ends
  // with an error a later attempt can retry, instead of waiting forever.
  function withLoadLimit(promise) {
    if (typeof setTimeout !== 'function') return Promise.resolve(promise);
    var timer;
    var timeout = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        var error = new Error('Python did not finish loading within ' + LOAD_TIMEOUT / 1000 + ' s');
        error.code = 'pyodide-timeout';
        reject(error);
      }, LOAD_TIMEOUT);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(function () { clearTimeout(timer); });
  }

  async function ensurePyodide() {
    // Some Quarto integrations declare these with top-level `let`, which is
    // visible to classic scripts but is not a property of globalThis.
    var coatless = typeof qpyodideInstance !== 'undefined'
      ? qpyodideInstance : root.qpyodideInstance;
    if (typeof coatless !== 'undefined') {
      // pyodide-interaktiv's worker may still be starting.
      root.mainPyodide = await withLoadLimit(coatless);
      return root.mainPyodide;
    }
    var existing = typeof mainPyodide !== 'undefined'
      ? mainPyodide : root.mainPyodide;
    if (typeof existing !== 'undefined') {
      root.mainPyodide = await withLoadLimit(existing);
      return root.mainPyodide;
    }

    // Share the in-flight initialization with all consumers on this page or
    // worker. Install the promise before either extension can start another.
    if (!root.__qExercisePyodide) {
      root.__qExercisePyodide = (async function () {
        await loadScript(indexURL + 'pyodide.js');
        // A failed WebAssembly download leaves loadPyodide() pending forever;
        // give up after LOAD_TIMEOUT so that a later attempt can start again.
        return withLoadLimit(root.loadPyodide({ indexURL: indexURL }));
      })();
    }
    var pending = root.__qExercisePyodide;
    try {
      root.mainPyodide = await pending;
      return root.mainPyodide;
    } catch (error) {
      if (root.__qExercisePyodide === pending) root.__qExercisePyodide = undefined;
      throw error;
    }
  }

  // Interpreter state that code run by one component on the page must not
  // change for the others (learner code in py-exercise, answers parsed by
  // math-exercise): `snapshot()` before, `restore(state)` after.
  var GUARD_PY = [
    'import builtins as _builtins, os as _os, sys as _sys',
    '_MISSING = object()',
    '',
    'def snapshot():',
    '    return {',
    '        "builtins": dict(_builtins.__dict__),',
    '        "streams": (_sys.stdin, _sys.stdout, _sys.stderr),',
    '        "hooks": (_sys.displayhook, _sys.excepthook),',
    '        "recursion": _sys.getrecursionlimit(),',
    '        "path": list(_sys.path),',
    '        "path_list": _sys.path,',
    '        "cwd": _os.getcwd(),',
    '        "modules": {k: v for k, v in _sys.modules.items() if k.startswith("_ctm_")},',
    '    }',
    '',
    'def restore(state):',
    '    # Each item on its own: one that fails must not leave the others changed.',
    '    def builtins_():',
    '        current = _builtins.__dict__',
    '        for key in [k for k in current if k not in state["builtins"]]:',
    '            del current[key]',
    '        for key, value in state["builtins"].items():',
    '            if current.get(key, _MISSING) is not value:',
    '                current[key] = value',
    '    def streams():',
    '        _sys.stdin, _sys.stdout, _sys.stderr = state["streams"]',
    '        _sys.displayhook, _sys.excepthook = state["hooks"]',
    '    def path():',
    '        _sys.path = state["path_list"]',
    '        _sys.path[:] = state["path"]',
    '    for step in (builtins_, streams, lambda: _sys.setrecursionlimit(state["recursion"]), path,',
    '                 lambda: _os.chdir(state["cwd"]), lambda: _sys.modules.update(state["modules"])):',
    '        try:',
    '            step()',
    '        except Exception:',
    '            pass',
  ].join('\n');

  // Installs a Python source as a private module (not in the interpreter's
  // global namespace, which learner code shares), once per runtime. Calls for
  // the same module share one install; each module passes its source under
  // its own name, so concurrent installs of different modules cannot mix.
  var installed = typeof WeakMap === 'function' ? new WeakMap() : null;
  function installModule(py, name, source) {
    var done = installed && installed.get(py);
    if (done && done[name]) return done[name];
    var variable = '_ctm_source_' + name.replace(/[^A-Za-z0-9_]/g, '_');
    var install = (async function () {
      await py.globals.set(variable, source);
      await py.runPythonAsync([
        'import sys as _ctm_sys, types as _ctm_types',
        '_ctm_module = _ctm_types.ModuleType("' + name + '")',
        'exec(' + variable + ', _ctm_module.__dict__)',
        '_ctm_sys.modules["' + name + '"] = _ctm_module',
        'del _ctm_sys, _ctm_types, _ctm_module, ' + variable,
      ].join('\n'));
    })();
    if (installed) {
      if (!done) { done = {}; installed.set(py, done); }
      done[name] = install;
      install.catch(function () { if (done[name] === install) delete done[name]; });
    }
    return install;
  }
  // Forget installed modules of a runtime (for example after learner code in
  // another cell removed them); the next install runs again.
  function forgetModules(py) { if (installed) installed.delete(py); }
  function ensureGuard(py) { return installModule(py, '_ctm_guard', GUARD_PY); }

  // A runtime that can be stopped while it runs (pyodide-interaktiv's worker):
  // Python on the page itself cannot be interrupted, only reloaded.
  function canStop() {
    var py = root.mainPyodide;
    return !!(py && typeof py.restart === 'function');
  }
  // Stops are page-wide: every component compares `stops` before and after a
  // run, so a check stopped from any button is neither repeated nor shown as
  // an unexpected error.
  var stops = 0;
  function stop(reason) {
    if (!canStop()) return;
    stops++;
    root.mainPyodide.restart(reason || 'Stopped by the learner');
  }
  function stopCount() { return stops; }
  // Calls onSlow once when a run has taken `ms` and the runtime can be
  // stopped (a worker that is still starting becomes stoppable later).
  // Returns a function that cancels it.
  function whenSlow(ms, onSlow) {
    var timer = null, cancelled = false;
    function check() {
      if (cancelled) return;
      if (canStop()) { onSlow(); return; }
      timer = setTimeout(check, 1000);
    }
    timer = setTimeout(check, Math.min(ms, 2147483647));  // larger delays overflow to 0
    return function () { cancelled = true; clearTimeout(timer); };
  }

  root.MathExerciseRuntime = {
    indexURL: indexURL,
    loadTimeout: LOAD_TIMEOUT,
    loadScript: loadScript,
    ensurePyodide: ensurePyodide,
    installModule: installModule,
    forgetModules: forgetModules,
    ensureGuard: ensureGuard,
    canStop: canStop,
    stop: stop,
    stopCount: stopCount,
    whenSlow: whenSlow
  };
})(globalThis);
