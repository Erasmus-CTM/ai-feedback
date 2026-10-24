const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const W = require('./helpers/worker.cjs');
const C = require('./helpers/ctm-libs.cjs');

function page() {
  const p = W.pageContext(), clock = W.fakeClock();
  p.setTimeout = clock.setTimeout; p.clearTimeout = clock.clearTimeout;
  vm.runInContext(fs.readFileSync(path.join(C.library, 'runtime/pyodide-runtime.js'), 'utf8'), p);
  return {p, clock, R: p.MathExerciseRuntime};
}
async function ready(p, options = {}) {
  const start = p.CTMWorker.start(options), worker = p.workers.at(-1);
  worker.reply({type: 'result', id: worker.posted[0].id, value: true});
  return {proxy: await start, worker};
}

test('an unpublished worker restart never announces a published runtime restart', async () => {
  const {p} = page(); let events = 0;
  p.addEventListener('qpyodide-runtime-restart', () => events++);
  const {proxy} = await ready(p);
  const published = {restart() { throw new Error('wrong runtime'); }};
  p.mainPyodide = published;
  const replacement = proxy.restart();
  const next = p.workers.at(-1);
  next.reply({type: 'result', id: next.posted[0].id, value: true});
  await replacement;
  assert.equal(events, 0); assert.equal(p.mainPyodide, published);
});

test('published restart identifies exactly the old proxy before replacing it', async () => {
  const {p} = page(), {proxy} = await ready(p, {publish: true});
  let detail;
  p.addEventListener('qpyodide-runtime-restart', e => { detail = e.detail; assert.equal(p.mainPyodide, proxy); });
  const replacement = proxy.restart(), next = p.workers.at(-1);
  next.reply({type: 'result', id: next.posted[0].id, value: true});
  assert.equal(detail.proxy, proxy); assert.equal(p.mainPyodide, undefined);
  const replacementProxy = await replacement;
  assert.equal(p.mainPyodide, replacementProxy);
  assert.equal(replacementProxy, await p.qpyodideReady);
});

test('a private Stop restarts only its own non-isolated worker and leaves the default stop count unchanged', async () => {
  const {p, R} = page(), {proxy, worker} = await ready(p);
  const published = {restart() { throw new Error('wrong runtime'); }};
  p.mainPyodide = published;
  const call = proxy.runPythonAsync('hang'), rejected = assert.rejects(call, /Stopped by the learner/);
  const stopped = R.stop(undefined, {runtime: proxy});
  const next = p.workers.at(-1);
  next.reply({type: 'result', id: next.posted[0].id, value: true});
  await stopped; await rejected;
  assert.equal(worker.terminated, true); assert.equal(p.mainPyodide, published);
  assert.equal(R.stopCount(), 0); assert.equal(R.stopCount({runtime: proxy}), 1);
});

test('an isolated Stop interrupts, preserves a responsive session, and clears SIGINT for its next run', async () => {
  const {p, clock, R} = page(), {proxy, worker} = await ready(p);
  p.crossOriginIsolated = true;
  proxy.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
  const call = proxy.runPythonAsync('long run');
  const stopped = R.stop('stop private', {runtime: proxy});
  assert.equal(proxy.interruptBuffer[0], 2);
  assert.equal(R.stop('again', {runtime: proxy}), stopped);
  await clock.advance(1999); assert.equal(worker.terminated, false);
  worker.reply({type: 'error', id: worker.posted.at(-1).id, message: 'KeyboardInterrupt'});
  await assert.rejects(call, /KeyboardInterrupt/); await stopped;
  assert.equal(proxy.interruptBuffer[0], 0); assert.equal(worker.terminated, false);
  assert.equal(p.workers.length, 1);
  const next = proxy.runPythonAsync('2+2');
  worker.reply({type: 'result', id: worker.posted.at(-1).id, value: 4});
  assert.equal(await next, 4);
});

test('an ignored interrupt restarts only the selected worker after two seconds', async () => {
  const {p, clock, R} = page(), {proxy, worker} = await ready(p);
  p.crossOriginIsolated = true;
  proxy.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
  const call = proxy.runPythonAsync('unresponsive'), rejected = assert.rejects(call, /deadline/);
  const stopped = R.stop('deadline', {runtime: proxy});
  await clock.advance(1999); assert.equal(p.workers.length, 1);
  await clock.advance(1); assert.equal(p.workers.length, 2); assert.equal(worker.terminated, true);
  const next = p.workers.at(-1);
  // The replacement is isolated and initializes both control buffers.
  let seen = 0, finished = false;
  stopped.then(() => { finished = true; });
  while (!finished) {
    for (const message of next.posted.slice(seen)) {
      seen++;
      next.reply({type: 'result', id: message.id, value: true});
    }
    await W.tick();
  }
  await rejected;
});

test('the selected worker loading deadline terminates a stalled initialization with its documented code', async () => {
  const {p, clock} = page();
  const started = p.CTMWorker.start({loadTimeout: 25});
  const rejected = assert.rejects(started, error => error.code === 'pyodide-timeout');
  const worker = p.workers[0];
  await clock.advance(24); assert.equal(worker.terminated, false);
  worker.reply({type: 'status', text: 'still loading'});
  await clock.advance(1); await rejected;
  assert.equal(worker.terminated, true);
  worker.reply({type: 'result', id: worker.posted[0].id, value: true});
  assert.equal(p.mainPyodide, undefined);
});

test('invalid loading deadlines reject before a Worker is created', async () => {
  const {p} = page();
  for (const loadTimeout of [0, -1, NaN, Infinity, 2147483648, '25']) {
    await assert.rejects(p.CTMWorker.start({loadTimeout}), error => error.name === 'TypeError' && /loadTimeout/.test(error.message));
    assert.equal(p.workers.length, 0);
  }
});

test('successful initialization cancels its loading deadline and leaves later calls usable', async () => {
  const {p, clock} = page();
  const {proxy, worker} = await ready(p, {loadTimeout: 25});
  await clock.advance(100);
  assert.equal(worker.terminated, false);
  const call = proxy.runPythonAsync('2+2');
  worker.reply({type: 'result', id: worker.posted.at(-1).id, value: 4});
  assert.equal(await call, 4);
  assert.equal(p.workers.length, 1);
});

test('whenSlow and canStop use the requested runtime rather than the published one', async () => {
  const {p, clock, R} = page();
  p.mainPyodide = {restart() {}};
  let calls = 0;
  const privateRuntime = {};
  const cancel = R.whenSlow(20, () => calls++, {runtime: privateRuntime});
  await clock.advance(20); assert.equal(calls, 0);
  assert.equal(R.canStop({runtime: privateRuntime}), false);
  privateRuntime.restart = () => {};
  await clock.advance(1000); assert.equal(calls, 1);
  cancel();
});
