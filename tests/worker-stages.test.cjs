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

function stages({net = {}, pyodide = () => ({}), background = BACKGROUND, packages = [], timing = {}, clock = null} = {}) {
  const network = W.fakeNet({packages: PACKAGES, ...net});
  const events = [], warnings = [];
  const console = {...globalThis.console, warn: (...args) => warnings.push(args.join(' '))};
  const timers = clock ? {setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, performance: clock.performance} : {};
  const w = W.workerContext({globals: {fetch: network.fetch, URL, AbortController, console, ...timers}, pyodide: (ctx, fake) => {
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
  return {w, network, events, warnings, setupMessage, init: () => w.init({background, packages, timing: {...TIMING, ...timing}})};
}
const wheels = log => log.filter(entry => entry.file.endsWith('.whl') && entry.method !== 'HEAD');

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
  // Short, for the status line: the package once, no URL; the console has the URL.
  assert.equal(s.setupMessage().message, 'matplotlib: no data for 100 ms');
  assert.equal(s.warnings.length, 1);
  assert.match(s.warnings[0], /could not download https:\/\/cdn\.example\/pyodide\/matplotlib-1\.0-py3-none-any\.whl .*3 tries/);
  const tries = wheels(s.network.log).filter(entry => entry.file.startsWith('matplotlib'));
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

test('m2: an HTTP error ends stage 2 with the package and the status only; the URL goes to the console', async () => {
  const s = stages({net: {status: {matplotlib: 404}}});
  await s.init();
  await W.waitFor(s.setupMessage, 5000, 'setup failure');
  assert.deepEqual(s.setupMessage(), {type: 'setup', ok: false, message: 'matplotlib: HTTP 404'});
  assert.equal(wheels(s.network.log).filter(entry => entry.file.startsWith('matplotlib')).length, 3, 'three tries');
  assert.match(s.warnings.join('\n'), /https:\/\/cdn\.example\/pyodide\/matplotlib-1\.0-py3-none-any\.whl.*HTTP 404/);
});

// S-a: on a virtual clock (W.fakeClock), so the times below are exact.
test('S-a: commands that never leave the quiet time postpone an install by the ceiling, no more; installs stay a ceiling apart', async () => {
  // A command every 10 ms against a 60 ms quiet time: without the ceiling no
  // install would start while they go on (the review's probe).
  const QUIET = 60, CEILING = 250, clock = W.fakeClock();
  const installs = [];
  const s = stages({clock, timing: {installQuiet: QUIET, installCeiling: CEILING}, pyodide: (ctx, fake, events) => ({
    loadPackage: async names => {
      for (const name of [].concat(names)) { installs.push(clock.now()); events.push('install ' + name); fake.loadedPackages[name] = 'default channel'; }
    },
    runPythonAsync: async code => { if (code === 'PATCH') installs.push(clock.now()); events.push('run ' + code); },
  })});
  await s.init();
  await clock.advance(0);                 // stage 2 starts; every range arrives at t = 0
  assert.equal(wheels(s.network.log).filter(entry => entry.done).length, 14, 'every range (14) fetched at t = 0');
  let id = 100;
  while (!s.setupMessage() && clock.now() < 5000) {
    await s.w.send({id: id++, type: 'runPython', code: 'POLL'});
    await clock.advance(10);
  }
  assert.deepEqual(s.setupMessage(), {type: 'setup', ok: true}, 'stage 2 finished while the commands went on');
  // Six installs and the patch, each when its wait reached the ceiling: the
  // first 250 ms after the downloads, each next 250 ms after the one before.
  // No window shorter than the ceiling holds two, so a check shorter than
  // that meets at most one.
  assert.deepEqual(installs, [1, 2, 3, 4, 5, 6, 7].map(k => k * CEILING));
  assert.ok(s.events.indexOf('install pyodide-http') > 0 && s.events[0] === 'run POLL', 'the commands went first');
  assert.ok(s.w.results().every(m => m.type === 'result'), 'every command answered');
});

test('S-a: an install past its ceiling still waits until nothing is queued or running', async () => {
  // Two long commands; the ceiling passes during the first. When it ends the
  // second is still queued, so the install waits; a command arriving while
  // the second runs goes before the install too.
  const QUIET = 60, CEILING = 250, clock = W.fakeClock();
  const release = {};
  const s = stages({clock, timing: {installQuiet: QUIET, installCeiling: CEILING}, pyodide: (ctx, fake, events) => ({
    runPythonAsync: async code => {
      events.push('run ' + code);
      if (code.startsWith('LONG')) await new Promise(resolve => { release[code] = resolve; });
      events.push('ran ' + code);
    },
  })});
  await s.init();
  const first = s.w.send({id: 70, type: 'runPython', code: 'LONG1'});
  const second = s.w.send({id: 71, type: 'runPython', code: 'LONG2'});
  await clock.advance(0);                 // stage 2 starts; the ranges arrive (runPython does not pause them)
  await clock.advance(2 * CEILING);       // the first install's ceiling has passed
  assert.ok(!s.events.some(event => event.startsWith('install ')), 'no install while a command runs');
  release.LONG1();
  await first;
  await clock.settle();
  assert.ok(!s.events.some(event => event.startsWith('install ')), 'none while the second is queued');
  assert.deepEqual(s.events.slice(-1), ['run LONG2']);
  const third = s.w.send({id: 72, type: 'runPython', code: 'SHORT'});
  await clock.settle();
  release.LONG2();
  await Promise.all([second, third]);
  await clock.settle();
  const order = s.events.filter(event => /^(ran |run SHORT|install )/.test(event));
  assert.deepEqual(order.slice(0, 4), ['ran LONG1', 'ran LONG2', 'run SHORT', 'ran SHORT']);
  assert.equal(order[4], 'install pyodide-http', 'the install right after the queue empties');
  await clock.advance(10 * CEILING);
  assert.deepEqual(s.setupMessage(), {type: 'setup', ok: true});
});

test('a failed install (Pyodide reports it and does not reject) ends stage 2 with the package and Pyodide\'s reason, file names for URLs', async () => {
  const s = stages({pyodide: (ctx, fake, events) => ({
    loadPackage: async (names, options = {}) => {
      for (const name of [].concat(names)) {
        events.push('install ' + name);
        if (name === 'matplotlib') {
          options.errorCallback?.("Failed to load 'https://cdn.example/pyodide/matplotlib-1.0-py3-none-any.whl': request failed.");
          options.errorCallback?.('The following error occurred while loading matplotlib:');
          continue;   // as Pyodide 0.28: no rejection, the package is not loaded
        }
        fake.loadedPackages[name] = 'default channel';
      }
    },
  })});
  await s.init();
  await W.waitFor(s.setupMessage, 5000, 'setup');
  assert.deepEqual(s.setupMessage(), {type: 'setup', ok: false, message: "matplotlib: Failed to load 'matplotlib-1.0-py3-none-any.whl': request failed."});
  assert.ok(!s.events.includes('run PATCH'), 'the patch does not run after a failed install');
  assert.match(s.warnings.join('\n'), /could not install matplotlib: Failed to load 'https:\/\/cdn\.example\/pyodide\/matplotlib-1\.0-py3-none-any\.whl'/);
});

test('installs take the verified prefetched bytes (no request); a wheel that does not verify is fetched by loadPackage', async () => {
  const crypto = require('node:crypto');
  const s = stages({pyodide: (ctx, fake, events) => ({
    // As Pyodide 0.28 in a browser: fetch(new URL(file), {integrity}).
    loadPackage: async names => {
      for (const name of [].concat(names)) {
        const response = await ctx.fetch(new URL(name + '-1.0-py3-none-any.whl', 'https://cdn.example/pyodide/'), {integrity: 'sha256-x'});
        events.push('install ' + name + ' ' + (await response.arrayBuffer()).byteLength);
        fake.loadedPackages[name] = 'default channel';
      }
    },
  })});
  // The fake wheels are zeros of their size: give all but matplotlib their real SHA-256.
  for (const [name, entry] of Object.entries(s.network.lockJSON.packages)) {
    if (name !== 'matplotlib') entry.sha256 = crypto.createHash('sha256').update(Buffer.alloc({'pyodide-http': 1500, micropip: 900, packaging: 700, numpy: 2600, cycler: 300, sympy: 1800, mpmath: 400}[name] || 0)).digest('hex');
  }
  s.w.context.Response = Response;
  s.w.context.crypto = globalThis.crypto;
  const kept = new Map();
  s.w.context.caches = {open: async () => ({match: async url => kept.get(url), put: async (url, response) => { kept.set(url, response); }})};
  s.w.ctx.fetch = (...args) => s.w.context.fetch(...args);
  await s.init();
  await W.waitFor(s.setupMessage, 5000, 'setup');
  assert.deepEqual(s.setupMessage(), {type: 'setup', ok: true});
  const full = s.network.log.filter(entry => entry.file.endsWith('.whl') && entry.method !== 'HEAD' && !entry.range).map(entry => entry.file);
  assert.deepEqual(full, ['matplotlib-1.0-py3-none-any.whl'], 'only the wheel that did not verify was requested again');
  assert.ok(s.events.includes('install numpy 2600'), s.events.join(', '));
  assert.ok(s.network.log.filter(entry => entry.range).every(entry => entry.cache === 'no-store'), 'the prefetch bypasses the HTTP cache');
  assert.equal(kept.size, 5, 'the five verified wheels of the closure are kept for the next page');
});

test('S2 (set review): without crypto.subtle or the Cache Storage (a plain-HTTP origin) the prefetch fills the HTTP cache, as before', async () => {
  const s = stages();
  await s.init();
  await W.waitFor(s.setupMessage, 5000, 'setup');
  assert.equal(s.setupMessage().ok, true);
  const ranges = s.network.log.filter(entry => entry.range);
  assert.ok(ranges.length > 0 && ranges.every(entry => entry.cache === undefined), 'no cache: no-store');
});
