// D2 (step-3 design §18.5): CTMWorker's two start-up stages with a fake
// Pyodide and a fake network. Stage 2 fetches the background packages in byte
// ranges outside Pyodide's package lock, pauses while a command may download,
// installs one package at a time only while nothing else runs, and fails
// after three stalled tries without stopping the commands. The same in a
// real browser: tests/browser/worker.mjs.
const test = require('node:test'), assert = require('node:assert/strict');
const W = require('./helpers/worker.cjs');

const PACKAGES = {
  'pyodide-http': {size: 1500},
  micropip: {size: 900, depends: ['packaging']},
  packaging: {size: 700},
  numpy: {size: 2600},
  matplotlib: {size: 5200, depends: ['numpy', 'cycler']},
  cycler: {size: 300},
  sympy: {size: 1800, depends: ['mpmath']},
  mpmath: {size: 400},
};
const BACKGROUND = {packages: ['pyodide_http', 'micropip', 'matplotlib'], run: 'PATCH'};
// Fast limits: 1 KB ranges, 50 ms of quiet after a download, a 100 ms stall,
// retries after 20 and 40 ms, 40 ms of quiet after any command before an install.
const TIMING = {range: 1024, resumeAfter: 50, stall: 100, retryAfter: [20, 40], slowInstall: 10000, installQuiet: 40};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function stages({net = {}, pyodide = () => ({}), background = BACKGROUND, packages = []} = {}) {
  const network = W.fakeNet({packages: PACKAGES, ...net});
  const events = [];
  const w = W.workerContext({globals: {fetch: network.fetch, URL, AbortController}, pyodide: (ctx, fake) => {
    const own = pyodide(ctx, fake, events);
    return {
      ...own,
      loadPackage: own.loadPackage || (async names => {
        for (const name of [].concat(names)) { events.push('install ' + name); fake.loadedPackages[name] = 'default channel'; }
      }),
      runPythonAsync: own.runPythonAsync || (async code => { events.push('run ' + code); }),
      code: {find_imports: code => ({toJs: () => code.split(/\s+/).filter(Boolean), destroy() {}})},
    };
  }});
  const setupMessage = () => w.messages.find(m => m.type === 'setup');
  return {w, network, events, setupMessage, init: () => w.init({background, packages, timing: TIMING})};
}
const wheels = log => log.filter(entry => entry.file.endsWith('.whl'));

test('stage 1 is ready before any background download; stage 2 prefetches every range, then installs in dependency order', async () => {
  const s = stages();
  await s.init();
  assert.equal(s.w.result(0).type, 'result');
  assert.equal(wheels(s.network.log).length, 0, 'nothing of stage 2 before the answer to init');
  await W.waitFor(s.setupMessage, 5000, 'setup');
  assert.deepEqual(s.setupMessage(), {type: 'setup', ok: true});
  // Every byte of every file, in ranges of 1 KB, the first range of each file first.
  const files = Object.fromEntries(['pyodide-http', 'packaging', 'micropip', 'numpy', 'cycler', 'matplotlib'].map(name => [name + '-1.0-py3-none-any.whl', PACKAGES[name].size]));
  const requested = wheels(s.network.log);
  for (const [file, size] of Object.entries(files)) {
    const ranges = requested.filter(entry => entry.file === file).map(entry => entry.range);
    const expected = [];
    for (let from = 0; from < size; from += 1024) expected.push('bytes=' + from + '-' + (from + 1023));
    assert.deepEqual(ranges, expected, file);
  }
  assert.deepEqual(requested.slice(0, 6).map(entry => entry.range), Array(6).fill('bytes=0-1023'), 'the first range of every file first');
  // After the first ranges, the files left go smallest first (numpy before matplotlib).
  const rest = requested.slice(6).map(entry => entry.file);
  assert.ok(rest.lastIndexOf('numpy-1.0-py3-none-any.whl') < rest.indexOf('matplotlib-1.0-py3-none-any.whl'));
  assert.deepEqual(s.events, ['install pyodide-http', 'install packaging', 'install micropip', 'install numpy', 'install cycler', 'install matplotlib', 'run PATCH']);
});

