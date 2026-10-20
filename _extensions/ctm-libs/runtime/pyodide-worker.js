/* ctm-libs runtime/pyodide-worker.js — AGPL-3.0-or-later.
 * CTMWorker: Python (Pyodide) in a Web Worker for a page (HTML dependency
 * ctm-worker, a classic script after ctm-runtime). One implementation of the
 * worker and its RPC, moved from pyodide-interaktiv 1.8
 * (qpyodide-document-engine-initialization.js); a component adds its own
 * worker-side commands as a plugin (pyodide-interaktiv: runCell).
 *
 * Python runs in its own thread, so the page stays responsive during long
 * computations. Stopping a running computation:
 *   - cross-origin isolated page (COOP/COEP headers, or coi-serviceworker.js):
 *     a KeyboardInterrupt through a SharedArrayBuffer; variables are kept;
 *   - otherwise: the worker restarts (variables are lost).
 * input() works through Atomics.wait on a SharedArrayBuffer (isolated pages).
 *
 *   CTMWorker.start(options) -> Promise of the proxy (docs/api.md)
 *
 * The proxy is what `await qpyodideReady` and `mainPyodide` give other
 * components (publish: true): runPythonAsync, loadPackagesFromImports,
 * loadPackage, globals.set, toPy, isWorkerProxy, interrupt, clearInterrupt,
 * abortInput, provideInput, restart, the shared buffers, onStream,
 * onInputRequired, and the plugin's commands. */
