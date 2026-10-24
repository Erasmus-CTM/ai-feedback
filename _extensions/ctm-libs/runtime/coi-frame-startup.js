// Optional opaque-frame worker permission. This dependency starts no Python,
// MathJax or worker and is emitted only with the matching flagged pre-loader.
(function (root) {
  'use strict';
  if (root.CTMCoiFrameStartup) return;
  root.CTMCoiFrameStartup = true;
  const protocol = 'ctm-coi-frame-startup', version = 1;
  // Head modules (including qpyodide's settlement promise) finish before DCL.
  // Neither child speech readiness nor window.load belongs to this barrier.
  const parsed = new Promise((resolve) => {
    if (document.readyState === 'complete') resolve();
    else document.addEventListener('DOMContentLoaded', resolve, {once: true});
  });
  const pending = new WeakMap();
  function liveFrame(source) {
    return Array.from(document.querySelectorAll('iframe')).find((frame) =>
      frame.isConnected && frame.contentWindow === source);
  }
  root.addEventListener('message', (event) => {
    const data = event.data, source = event.source;
    if (!source || !data || data.protocol !== protocol || data.version !== version || data.type !== 'request'
        || typeof data.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(data.nonce) || !liveFrame(source)) return;
    const existing = pending.get(source);
    if (existing) { existing.nonce = data.nonce; return; }
    const request = {nonce: data.nonce};
    pending.set(source, request);
    function reply(type) {
      pending.delete(source);
      // A request may outlive the frame that sent it. Never release a retired
      // frame; a newer document also requires its own matching nonce.
      if (!liveFrame(source)) return;
      source.postMessage({protocol, version, type, nonce: request.nonce}, '*');
    }
    parsed.then(() => root.CTMCoiSettled || root.qpyodideCoiSettled).then(() => reply('allow'), (error) => {
      console.error('CTM: frame worker startup decision failed', error);
      reply('error');
    });
  });
})(globalThis);