test('a download command pauses the prefetch; other commands do not; the prefetch resumes after the quiet time', async () => {
  const s = stages({net: {hold: true}});
  await s.init();
  await W.waitFor(() => s.network.held.length === 1, 2000, 'first range');
  // runPython and setGlobal: no pause.
  await s.w.send({id: 1, type: 'runPython', code: 'x = 1'});
  await s.w.send({id: 2, type: 'setGlobal', name: 'y', value: 2});
  s.network.release();
  await W.waitFor(() => s.network.held.length === 1, 2000, 'second range');
  // A check's loadPackage: it runs at once (the range in flight is no Python),
  // and no new range starts until it has ended and the quiet time has passed.
  let checkDone = false;
  const check = s.w.send({id: 3, type: 'loadPackage', name: 'sympy'}).then(() => { checkDone = true; });
  const before = s.network.log.length;
  s.network.release();
  await check;
  assert.ok(checkDone);
  assert.ok(s.events.includes('install sympy'));
  const ended = performance.now();
  await W.waitFor(() => s.network.log.length > before, 2000, 'prefetch resumes');
  assert.ok(performance.now() - ended >= 45, 'resumed after the quiet time');
  for (;;) { if (!s.network.release() && s.setupMessage()) break; await new Promise(r => setTimeout(r, 2)); }
  assert.equal(s.setupMessage().ok, true);
});

test('installs wait until nothing is queued or running; a command during an install waits for that one install only', async () => {
  let releaseInstall = null;
  const installing = [];
  const s = stages({pyodide: (ctx, fake, events) => ({
    loadPackage: async names => {
      for (const name of [].concat(names)) {
        if (name === 'numpy') { installing.push(name); await new Promise(resolve => { releaseInstall = resolve; }); }
        events.push('install ' + name); fake.loadedPackages[name] = 'default channel';
      }
    },
  })});
  await s.init();
  await W.waitFor(() => releaseInstall, 5000, 'numpy install');
  // A check arrives during numpy's install: it runs right after numpy, before cycler.
  const check = s.w.send({id: 7, type: 'runPython', code: 'CHECK'});
  await W.tick();
  assert.ok(!s.events.includes('run CHECK'));
  releaseInstall();
  await check;
  await W.waitFor(s.setupMessage, 5000, 'setup');
  const order = s.events.filter(event => /numpy|CHECK|cycler/.test(event));
  assert.deepEqual(order, ['install numpy', 'run CHECK', 'install cycler']);
});

test('a stalled download is tried three times; then stage 2 fails, commands keep working, and a retry does only what is missing', async () => {
  const s = stages({net: {stall: ['matplotlib']}});
  await s.init();
  await W.waitFor(s.setupMessage, 5000, 'setup failure');
  assert.equal(s.setupMessage().ok, false);
  assert.match(s.setupMessage().message, /download failed: matplotlib-1\.0-py3-none-any\.whl/);
  const tries = s.network.log.filter(entry => entry.file.startsWith('matplotlib'));
  assert.equal(tries.length, 3);
  assert.ok(tries.every(entry => entry.aborted));
  assert.deepEqual(s.events, [], 'nothing installed before every file is fetched');
  await s.w.send({id: 5, type: 'runPython', code: 'STILL'});
  assert.equal(s.w.result(5).type, 'result');
  // Retry with the network back: the remaining files only (the smaller ones are cached).
  s.network.log.length = 0;
  s.w.messages.length = 0;
  await s.w.send({type: 'setupRetry'});
  await W.waitFor(() => s.network.log.some(entry => entry.file.startsWith('matplotlib')), 2000, 'retry');
});

