/* CTM Assessment: reveals and the lecture/reading switch (ctm-libs) —
 * AGPL-3.0-or-later. Loaded on pages with reveals (lua/ui.lua).
 *
 * - The switch (.ctm-modes, rendered hidden) shows itself here. "Lecture"
 *   closes every reading step (details.ctm-reveal.reading-step), "reading"
 *   opens them all. The mode lasts for the browser tab, per course:
 *   sessionStorage "ctm|1|<course>|~mode"; a new tab starts in lecture mode.
 *   The status line gets its live region after its first text, so loading
 *   the page announces nothing; switching does.
 * - Printing opens the reading steps and restores them afterwards.
 * - Opening or closing reveals dispatches one resize per animation frame, so
 *   boards and editors inside them lay out again.
 * - A link to an id inside closed <details> opens them, when ui/ctm-nav.js
 *   (which also opens tabs, scrolls and focuses) is not on the page.
 */
(function () {
  'use strict';
  if (window.CTMReveal) return;

  // The course a page belongs to: the site's root path (website pages carry
  // <meta name="quarto:offset">), else the page's folder (a single file).
  function course() {
    var meta = document.querySelector('meta[name="quarto:offset"]');
    try {
      return new URL(meta ? meta.getAttribute('content') || './' : './', location.href).pathname;
    } catch (error) {
      return location.pathname.replace(/[^/]*$/, '');
    }
  }
  function key(name) {
    return 'ctm|1|' + encodeURIComponent(course()) + '|' + name;
  }
  function each(list, visit) { Array.prototype.forEach.call(list, visit); }
  function readingSteps() { return document.querySelectorAll('details.ctm-reveal.reading-step'); }

  var resizing = false;
  document.addEventListener('toggle', function (event) {
    var target = event.target;
    if (resizing || !target || target.tagName !== 'DETAILS' || !target.classList.contains('ctm-reveal')) return;
    resizing = true;
    requestAnimationFrame(function () {
      resizing = false;
      window.dispatchEvent(new Event('resize'));
    });
  }, true);

  var mode = 'lecture';
  function select(next, remember) {
    mode = next === 'reading' ? 'reading' : 'lecture';
    each(readingSteps(), function (step) { step.open = mode === 'reading'; });
    each(document.querySelectorAll('.ctm-modes'), function (group) {
      each(group.querySelectorAll('button[data-mode]'), function (button) {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-mode') === mode));
      });
      var status = group.querySelector('.ctm-modes-status');
      if (status) status.textContent = status.getAttribute('data-' + mode) || '';
    });
    if (remember) {
      try { sessionStorage.setItem(key('~mode'), mode); } catch (error) { /* storage unavailable: this page only */ }
    }
  }

  function startModes() {
    var groups = document.querySelectorAll('.ctm-modes');
    if (!groups.length) return;
    var stored = null;
    try { stored = sessionStorage.getItem(key('~mode')); } catch (error) { stored = null; }
    select(stored === 'reading' ? 'reading' : 'lecture', false);
    each(groups, function (group) {
      each(group.querySelectorAll('button[data-mode]'), function (button) {
        button.addEventListener('click', function () { select(button.getAttribute('data-mode'), true); });
      });
      var status = group.querySelector('.ctm-modes-status');
      if (status) {
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
      }
      group.hidden = false;
    });
  }

  function openTarget() {
    if (window.CTMNav) return;
    var target = null;
    try { target = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null; } catch (error) { target = null; }
    for (var node = target; node; node = node.parentElement) {
      if (node.tagName === 'DETAILS') node.open = true;
    }
  }

  var printing = null;
  window.addEventListener('beforeprint', function () {
    if (printing) return;
    printing = [];
    each(readingSteps(), function (step) {
      printing.push([step, step.open]);
      step.open = true;
    });
  });
  window.addEventListener('afterprint', function () {
    if (!printing) return;
    printing.forEach(function (entry) { entry[0].open = entry[1]; });
    printing = null;
  });

  function start() {
    startModes();
    openTarget();
    window.addEventListener('hashchange', openTarget);
  }

  window.CTMReveal = {
    version: 1,
    // 'lecture' or 'reading'; select() switches as the buttons do.
    mode: function () { return mode; },
    select: function (next) { select(next, true); },
    course: course
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
