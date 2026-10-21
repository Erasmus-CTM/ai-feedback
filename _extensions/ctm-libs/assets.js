// URL resolution for assets selected by Lua. Consumers in blob workers receive
// these already absolute URLs from the page; a blob URL is never their base.
(function (root) {
  'use strict';
  root.CTMAssets = {
    url: function (name, path) {
      var config = root.CTM_ASSETS;
      if (!config || config.v !== 1 || !config.bases || typeof config.bases[name] !== 'string') {
        throw new Error('CTM assets: unknown asset ' + name);
      }
      path = path == null ? '' : path;
      if (typeof path !== 'string' || /^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(path) ||
          /(?:^|[\/\\])\.\.(?:[\/\\]|$)/.test(path) || /[?#\\\x00-\x1f\x7f]/.test(path) || /%(?:2e|2f|5c)/i.test(path)) {
        throw new Error('CTM assets: path must stay inside the selected asset');
      }
      var base = new URL(config.bases[name], document.baseURI).href;
      var resolved = new URL(path, base).href;
      if (!resolved.startsWith(base)) throw new Error('CTM assets: path must stay inside the selected asset');
      return resolved;
    }
  };
})(globalThis);