test('without the lock file there is nothing to prefetch: the installs follow one by one', async () => {
  const s = stages({net: {lock: false}});
  await s.init();
  await W.waitFor(s.setupMessage, 5000, 'setup');
  assert.equal(s.setupMessage().ok, true);
  assert.equal(wheels(s.network.log).length, 0);
  assert.deepEqual(s.events, ['install pyodide-http', 'install micropip', 'install matplotlib', 'run PATCH']);
});

test('Content-Range not exposed (CORS): the ranges go on until a short one or 416', async () => {
  const s = stages({net: {exposeRange: false}});
  await s.init();
  await W.waitFor(s.setupMessage, 5000, 'setup');
  const matplotlib = wheels(s.network.log).filter(entry => entry.file.startsWith('matplotlib')).map(entry => entry.range);
  assert.deepEqual(matplotlib, ['bytes=0-1023', 'bytes=1024-2047', 'bytes=2048-3071', 'bytes=3072-4095', 'bytes=4096-5119', 'bytes=5120-6143']);
  const numpy = wheels(s.network.log).filter(entry => entry.file.startsWith('numpy')).map(entry => entry.range);
  assert.deepEqual(numpy, ['bytes=0-1023', 'bytes=1024-2047', 'bytes=2048-3071']);
});

test('packages already loaded in stage 1 (pyodide: packages) are left out of stage 2; no background, no stage 2', async () => {
  const s = stages({pyodide: (ctx, fake) => { fake.loadedPackages.micropip = 'default channel'; fake.loadedPackages.packaging = 'default channel'; return {}; }});
  await s.init();
  await W.waitFor(s.setupMessage, 5000, 'setup');
  assert.ok(!wheels(s.network.log).some(entry => /^(micropip|packaging)-/.test(entry.file)));
  assert.ok(!s.events.includes('install micropip'));
  const none = stages({background: {}});
  await none.init();
  await W.waitFor(none.setupMessage, 5000, 'setup');
  assert.equal(none.setupMessage().ok, true);
  assert.equal(none.network.log.length, 0);
});

test('may-download: loadPackagesFromImports counts only for a package not yet loaded', async () => {
  const s = stages({net: {hold: true}});
  await s.init();
  await W.waitFor(() => s.network.held.length === 1, 2000, 'first range');
  // A module of a loaded package: no pause (the next range starts at once).
  await s.w.send({id: 11, type: 'loadPackage', name: 'cycler'});   // loads cycler (a download)
  await new Promise(resolve => setTimeout(resolve, 80));          // quiet time over
  s.network.release();
  await W.waitFor(() => s.network.held.length === 1, 2000, 'next range');
  const before = s.network.log.length;
  await s.w.send({id: 12, type: 'loadPackagesFromImports', code: 'cycler'});
  s.network.release();
  await W.waitFor(() => s.network.log.length > before, 200, 'no pause for a loaded package');
  for (;;) { if (!s.network.release() && s.setupMessage()) break; await new Promise(r => setTimeout(r, 2)); }
});

test('stage 1 with pyodide: packages: micropip is loaded before its packages, both before the answer to init; stage 2 leaves micropip out', async () => {
  const s = stages({packages: ['shapely'], pyodide: (ctx, fake, events) => ({
    pyimport: name => {
      events.push('pyimport ' + name);
      if (!fake.loadedPackages[name]) throw new Error('No module named ' + name);
      return {install: async names => { events.push('micropip.install ' + [].concat(names).join(',')); }, destroy() {}};
    },
  })});
  await s.init();
  assert.equal(s.w.result(0).type, 'result', s.w.result(0).message);
  assert.deepEqual(s.events, ['install micropip', 'pyimport micropip', 'micropip.install shapely'], 'stage 1, before init answers');
  await W.waitFor(s.setupMessage, 5000, 'setup');
  assert.equal(s.setupMessage().ok, true);
  assert.ok(!wheels(s.network.log).some(entry => entry.file.startsWith('micropip-')), 'micropip is not fetched again');
  assert.equal(s.events.filter(event => event === 'install micropip').length, 1);
});

