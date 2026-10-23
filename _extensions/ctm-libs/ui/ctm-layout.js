/* Shared CTM layout lifecycle (ctm-libs) — AGPL-3.0-or-later. */
(function (root) {
  'use strict';
  if (root.CTMLayout) return;

  // Shared UI may initialize once its build-time content has been parsed.
  // Do this before deferred modules install DOMContentLoaded observers.
  var parsed = false, waiting = [], parserObserver = null;
  function contentParsed() {
    if (document.getElementById('ctm-layout-ready')) return true;
    var manifest = document.getElementById('ctm-store-manifest');
    if (!manifest) return false;
    try { JSON.parse(manifest.textContent); return true; } catch (error) { return false; }
  }
  function release(force) {
    if (parsed || (!force && !contentParsed())) return;
    parsed = true;
    if (parserObserver) parserObserver.disconnect();
    waiting.splice(0).forEach(function (callback) { root.queueMicrotask(callback); });
  }
  function ready(callback) {
    if (typeof callback !== 'function') throw new TypeError('CTMLayout.ready needs a function');
    if (parsed || document.readyState !== 'loading') { root.queueMicrotask(callback); return; }
    waiting.push(callback);
    if (!parserObserver && typeof root.MutationObserver === 'function') {
      parserObserver = new root.MutationObserver(function () { release(false); });
      parserObserver.observe(document, {childList: true, subtree: true});
    }
    release(false);
  }
  document.addEventListener('DOMContentLoaded', function () { release(true); }, {once: true});

  // One pending rendering-phase task. Notifications update captured state;
  // they never perform layout inside native ResizeObserver delivery.
  function task(callback) {
    var pending = null, disposed = false;
    return {
      schedule: function () {
        if (disposed || pending !== null) return;
        pending = root.requestAnimationFrame(function () {
          pending = null;
          if (!disposed) callback();
        });
      },
      dispose: function () {
        disposed = true;
        if (pending !== null) root.cancelAnimationFrame(pending);
        pending = null;
      }
    };
  }

  // Supported Monaco explicit-layout integration. Components retain editor
  // options/model ownership; this owns only fitting and resize observation.
  function fitEditor(editor, container, options) {
    options = options || {};
    var minimum = options.minHeight || 0, box = null, disposed = false;
    var pending = task(function () {
      var height = Math.max(minimum, editor.getContentHeight()) + 'px';
      if (container.style.height !== height) container.style.height = height;
      // A height write gets a fresh content box from the native observer.
      // Retain the latest supplied fractional/untransformed box semantics.
      if (box) editor.layout({width: Math.max(5, box.width), height: Math.max(5, box.height)});
      else if (!observer) editor.layout();
    });
    var observer = typeof root.ResizeObserver === 'function' ? new root.ResizeObserver(function (entries) {
      if (disposed) return;
      for (var i = 0; i < entries.length; i++) if (entries[i].target === container) {
        box = {width: entries[i].contentRect.width, height: entries[i].contentRect.height};
      }
      pending.schedule();
    }) : null;
    var content = editor.onDidContentSizeChange(function () { pending.schedule(); });
    function onResize() { pending.schedule(); }
    if (observer) observer.observe(container);
    else root.addEventListener('resize', onResize);
    var disposal = typeof editor.onDidDispose === 'function' ? editor.onDidDispose(dispose) : null;
    function dispose() {
      if (disposed) return;
      disposed = true;
      pending.dispose();
      if (observer) observer.disconnect();
      else root.removeEventListener('resize', onResize);
      if (content) content.dispose();
      if (disposal) disposal.dispose();
    }
    pending.schedule();
    return {request: function () { pending.schedule(); }, dispose: dispose};
  }

  root.CTMLayout = {version: 1, ready: ready, task: task, fitEditor: fitEditor};
})(window);
