/* CTM Assessment: links into tabs and reveals (ctm-libs) — AGPL-3.0-or-later.
 * The courses' tab-links.html, moved here and extended (AC, 19 Oct 2026).
 * Loaded on pages with a tabset or a reveal unless ctm-assessment:
 * tab-links: false (lua/ui.lua).
 *
 * A link to an id inside tabs or closed <details> (a heading, an anchor, an
 * exercise, a tab title's .ctm-tab-target) opens every enclosing tab, nested
 * ones too, and every enclosing <details>; then it scrolls the target below
 * the header and focuses it. This works for links in the page (the address
 * bar shows the id: pushState), links from other pages, Back/Forward and
 * reloads. It runs after Quarto's own handlers: a link wins over the tab a
 * grouped tabset remembers, for this view, without changing what it
 * remembers. While editors, boards and Python output change the layout above
 * the target, it stays in place, for 2 s at most or until the reader scrolls,
 * types or clicks.
 *
 * Focus: a tab title's target focuses its tab panel, or the panel's first
 * heading when that is in view (the tab row stays visible); a section's
 * heading, a <details>' summary, or else the target itself (tabindex -1 while
 * focused). Each history entry keeps its scroll position and open tabs in
 * history.state.__quartoTabPosition, as the courses' script did.
 *
 * CTMNav.reveal(element): the same for any element (returns a promise).
 * A handled target gets data-ctm-nav (load, link, hash, history or api).
 */