test('S2: loadPackagesFromImports of a package not yet loaded pauses the prefetch until it ends and the quiet time has passed', async () => {
  let finish = null;
  const s = stages({net: {hold: true}, pyodide: (ctx, fake, events) => ({
    loadPackagesFromImports: () => new Promise(resolve => { finish = () => { events.push('imports loaded'); resolve(); }; }),
  })});
  await s.init();
  await W.waitFor(() => s.network.held.length === 1, 2000, 'first range');
  const check = s.w.send({id: 40, type: 'loadPackagesFromImports', code: 'sympy'});
  await W.tick();
  const before = s.network.log.length;
  s.network.release();                      // the range in flight ends
  await sleep(150);                         // three times the quiet time
  assert.equal(s.network.log.length, before, 'no new range while the check may download');
  finish();
  await check;
  const ended = performance.now();
  await W.waitFor(() => s.network.log.length > before, 2000, 'prefetch resumes');
  assert.ok(performance.now() - ended >= 45, 'resumed after the quiet time');
  for (;;) { if (!s.network.release() && s.setupMessage()) break; await sleep(2); }
  assert.equal(s.setupMessage().ok, true);
});

test('S2: an install never jumps the queue: a command queued behind a running one goes before it', async () => {
  let release = null;
  const s = stages({pyodide: (ctx, fake, events) => ({
    runPythonAsync: async code => {
      events.push('run ' + code);
      if (code === 'LONG') await new Promise(resolve => { release = resolve; });
      events.push('ran ' + code);
    },
  })});
  await s.init();
  const long = s.w.send({id: 50, type: 'runPython', code: 'LONG'});
  // runPython does not pause the prefetch: every range arrives meanwhile.
  const ranges = Object.values({h: 1500, pa: 700, mi: 900, nu: 2600, cy: 300, ma: 5200}).reduce((n, size) => n + Math.ceil(size / 1024), 0);
  await W.waitFor(() => wheels(s.network.log).filter(entry => entry.done).length === ranges, 5000, 'every range');
  await sleep(100);                          // longer than the install quiet time
  const next = s.w.send({id: 51, type: 'runPython', code: 'NEXT'});
  await W.tick();
  release();
  await Promise.all([long, next]);
  await W.waitFor(s.setupMessage, 5000, 'setup');
  const order = s.events.filter(event => /^(ran LONG|run NEXT|install )/.test(event));
  assert.deepEqual(order.slice(0, 3), ['ran LONG', 'run NEXT', 'install pyodide-http']);
});

test('S1: a check of several calls in a row meets at most one install, not one between each of its calls', async () => {
  const s = stages({pyodide: (ctx, fake, events) => ({
    loadPackage: async names => {
      for (const name of [].concat(names)) {
        events.push('install ' + name);
        await sleep(15);
        fake.loadedPackages[name] = 'default channel';
      }
    },
  })});
  await s.init();
  await W.waitFor(() => s.events.includes('install pyodide-http'), 5000, 'the installs have begun');
  // A check: four round trips from the page, a few ms apart.
  const start = s.events.length;
  for (let i = 0; i < 4; i++) {
    await s.w.send({id: 60 + i, type: 'runPython', code: 'CHECK' + i});
    await sleep(5);
  }
  const during = s.events.slice(start, s.events.lastIndexOf('run CHECK3')).filter(event => event.startsWith('install '));
  assert.ok(during.length <= 1, 'installs between the check\'s calls: ' + during.join(', '));
  await W.waitFor(s.setupMessage, 5000, 'setup');
  assert.equal(s.setupMessage().ok, true);
  assert.equal(s.events.filter(event => event.startsWith('install ')).length, 6, 'stage 2 still installs everything');
});
