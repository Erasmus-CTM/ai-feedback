// ctm-libs runtime/pyodide-worker.js: moved verbatim from pyodide-interaktiv 1.8
// (_extensions/pyodide-interaktiv/qpyodide-document-engine-initialization.js at
// 8a16aa7), without its own parts (the plot setup, runCell and looksLikeHtml stay
// there as its worker plugin). Not loaded yet: the next commits make it CTMWorker.
//
// qpyodide-document-engine-initialization.js – start Pyodide in a Web Worker
//
// Core idea: Python runs in its own thread (Web Worker). This keeps the page
// fully responsive during execution – even for long computations. The
// worker is created as a blob module worker directly from this file (the
// extension only injects inline scripts).
//
// Aborting a running execution:
//   * page is cross-origin isolated (COOP/COEP headers set):
//     graceful abort via SharedArrayBuffer + setInterruptBuffer
//     (KeyboardInterrupt, variables are preserved).
//   * otherwise: hard restart of the worker (variables are lost,
//     setup/output/autorun cells run again afterwards).
//
// Global interfaces for other modules/extensions:
//   qpyodideReady    – Promise that resolves with the Pyodide proxy
//   qpyodideInstance – alias for the same Promise (compatibility, used
//                      e.g. by Erasmus-CTM/py-exercise)
//   mainPyodide      – the proxy (set once the worker is ready);
//                      offers runPythonAsync, loadPackagesFromImports,
//                      loadPackage, globals.set, and toPy as RPC variants

// ---------------------------------------------------------------------------
// Worker source (runs in the background thread)
// ---------------------------------------------------------------------------
// Important: String.raw, so escape sequences arrive in the worker unchanged.
// Don't use backticks or "dollar-curly-brace" in the worker source!