(function () {
  'use strict';
  if (window.CTMNav) return;
  var KEY = '__quartoTabPosition';
  var PIN_MS = 2000;
  var STOP_PIN = ['wheel', 'touchstart', 'keydown', 'mousedown'];
  var FOCUSABLE = 'a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable]';
  var navigation = 0, restoring = false, scrollTimer = 0, handledURL = location.href, pinned = null;
  try { history.scrollRestoration = 'manual'; } catch (error) { /* older browsers: the browser restores */ }

  // The next frame, or 100 ms where frames come slowly or not at all (a
  // page in the background, a slow renderer).
  function frame() {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () { if (!done) { done = true; resolve(); } };
      requestAnimationFrame(finish);
      setTimeout(finish, 100);
    });
  }
  function each(list, visit) { Array.prototype.forEach.call(list, visit); }

  // One page under its URLs: quarto-nav.js rewrites links to …/index.html as
  // …/, and GitHub Pages serves x.html also as x.
  function samePage(url) {
    var page = function (pathname) { return pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, ''); };
    return url.origin === location.origin && url.search === location.search && page(url.pathname) === page(location.pathname);
  }
  function targetFor(hash) {
    if (!hash || hash === '#') return null;
    try { return document.getElementById(decodeURIComponent(hash.slice(1))); } catch (error) { return null; }
  }
  // The tab panes around an element, outer first (DOM order opens them in turn).
  function panesOf(element) {
    var panes = [];
    for (var node = element; node; node = node.parentElement) {
      if (node.classList && node.classList.contains('tab-pane')) panes.unshift(node);
    }
    return panes;
  }

  function snapshot() {
    return {x: window.scrollX, y: window.scrollY,
      panes: Array.prototype.map.call(document.querySelectorAll('.tab-pane.active'), function (pane) { return pane.id; })};
  }
  function save() {
    if (restoring) return;
    var state = history.state, next = {};
    if (state && typeof state === 'object') for (var name in state) next[name] = state[name];
    next[KEY] = snapshot();
    try { history.replaceState(next, '', location.href); } catch (error) { /* rate-limited: the next save stores it */ }
  }

  function tabOf(pane) {
    return document.getElementById(pane.getAttribute('aria-labelledby') || '')
      || (pane.id && window.CSS && CSS.escape
        ? document.querySelector('[role="tab"][data-bs-target="#' + CSS.escape(pane.id) + '"]') : null);
  }
  // Marks a pane and its tab active, as Quarto's grouped tabsets do: without
  // Bootstrap's Tab, or when its tab is already marked active.
  function activate(pane, tab) {
    each(pane.parentElement ? pane.parentElement.children : [], function (other) {
      if (other !== pane && other.classList.contains('tab-pane')) other.classList.remove('active', 'show');
    });
    pane.classList.add('active');
    var list = tab && tab.closest('[role="tablist"]');
    if (list) {
      each(list.querySelectorAll('[role="tab"]'), function (link) {
        link.classList.toggle('active', link === tab);
        link.setAttribute('aria-selected', String(link === tab));
      });
    }
  }
  // Shows a pane through Bootstrap (its events and ARIA), which neither
  // clicks the tab nor changes a grouped tabset's remembered choice.
  function openPane(pane) {
    if (pane.classList.contains('active')) return Promise.resolve();
    var tab = tabOf(pane), Tab = window.bootstrap && window.bootstrap.Tab;
    if (!tab || !Tab || tab.classList.contains('active')) {
      activate(pane, tab);
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      var timer = setTimeout(resolve, 400);
      tab.addEventListener('shown.bs.tab', function () { clearTimeout(timer); resolve(); }, {once: true});
      Tab.getOrCreateInstance(tab).show();
    }).then(function () { if (!pane.classList.contains('active')) activate(pane, tab); });
  }
  function openAll(target, panes) {
    for (var node = target; node; node = node.parentElement) {
      if (node.tagName === 'DETAILS' && !node.open) node.open = true;
    }
    return panes.reduce(function (done, pane) { return done.then(function () { return openPane(pane); }); }, Promise.resolve());
  }

  // Below a fixed or sticky header (its full height, also while headroom has
  // slid it away: scrolling up brings it back).
  function clearance() {
    var header = document.getElementById('quarto-header');
    var position = header ? getComputedStyle(header).position : '';
    return (position === 'fixed' || position === 'sticky' ? header.offsetHeight : 0) + 16;
  }
  // A section's heading. (Quarto stretches a section that is :target upwards
  // by the header's height, so the section's own top moves.)
  function headingOf(target) {
    var first = target.firstElementChild;
    return target.tagName === 'SECTION' && first && /^H[1-6]$/.test(first.tagName) ? first : null;
  }
  // What lands below the header: for a tab title, the tab row above its pane.
  function anchorOf(target) {
    if (!target.classList.contains('ctm-tab-target')) return headingOf(target) || target;
    var pane = target.closest('.tab-pane'), tabset = pane && pane.closest('.panel-tabset');
    var row = tabset && tabset.querySelector(':scope > [role="tablist"], :scope > .nav');
    return row || target;
  }
  // Jumps, also where the page scrolls smoothly (Bootstrap's :root rule).
  function scrollToY(top) {
    var root = document.documentElement, smooth = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(window.scrollX, Math.max(0, top));
    root.style.scrollBehavior = smooth;
  }
  function scrollTo(element) {
    scrollToY(window.scrollY + element.getBoundingClientRect().top - clearance());
  }
  function inView(element) {
    var rect = element.getBoundingClientRect();
    return rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight;
  }

  function focusOf(target) {
    if (target.classList.contains('ctm-tab-target')) {
      var pane = target.closest('.tab-pane');
      var first = pane && pane.querySelector('h1, h2, h3, h4, h5, h6');
      if (first && inView(first)) return first;
      return pane || target;
    }
    var heading = headingOf(target);
    if (heading) return heading;
    if (target.tagName === 'DETAILS') return target.querySelector(':scope > summary') || target;
    return target;
  }
  function focus(target) {
    var element = focusOf(target);
    var focusIt = function () {
      try { element.focus({preventScroll: true}); } catch (error) { element.focus(); }
      return document.activeElement === element;
    };
    if (element.matches(FOCUSABLE) && focusIt()) return;
    if (element.hasAttribute('tabindex')) return;
    // Not focusable (or not in this browser, such as a summary): only while focused.
    element.setAttribute('tabindex', '-1');
    element.addEventListener('blur', function () { element.removeAttribute('tabindex'); }, {once: true});
    focusIt();
  }

  function unpin() {
    if (!pinned) return;
    pinned.observer.disconnect();
    clearTimeout(pinned.timer);
    STOP_PIN.forEach(function (type) { window.removeEventListener(type, unpin, true); });
    pinned = null;
  }
  // Keeps `element` where it is while the layout above it changes.
  function pin(element) {
    unpin();
    if (typeof ResizeObserver !== 'function') return;
    var top = element.getBoundingClientRect().top;
    var observer = new ResizeObserver(function () {
      if (!pinned) return;
      var drift = element.getBoundingClientRect().top - top;
      if (Math.abs(drift) >= 1) scrollToY(window.scrollY + drift);
    });
    pinned = {observer: observer, timer: setTimeout(unpin, PIN_MS)};
    observer.observe(document.body);
    STOP_PIN.forEach(function (type) { window.addEventListener(type, unpin, {capture: true, passive: true}); });
  }

  function allActive(panes) {
    return panes.every(function (pane) { return pane.classList.contains('active'); });
  }

  // Restores a history entry's position, or opens, scrolls to and focuses a target.
  function navigate(position, target, how) {
    var request = ++navigation;
    var current = function () { return request === navigation; };
    restoring = true;
    clearTimeout(scrollTimer);
    unpin();
    var panes = position ? position.panes.map(function (id) { return document.getElementById(id); }).filter(Boolean)
      : target ? panesOf(target) : [];
    var opened = position ? panes.reduce(function (done, pane) { return done.then(function () { return openPane(pane); }); }, Promise.resolve())
      : target ? openAll(target, panes) : Promise.resolve();
    var anchor = null;
    return opened.then(function () {
      if (!current()) return null;
      window.dispatchEvent(new Event('resize'));
      return frame().then(frame);
    }).then(function () {
      if (!current()) return null;
      if (position) {
        scrollToY(position.y);
      } else if (target && target.getClientRects().length) {
        anchor = anchorOf(target);
        scrollTo(anchor);
        focus(target);
        target.setAttribute('data-ctm-nav', how);
        pin(anchor);
      }
      return frame();
    }).then(function () {
      if (!current()) return null;
      // Something switched a tab back (a grouped tabset restoring its
      // remembered choice): the link wins.
      if (target && !position && !allActive(panes)) {
        return openAll(target, panes).then(frame).then(function () {
          if (current() && anchor) { scrollTo(anchor); pin(anchor); }
        });
      }
      return null;
    }).then(function () {
      if (!current()) return;
      restoring = false;
      save();
    });
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    save();
    if (link.getAttribute('role') === 'tab' || link.hasAttribute('data-bs-toggle')) return;
    var url;
    try { url = new URL(link.href, location.href); } catch (error) { return; }
    if (!samePage(url)) return;
    var target = targetFor(url.hash);
    if (!target) return;
    event.preventDefault();
    if (location.hash !== url.hash) history.pushState(null, '', url.hash);
    handledURL = location.href;
    navigate(null, target, 'link');
  }, true);

  window.addEventListener('scroll', function () {
    if (restoring) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(save, 100);
  }, {passive: true});
  document.addEventListener('shown.bs.tab', function () { if (!restoring) save(); });
  window.addEventListener('pagehide', save);
  window.addEventListener('popstate', function (event) {
    handledURL = location.href;
    navigate(event.state && event.state[KEY] || null, targetFor(location.hash), 'history');
  });

  // After Quarto's handlers: its grouped tabsets restore their choice on
  // pageshow, and quarto-nav.js scrolls by the header's height on
  // hashchange; both register before DOMContentLoaded.
  function start() {
    window.addEventListener('hashchange', function () {
      // Back/Forward sends popstate first: that entry is handled.
      if (handledURL === location.href) return;
      handledURL = location.href;
      navigate(null, targetFor(location.hash), 'hash');
    });
    var show = function () {
      handledURL = location.href;
      navigate(history.state && history.state[KEY] || null, targetFor(location.hash), 'load');
    };
    window.addEventListener('pageshow', show);
    // Loaded late, after the page was shown.
    if (document.readyState === 'complete') show();
  }

  window.CTMNav = {
    version: 1,
    reveal: function (element) { return element ? navigate(null, element, 'api') : Promise.resolve(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
