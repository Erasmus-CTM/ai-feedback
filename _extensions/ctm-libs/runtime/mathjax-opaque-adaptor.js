// Load before the original MathJax 4 browser component. This file configures
// MathJax; it deliberately neither loads nor replaces the vendor script.
// Activation in JSXGraph is gated on a supported pre-loader hook.
(function () {
  'use strict';
  if (self.origin !== 'null') return;
  const config = window.MathJax || {};
  const startup = config.startup || {};
  // Authored startup code/adaptors own their lifecycle and transport. Leave
  // their configuration intact rather than silently replacing that behavior.
  if (startup.ready !== undefined ||
      (startup.adaptor != null && startup.adaptor !== 'browserAdaptor')) return;
  // Only the package producer that also emits the parent coordinator sets
  // this capability. Plain/custom standalone pre-loaders keep native timing.
  const coi = window.CTM_COI_FRAME_STARTUP;
  let permission;
  function parentPermission() {
    if (permission) return permission;
    if (coi.protocol !== 'ctm-coi-frame-startup' || coi.version !== 1
        || !window.parent || window.parent === window) throw new Error('Invalid CTM frame startup capability');
    const parent = window.parent;
    const nonce = Array.from(crypto.getRandomValues(new Uint32Array(4)),
      (value) => value.toString(16).padStart(8, '0')).join('');
    permission = new Promise((resolve, reject) => {
      function receive(event) {
        const data = event.data;
        if (event.source !== parent || !data || data.protocol !== coi.protocol
            || data.version !== coi.version || data.nonce !== nonce
            || (data.type !== 'allow' && data.type !== 'error')) return;
        window.removeEventListener('message', receive);
        if (data.type === 'allow') resolve();
        else reject(new Error('CTM frame worker startup decision failed'));
      }
      window.addEventListener('message', receive);
      parent.postMessage({protocol: coi.protocol, version: coi.version, type: 'request', nonce}, '*');
    });
    return permission;
  }
  config.startup = Object.assign({}, startup, {
    ready() {
      // Another component can select an adaptor after this pre-loader ran.
      if (MathJax.config.startup.adaptor !== 'browserAdaptor') {
        return MathJax.startup.defaultReady();
      }
      const browserAdaptor = MathJax.startup.constructors.browserAdaptor;
      const originalBrowserAdaptor = MathJax._?.adaptors?.browserAdaptor?.browserAdaptor;
      if (!originalBrowserAdaptor || browserAdaptor !== originalBrowserAdaptor) {
        return MathJax.startup.defaultReady();
      }
      MathJax.startup.registerConstructor('ctmOpaqueWorkerAdaptor', function () {
        const adaptor = browserAdaptor(MathJax.config.browserAdaptor);
        adaptor.createWorker = async function (listener, options) {
          if (coi) await parentPermission();
          const file = options.path + '/' + options.worker;
          // Serialize configuration as data: no supplied value is executable
          // source. This runs MathJax's original SRE worker and mathmaps.
          const source = 'self.maps = ' + JSON.stringify(options.maps) +
            '; importScripts(' + JSON.stringify(file) + ');';
          const worker = new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(source));
          worker.onmessage = listener;
          return worker;
        };
        return adaptor;
      });
      MathJax.startup.useAdaptor('ctmOpaqueWorkerAdaptor', true);
      return MathJax.startup.defaultReady();
    }
  });
  window.MathJax = config;
})();