const qpyodideWorkerSource = String.raw`
// Pyodide worker of the pyodide-interaktiv extension
let pyodide = null;
let runEntries = [];

// Input buffer for Atomics-based stdin (null if unavailable)
let inputStatusBuf = null;   // Int32Array(SharedArrayBuffer) 0=idle 1=waiting 2=ready 3=aborted
let inputDataBuf   = null;   // Uint8Array(SharedArrayBuffer) UTF-8-encoded input (null-terminated)

// Prompt text of the next input() call (set by Python via _qpyodide_set_prompt)
let pendingInputPrompt = "";
self._qpyodide_set_prompt = (p) => { pendingInputPrompt = String(p); };

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

async function init(config) {
  // Translated status texts come along from the main thread (the worker doesn't know QP_L)
  const msg = config.messages || {};
  const mod = await import(config.indexURL + "pyodide.mjs");

  postStatus(msg.workerLoading || "Loading Python (Pyodide) ...");
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

  postStatus(msg.workerInitPackages || "Initialising Python packages ...");
  await pyodide.loadPackage("micropip");

  // Packages requested by the document (pyodide: packages: [...])
  if (config.packages && config.packages.length > 0) {
    postStatus(msg.workerExtraPackages || "Installing additional packages ...");
    const micropip = pyodide.pyimport("micropip");
    await micropip.install(config.packages);
    micropip.destroy();
  }

  // Shim requests/urllib3 (synchronous XHR is allowed in the worker)
  await pyodide.loadPackage("pyodide_http");
  await pyodide.runPythonAsync("import pyodide_http\npyodide_http.patch_all()");

  await pyodide.loadPackage("matplotlib");
  await pyodide.runPythonAsync(PY_SETUP);
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
        throw new Error("Unknown command: " + msg.type);
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

function qpyodideBootPyodideWorker() {
  const pending = new Map();
  let nextId = 1;

  const blobUrl = URL.createObjectURL(
    new Blob([qpyodideWorkerSource], { type: "text/javascript" })
  );
  const worker = new Worker(blobUrl, { type: "module" });

  function rpc(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ type, id, ...payload });
    });
  }

  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === "status")      { qpyodideUpdateStatusHeaderSpinner(msg.text); return; }
    if (msg.type === "streamStdout") { proxy.onStream?.(msg.text, "stdout"); return; }
    if (msg.type === "streamStderr") { proxy.onStream?.(msg.text, "stderr"); return; }
    if (msg.type === "inputRequired") { proxy.onInputRequired?.(msg.prompt ?? ""); return; }
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.type === "error") {
      entry.reject(new Error(msg.message));
    } else {
      entry.resolve(msg.value);
    }
  };

  worker.onerror = (event) => {
    console.error("qpyodide: error in the Pyodide worker", event);
  };

  // Proxy object: what `await qpyodideReady` / `mainPyodide` resolves to.
  // The Pyodide-like methods are RPC variants, so that extensions like
  // py-exercise keep working (postMessage guarantees ordering, so e.g.
  // globals.set may be called without await before runPythonAsync).
  const proxy = {
    isWorkerProxy: true,
    interruptBuffer: null,
    inputStatusBuf: null,     // Int32Array(SharedArrayBuffer) – input status
    inputDataBuf: null,       // Uint8Array(SharedArrayBuffer) – input data (UTF-8)
    onStream: null,           // Callback(text, type) – streamed stdout/stderr
    onInputRequired: null,    // Callback() – Python is waiting for input

    runPythonAsync: (code) => rpc("runPython", { code }),
    loadPackagesFromImports: (code) => rpc("loadPackagesFromImports", { code }),
    loadPackage: (name) => rpc("loadPackage", { name }),
    toPy: (value) => value,   // conversion happens worker-side
    globals: {
      set: (name, value) => rpc("setGlobal", { name, value })
    },

    /** Graceful abort (KeyboardInterrupt) – only with SharedArrayBuffer. */
    interrupt() {
      if (this.interruptBuffer) this.interruptBuffer[0] = 2;   // SIGINT
      this.abortInput();
    },
    clearInterrupt() {
      if (this.interruptBuffer) this.interruptBuffer[0] = 0;
    },

    /** Aborts a pending input() wait in the worker (status 3 = aborted). */
    abortInput() {
      if (this.inputStatusBuf && Atomics.load(this.inputStatusBuf, 0) === 1) {
        Atomics.store(this.inputStatusBuf, 0, 3);
        Atomics.notify(this.inputStatusBuf, 0, 1);
      }
    },

    /** Delivers an input value to the waiting worker (status 2 = ready). */
    provideInput(text) {
      if (!this.inputStatusBuf || !this.inputDataBuf) return;
      const encoded = new TextEncoder().encode(text);
      this.inputDataBuf.fill(0);
      this.inputDataBuf.set(encoded.slice(0, this.inputDataBuf.length - 1));
      Atomics.store(this.inputStatusBuf, 0, 2);
      Atomics.notify(this.inputStatusBuf, 0, 1);
    },

    /**
     * Hard restart: terminate the worker, reject all pending calls, and
     * boot a fresh runtime (startup cells run again).
     */
    restart(reason) {
      window.dispatchEvent(new Event("qpyodide-runtime-restart"));
      worker.terminate();
      const error = new Error(reason || "Python was restarted.");
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();

      globalThis.mainPyodide = undefined;
      globalThis.qpyodideReady = qpyodideBootPyodideWorker();
      globalThis.qpyodideInstance = globalThis.qpyodideReady;
      globalThis.qpyodideReady.then(() => {
        return globalThis.qpyodideCellContainer?.runStartupCells();
      }).catch((err) => console.error("qpyodide: restart failed", err));
    }
  };

  return (async () => {
    qpyodideUpdateStatusHeaderSpinner(QP_L.workerLoading);
    const timerStart = performance.now();

    try {
      await rpc("init", {
        config: {
          indexURL: qpyodideCustomizedPyodideOptions.indexURL,
          env: qpyodideCustomizedPyodideOptions.env,
          packages: qpyodideSetupPythonPackages ? qpyodideInstallPythonPackagesList : [],
          messages: {
            workerLoading:       QP_L.workerLoading,
            workerInitPackages:  QP_L.workerInitPackages,
            workerExtraPackages: QP_L.workerExtraPackages
          }
        }
      });
    } catch (err) {
      qpyodideUpdateStatusHeader(QP_L.engineFailed(err.message));
      throw err;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    // Enable the shared buffer if the page is cross-origin isolated.
    // Interrupt buffer: graceful abort (KeyboardInterrupt).
    // Input buffer: Atomics-based input() (Python pauses via Atomics.wait).
    if (globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined") {
      try {
        proxy.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
        await rpc("setInterrupt", { buffer: proxy.interruptBuffer });

        proxy.inputStatusBuf = new Int32Array(new SharedArrayBuffer(4));
        proxy.inputDataBuf   = new Uint8Array(new SharedArrayBuffer(4096));
        await rpc("setInputBuffers", {
          inputStatusBuf: proxy.inputStatusBuf,
          inputDataBuf:   proxy.inputDataBuf
        });
      } catch (err) {
        proxy.interruptBuffer = null;
        proxy.inputStatusBuf  = null;
        proxy.inputDataBuf    = null;
        console.warn("qpyodide: shared buffer unavailable", err);
      }
    }

    globalThis.mainPyodide = proxy;

    qpyodideSetInteractiveButtonState(QP_L.runLabel, true);
    qpyodideUpdateStatusHeader(QP_L.engineReady);

    const elapsed = (performance.now() - timerStart) / 1000;
    console.log(`qpyodide: Pyodide worker ready after ${elapsed.toFixed(1)}s`);

    return proxy;
  })();
}

globalThis.qpyodideReady = qpyodideBootPyodideWorker();

// Compatibility alias: older extensions (e.g. py-exercise) expect
// `qpyodideInstance` and `await` on it.
globalThis.qpyodideInstance = qpyodideReady;

// Create a function to retrieve the promise object.
globalThis._qpyodideGetInstance = function() {
  return globalThis.qpyodideInstance;
}
