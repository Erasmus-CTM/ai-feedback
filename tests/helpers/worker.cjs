// Test harness for CTMWorker (runtime/pyodide-worker.js) without a browser:
// the worker source in a vm context with a fake Pyodide, and the page script
// in a vm context with a fake Worker.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const C = require('./ctm-libs.cjs');

const FILE = path.join(C.library, 'runtime', 'pyodide-worker.js');
// The proxy's documented keys (docs/api.md), without a plugin's commands.
const PROXY_KEYS = ['isWorkerProxy', 'interruptBuffer', 'inputStatusBuf', 'inputDataBuf', 'onStream', 'onInputRequired',
  'runPythonAsync', 'loadPackagesFromImports', 'loadPackage', 'toPy', 'globals', 'interrupt', 'clearInterrupt',
  'abortInput', 'provideInput', 'restart'];

const tick = () => new Promise(resolve => setImmediate(resolve));

// The page script in a fresh context; returns that context (its globalThis).
function pageContext({crossOriginIsolated = false} = {}) {
  const target = new EventTarget();
  const workers = [];
  class FakeWorker {
    constructor(url, options) {
      this.url = url; this.options = options; this.posted = []; this.terminated = false; this.onmessage = null;
      workers.push(this);
    }
    postMessage(message) { this.posted.push(message); }
    terminate() { this.terminated = true; }
    reply(data) { this.onmessage({data}); }
  }
  const context = {
    console, Blob, Promise, Map, Error, Object, Uint8Array, Int32Array, SharedArrayBuffer, Atomics, TextEncoder, TextDecoder,
    URL: {createObjectURL: () => 'blob:worker', revokeObjectURL() {}},
    Worker: FakeWorker, Event,
    addEventListener: target.addEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target),
    crossOriginIsolated, workers, statuses: [],
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), context, {filename: FILE});
  return context;
}

// The worker-side source, with `import(<indexURL>pyodide.mjs)` served by the
// test (a vm context cannot import modules).
function workerSource() {
  const source = pageContext().CTMWorker.source;
  const load = 'await import(config.indexURL + "pyodide.mjs")';
  if (!source.includes(load)) throw new Error('worker source: the Pyodide import changed; update tests/helpers/worker.cjs');
  return source.replace(load, 'await __importPyodide(config.indexURL)');
}

// A worker context with a fake Pyodide. `pyodide(ctx)` returns the methods
// to override; ctx.stdout/ctx.stderr are the streams the worker gave
// loadPyodide. Extra globals (fetch, performance) through `globals`.
function workerContext({plugin = '', pyodide = () => ({}), globals = {}} = {}) {
  const messages = [];
  const ctx = {};
  const context = vm.createContext({
    console, Promise, Error, Object, Array, JSON, Math, Map, Set, Uint8Array, Int32Array, TextDecoder, TextEncoder, Atomics,
    setTimeout, clearTimeout, performance,
    self: {postMessage: message => messages.push(structuredClone(message))},
    ...globals,
    __importPyodide: async indexURL => ({
      loadPyodide: async options => {
        ctx.options = options;
        ctx.stdout = options.stdout; ctx.stderr = options.stderr;
        const loaded = {};
        const fake = {
          loadedPackages: loaded,
          loadPackage: async names => { for (const name of [].concat(names)) loaded[name] = 'default channel'; },
          loadPackagesFromImports: async () => {},
          runPythonAsync: async () => undefined,
          setInterruptBuffer() {},
          toPy: value => value,
          globals: {set() {}, get() { const f = () => ({toJs: () => [], destroy() {}}); f.destroy = () => {}; return f; }},
          pyimport: () => ({install: async () => {}, destroy() {}}),
          code: {find_imports: () => ({toJs: () => [], destroy() {}})},
        };
        return Object.assign(fake, pyodide(ctx, fake));
      },
    }),
  });
  vm.runInContext(workerSource() + '\n' + plugin, context);
  const send = message => context.self.onmessage({data: message});
  return {
    context, messages, ctx,
    send,
    init: (config = {}) => send({id: 0, type: 'init', config: {indexURL: 'https://cdn.example/pyodide/', ...config}}),
    results: () => messages.filter(m => (m.type === 'result' || m.type === 'error') && m.id !== 0),
    result: id => messages.find(m => (m.type === 'result' || m.type === 'error') && m.id === id),
  };
}

module.exports = {FILE, PROXY_KEYS, tick, pageContext, workerSource, workerContext};