(function (root) {
  'use strict';
  if (root.CTMWorker && typeof root.CTMWorker.start === 'function') return;

  // ---------------------------------------------------------------------------
  // Worker source (runs in the background thread)
  // ---------------------------------------------------------------------------
  // Important: String.raw, so escape sequences arrive in the worker unchanged.
  // Don't use backticks or "dollar-curly-brace" in the worker source!
  var WORKER_SOURCE = String.raw`
// Pyodide worker of ctm-libs (CTMWorker)
let pyodide = null;
let runEntries = [];

// Input buffer for Atomics-based stdin (null if unavailable)
let inputStatusBuf = null;   // Int32Array(SharedArrayBuffer) 0=idle 1=waiting 2=ready 3=aborted
let inputDataBuf   = null;   // Uint8Array(SharedArrayBuffer) UTF-8-encoded input (null-terminated)

// Prompt text of the next input() call (set through the plugins' setPrompt)
let pendingInputPrompt = "";

// stdin: blocks the worker thread until the user enters something.
// Called by Pyodide as the stdin handler when Python executes input().
// First sends a request to the main thread, then the worker waits via
// Atomics.wait (blocks only the worker thread, not the page).
// If no SharedArrayBuffer is available, stdin returns null (EOF).
function stdin() {
  if (!inputStatusBuf || !inputDataBuf) return null;
  const prompt = pendingInputPrompt;
  pendingInputPrompt = "";
  Atomics.store(inputStatusBuf, 0, 1);              // status: waiting
  self.postMessage({ type: "inputRequired", prompt }); // notify the main thread
  Atomics.wait(inputStatusBuf, 0, 1);               // block until status != 1
  const status = Atomics.load(inputStatusBuf, 0);
  Atomics.store(inputStatusBuf, 0, 0);              // status: idle
  if (status !== 2) return null;                    // aborted (status 3) -> EOF
  let end = 0;
  while (end < inputDataBuf.length && inputDataBuf[end] !== 0) end++;
  return new TextDecoder().decode(inputDataBuf.slice(0, end)) + "\n";
}

function postStatus(text) {
  self.postMessage({ type: "status", text: text });
}

// Plugins: a component's worker-side code calls registerPlugin(factory);
// factory(api) returns {commands: {name: async (message) => value},
// stage1: "<Python run once the interpreter is ready>"}.
// api.pyodide(): the interpreter; api.capture: the stdout/stderr evidence of
// a command (start() empties it, push(entry), entries()); api.setPrompt(text):
// the prompt of the next input() call (Pyodide's stdout is line-buffered, so
// a prompt without a newline would never reach the page otherwise).
const plugins = [];
const pluginCommands = {};
const pluginAPI = {
  pyodide: () => pyodide,
  capture: {
    start() { runEntries = []; },
    push(entry) { runEntries.push(entry); },
    entries() { return runEntries; }
  },
  setPrompt(text) { pendingInputPrompt = String(text); }
};
function registerPlugin(factory) {
  const plugin = factory(pluginAPI) || {};
  plugins.push(plugin);
  for (const name of Object.keys(plugin.commands || {})) pluginCommands[name] = plugin.commands[name];
}

async function init(config) {
  // Translated status texts come along from the main thread
  const msg = config.messages || {};
  const mod = await import(config.indexURL + "pyodide.mjs");

  postStatus(msg.loading || "Loading Python (Pyodide) ...");
  pyodide = await mod.loadPyodide({
    indexURL: config.indexURL,
    // Preserve the pre-0.28 JavaScript-null behaviour for existing lessons.
    convertNullToNone: true,
    env: config.env,
    stdin: stdin,
    stdout: function(text) {
      runEntries.push({ message: text, type: "stdout" });
      self.postMessage({ type: "streamStdout", text: text });
    },
    stderr: function(text) {
      runEntries.push({ message: text, type: "stderr" });
      self.postMessage({ type: "streamStderr", text: text });
    }
  });

  postStatus(msg.initPackages || "Initialising Python packages ...");
  await pyodide.loadPackage("micropip");

  // Packages requested by the page (pyodide: packages: [...])
  if (config.packages && config.packages.length > 0) {
    postStatus(msg.extraPackages || "Installing additional packages ...");
    const micropip = pyodide.pyimport("micropip");
    await micropip.install(config.packages);
    micropip.destroy();
  }

  for (const plugin of plugins) {
    if (plugin.stage1) await pyodide.runPythonAsync(plugin.stage1);
  }

  // Further packages, one at a time, with Python to run after each
  for (const step of config.background || []) {
    if (step.load && step.load.length) await pyodide.loadPackage(step.load);
    if (step.run) await pyodide.runPythonAsync(step.run);
  }
}

// Raw Python call (RPC variant of runPythonAsync, e.g. for
// py-exercise). Result must be structured-clone-capable.
async function runPythonRaw(code) {
  const result = await pyodide.runPythonAsync(code);
  if (result && typeof result.toJs === "function") {
    let value;
    try {
      value = result.toJs({ dict_converter: Object.fromEntries, create_pyproxies: false });
    } catch (err) {
      value = String(result);
    }
    result.destroy();
    return value;
  }
  return result;
}

async function handleMessage(msg) {
  try {
    let value = true;
    switch (msg.type) {
      case "init":
        await init(msg.config);
        break;
      case "setInterrupt":
        pyodide.setInterruptBuffer(msg.buffer);
        break;
      case "setInputBuffers":
        inputStatusBuf = msg.inputStatusBuf;
        inputDataBuf   = msg.inputDataBuf;
        break;
      case "runPython":
        value = await runPythonRaw(msg.code);
        break;
      case "loadPackagesFromImports":
        await pyodide.loadPackagesFromImports(msg.code);
        break;
      case "loadPackage":
        await pyodide.loadPackage(msg.name);
        break;
      case "setGlobal":
        pyodide.globals.set(msg.name, pyodide.toPy(msg.value));
        break;
      default:
        if (!Object.prototype.hasOwnProperty.call(pluginCommands, msg.type)) throw new Error("Unknown command: " + msg.type);
        value = await pluginCommands[msg.type](msg);
    }
    self.postMessage({ type: "result", id: msg.id, value: value });
  } catch (err) {
    self.postMessage({ type: "error", id: msg.id, message: String((err && err.message) || err) });
  }
}

// Python has one interpreter and one output capture. Serialize mutations so a
// checker from another extension cannot enter a document cell's stdout evidence.
// Input/interrupt buffers are control messages, independent of this queue.
let commandQueue = Promise.resolve();
self.onmessage = function(event) {
  const msg = event.data;
  if (msg.type === "setInterrupt" || msg.type === "setInputBuffers") {
    return handleMessage(msg);
  }
  const pending = commandQueue.then(() => handleMessage(msg));
  commandQueue = pending.catch(() => {});
  return pending;
};
`;

  // ---------------------------------------------------------------------------
  // Main thread: start the worker + provide the RPC proxy
  // ---------------------------------------------------------------------------

  // options (all optional but indexURL):
  //   indexURL      Pyodide's base URL (ctm.runtime.indexURL() or a project's base-url)
  //   env           the interpreter's environment ({HOME: ...})
  //   packages      micropip packages to install before the proxy is ready
  //   background    [{load: [names], run: "Python"}, ...] after them, one at a time
  //   plugin        worker-side source that calls registerPlugin(...)
  //   commands      {name: [argument names]}: the plugin's commands on the proxy
  //   messages      {loading, initPackages, extraPackages}: status texts
  //   onStatus(text)        a status text from the worker
  //   onRestart(started)    after restart(): the new start's promise
  //   publish       true: qpyodideReady, qpyodideInstance, _qpyodideGetInstance
  //                 and mainPyodide (the globals other components use)
  function start(options) {
    options = options || {};
    var started = boot(options);
    if (options.publish) publish(started);
    return started;
  }

  function publish(started) {
    root.mainPyodide = undefined;
    root.qpyodideReady = started;
    // Compatibility alias: older extensions (e.g. py-exercise) expect
    // `qpyodideInstance` and `await` on it.
    root.qpyodideInstance = started;
    // A function to retrieve the promise object.
    root._qpyodideGetInstance = function () { return root.qpyodideInstance; };
    // mainPyodide is set by boot() when the proxy is ready; a rejected start
    // is the components' to report.
    started.catch(function () {});
  }

  function boot(options) {
    var pending = new Map();
    var nextId = 1;

    var source = WORKER_SOURCE + (options.plugin ? '\n' + options.plugin + '\n' : '');
    var blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    var worker = new Worker(blobUrl, { type: 'module' });

    function rpc(type, payload) {
      return new Promise(function (resolve, reject) {
        var id = nextId++;
        pending.set(id, { resolve: resolve, reject: reject });
        worker.postMessage(Object.assign({ type: type, id: id }, payload || {}));
      });
    }

    worker.onmessage = function (event) {
      var msg = event.data;
      if (msg.type === 'status')        { if (options.onStatus) options.onStatus(msg.text); return; }
      if (msg.type === 'streamStdout')  { if (proxy.onStream) proxy.onStream(msg.text, 'stdout'); return; }
      if (msg.type === 'streamStderr')  { if (proxy.onStream) proxy.onStream(msg.text, 'stderr'); return; }
      if (msg.type === 'inputRequired') { if (proxy.onInputRequired) proxy.onInputRequired(msg.prompt != null ? msg.prompt : ''); return; }
      var entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.type === 'error') {
        entry.reject(new Error(msg.message));
      } else {
        entry.resolve(msg.value);
      }
    };

    worker.onerror = function (event) {
      console.error('CTMWorker: error in the Pyodide worker', event);
    };

    // Proxy object: what `await qpyodideReady` / `mainPyodide` resolves to.
    // The Pyodide-like methods are RPC variants, so that extensions like
    // py-exercise keep working (postMessage guarantees ordering, so e.g.
    // globals.set may be called without await before runPythonAsync).
    var proxy = {
      isWorkerProxy: true,
      interruptBuffer: null,
      inputStatusBuf: null,     // Int32Array(SharedArrayBuffer) – input status
      inputDataBuf: null,       // Uint8Array(SharedArrayBuffer) – input data (UTF-8)
      onStream: null,           // Callback(text, type) – streamed stdout/stderr
      onInputRequired: null,    // Callback() – Python is waiting for input

      runPythonAsync: function (code) { return rpc('runPython', { code: code }); },
      loadPackagesFromImports: function (code) { return rpc('loadPackagesFromImports', { code: code }); },
      loadPackage: function (name) { return rpc('loadPackage', { name: name }); },
      toPy: function (value) { return value; },   // conversion happens worker-side
      globals: {
        set: function (name, value) { return rpc('setGlobal', { name: name, value: value }); }
      },

      /** Graceful abort (KeyboardInterrupt) – only with SharedArrayBuffer. */
      interrupt: function () {
        if (this.interruptBuffer) this.interruptBuffer[0] = 2;   // SIGINT
        this.abortInput();
      },
      clearInterrupt: function () {
        if (this.interruptBuffer) this.interruptBuffer[0] = 0;
      },

      /** Aborts a pending input() wait in the worker (status 3 = aborted). */
      abortInput: function () {
        if (this.inputStatusBuf && Atomics.load(this.inputStatusBuf, 0) === 1) {
          Atomics.store(this.inputStatusBuf, 0, 3);
          Atomics.notify(this.inputStatusBuf, 0, 1);
        }
      },

      /** Delivers an input value to the waiting worker (status 2 = ready). */
      provideInput: function (text) {
        if (!this.inputStatusBuf || !this.inputDataBuf) return;
        var encoded = new TextEncoder().encode(text);
        this.inputDataBuf.fill(0);
        this.inputDataBuf.set(encoded.slice(0, this.inputDataBuf.length - 1));
        Atomics.store(this.inputStatusBuf, 0, 2);
        Atomics.notify(this.inputStatusBuf, 0, 1);
      },

      /**
       * Hard restart: terminate the worker, reject all pending calls, and
       * boot a fresh runtime (options.onRestart runs the startup cells again).
       */
      restart: function (reason) {
        root.dispatchEvent(new Event('qpyodide-runtime-restart'));
        worker.terminate();
        var error = new Error(reason || 'Python was restarted.');
        pending.forEach(function (entry) { entry.reject(error); });
        pending.clear();

        var again = boot(options);
        if (options.publish) publish(again);
        if (options.onRestart) options.onRestart(again);
        return again;
      }
    };
    Object.keys(options.commands || {}).forEach(function (name) {
      var names = options.commands[name] || [];
      proxy[name] = function () {
        var payload = {};
        for (var i = 0; i < names.length; i++) payload[names[i]] = arguments[i];
        return rpc(name, payload);
      };
    });

    var started = (async function () {
      if (options.onStatus && options.messages && options.messages.loading) options.onStatus(options.messages.loading);

      try {
        await rpc('init', {
          config: {
            indexURL: options.indexURL,
            env: options.env || {},
            packages: options.packages || [],
            background: options.background || [],
            messages: options.messages || {}
          }
        });
      } finally {
        URL.revokeObjectURL(blobUrl);
      }

      // Enable the shared buffer if the page is cross-origin isolated.
      // Interrupt buffer: graceful abort (KeyboardInterrupt).
      // Input buffer: Atomics-based input() (Python pauses via Atomics.wait).
      if (root.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') {
        try {
          proxy.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
          await rpc('setInterrupt', { buffer: proxy.interruptBuffer });

          proxy.inputStatusBuf = new Int32Array(new SharedArrayBuffer(4));
          proxy.inputDataBuf   = new Uint8Array(new SharedArrayBuffer(4096));
          await rpc('setInputBuffers', {
            inputStatusBuf: proxy.inputStatusBuf,
            inputDataBuf:   proxy.inputDataBuf
          });
        } catch (err) {
          proxy.interruptBuffer = null;
          proxy.inputStatusBuf  = null;
          proxy.inputDataBuf    = null;
          console.warn('CTMWorker: shared buffer unavailable', err);
        }
      }

      if (options.publish && root.qpyodideReady === started) root.mainPyodide = proxy;
      return proxy;
    })();
    return started;
  }

  root.CTMWorker = { start: start, source: WORKER_SOURCE };
})(globalThis);
