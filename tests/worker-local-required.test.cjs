const test = require('node:test'), assert = require('node:assert/strict');
const W = require('./helpers/worker.cjs');

function local(pyodide, plugin = '') {
  const net = W.fakeNet({packages: {'pyodide-http': {}, sympy: {}}});
  const warnings = [];
  const worker = W.workerContext({pyodide, plugin, globals: {
    fetch: net.fetch, URL,
    console: {...console, warn: (...args) => warnings.push(args.join(' '))}
  }});
  return {worker, warnings};
}

test('local stage 1 verifies canonical required packages before readiness', async () => {
  const calls = [];
  const {worker} = local((ctx, fake) => ({loadPackage: async (names, options) => {
    calls.push({names, options});
    for (const name of names) fake.loadedPackages[name] = 'default channel';
  }}));
  await worker.init({assetsMode: 'local', packages: ['pyodide_http', 'sympy']});
  assert.equal(worker.result(0).type, 'result');
  assert.deepEqual([...calls[0].names], ['pyodide-http', 'sympy']);
  assert.equal(calls[0].options.checkIntegrity, true);
});

test('a reported stage-1 package failure rejects init and prevents plugin/background execution', async () => {
  const executed = [];
  const {worker, warnings} = local((ctx, fake) => ({
    loadPackage: async (names, options) => {
      fake.loadedPackages.sympy = 'default channel';
      options.errorCallback("Failed to load 'https://cdn.example/pyodide-http.whl': request failed.");
    },
    runPythonAsync: async code => executed.push(code)
  }), 'registerPlugin(() => ({stage1: "required-stage1-hook"}));');
  await worker.init({assetsMode: 'local', packages: ['pyodide_http', 'sympy'], background: {packages: ['sympy'], run: 'background'}});
  assert.equal(worker.result(0).type, 'error');
  assert.match(worker.result(0).message, /^pyodide-http: Failed to load 'pyodide-http.whl': request failed\./);
  assert.doesNotMatch(worker.result(0).message, /https:/);
  await W.tick();
  assert.deepEqual(executed, []);
  assert.equal(worker.messages.some(message => message.type === 'setup'), false);
  assert.match(warnings[0], /stage 1 could not install pyodide-http/);
});

test('a silently missing required package also fails init with its name', async () => {
  const {worker} = local(() => ({loadPackage: async () => {}}));
  await worker.init({assetsMode: 'local', packages: ['sympy']});
  assert.equal(worker.result(0).type, 'error');
  assert.equal(worker.result(0).message, 'sympy: not installed');
});
