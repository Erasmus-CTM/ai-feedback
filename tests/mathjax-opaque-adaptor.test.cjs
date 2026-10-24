'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,
  '../_extensions/ctm-libs/runtime/mathjax-opaque-adaptor.js'), 'utf8');

function preloader(origin, config) {
  const context = vm.createContext({self: {origin}, window: {MathJax: config}});
  vm.runInContext(source, context);
  return context;
}

test('ordinary origins retain their original config and native startup', () => {
  for (const origin of ['https://example.test', 'http://localhost:8000']) {
    const config = {startup: {typeset: false}};
    assert.equal(preloader(origin, config).window.MathJax, config);
    assert.deepEqual(config, {startup: {typeset: false}});
  }
});

test('opaque contexts preserve authored ready functions and selected adaptors', () => {
  const ready = function () { return this.marker; };
  for (const startup of [{ready, marker: 17}, {adaptor: 'custom'}, {adaptor: 'none'}]) {
    const config = {startup};
    assert.equal(preloader('null', config).window.MathJax, config);
    assert.equal(config.startup, startup);
    if (startup.ready) assert.equal(config.startup.ready(), 17);
  }
});

test('data transport preserves the original worker path, maps and listener', async () => {
  const config = {startup: {typeset: false}, browserAdaptor: {custom: 7},
    options: {enableSpeech: true, enableBraille: true}};
  const context = preloader('null', config);
  const workerURLs = [];
  const nativeAdaptor = {kind: 'original DOM adaptor'};
  let factoryOptions, selected, readyCalls = 0, factory;
  config.startup.adaptor = 'browserAdaptor';
  const browserAdaptor = options => { factoryOptions = options; return nativeAdaptor; };
  context.MathJax = {config, _: {adaptors: {browserAdaptor: {browserAdaptor}}}, startup: {
    constructors: {browserAdaptor},
    registerConstructor(name, value) { assert.equal(name, 'ctmOpaqueWorkerAdaptor'); factory = value; },
    useAdaptor(name, force) { selected = [name, force]; },
    defaultReady() { readyCalls++; return 'native ready result'; }
  }};
  context.Worker = class {
    constructor(url) { workerURLs.push(url); }
  };
  assert.equal(config.startup.ready(), 'native ready result');
  assert.equal(readyCalls, 1);
  assert.deepEqual(selected, ['ctmOpaqueWorkerAdaptor', true]);
  const adaptor = factory();
  assert.equal(adaptor, nativeAdaptor);
  assert.equal(factoryOptions, config.browserAdaptor);
  const options = {path: "https://assets.test/mathjax@4.1.3/sre/quoted'\n\u2028",
    worker: 'speech-worker.js?x="value"', maps: "https://assets.test/maps/\\'\n\u2029"};
  const listener = () => {};
  const worker = await adaptor.createWorker(listener, options);
  assert.equal(worker.onmessage, listener);
  assert.equal(workerURLs.length, 1);
  assert.match(workerURLs[0], /^data:text\/javascript;charset=utf-8,/);
  const imports = [], scope = {self: {}, importScripts(value) { imports.push(value); }};
  vm.runInNewContext(decodeURIComponent(workerURLs[0].split(',')[1]), scope);
  assert.equal(scope.self.maps, options.maps);
  assert.deepEqual(imports, [options.path + '/' + options.worker]);
  assert.deepEqual(config.options, {enableSpeech: true, enableBraille: true});
});

test('a later component selection retains its own adaptor', () => {
  const context = preloader('null', {});
  const config = context.window.MathJax;
  config.startup.adaptor = 'selected-later';
  let readyCalls = 0;
  context.MathJax = {config, startup: {
    defaultReady() { readyCalls++; return 23; },
    registerConstructor() { assert.fail('must preserve the selected adaptor'); }
  }};
  assert.equal(config.startup.ready(), 23);
  assert.equal(readyCalls, 1);
});

test('a replacement browser adaptor factory remains in control', () => {
  const context = preloader('null', {});
  const config = context.window.MathJax;
  config.startup.adaptor = 'browserAdaptor';
  let readyCalls = 0;
  context.MathJax = {config,
    _: {adaptors: {browserAdaptor: {browserAdaptor() {}}}},
    startup: {constructors: {browserAdaptor() {}},
      defaultReady() { readyCalls++; return 31; },
      registerConstructor() { assert.fail('must preserve the replacement factory'); }}
  };
  assert.equal(config.startup.ready(), 31);
  assert.equal(readyCalls, 1);
});
