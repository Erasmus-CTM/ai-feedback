/* Shared plain-text copy, including plain HTTP and restricted browsers. */
(function () {
  'use strict';
  if (window.CTMCopy) return;
  var status;
  function textFor(key, fallback) {
    if (window.CTMLocales) {
      try { return CTMLocales.t('ui', key, document.documentElement.lang || 'en') || fallback; } catch (error) { /* standalone helper */ }
    }
    return fallback;
  }
  function report(value) {
    if (!status) {
      status = document.createElement('span'); status.className = 'ctm-copy-status';
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); document.body.appendChild(status);
    }
    status.textContent = value;
  }
  function restoreFocus(previous) {
    if (!previous || !previous.focus) return;
    try { previous.focus({preventScroll: true}); } catch (error) { previous.focus(); }
  }
  function manual(value, label, previous) {
    var panel = document.createElement('dialog'), area = document.createElement('textarea'), close = document.createElement('button');
    var hint = document.createElement('p'), modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘C' : 'Ctrl+C';
    hint.textContent = textFor('copyHint', 'Select the text and press {keys}.').replace('{keys}', modifier);
    area.value = value; area.readOnly = true; area.setAttribute('aria-label', label); area.rows = 12;
    close.type = 'button'; close.textContent = textFor('copyClose', 'Close');
    panel.className = 'ctm-copy-dialog'; panel.setAttribute('aria-label', label);
    panel.append(hint, area, close); document.body.appendChild(panel);
    function finish() { panel.remove(); restoreFocus(previous); }
    close.addEventListener('click', finish);
    panel.addEventListener('cancel', function (event) { event.preventDefault(); finish(); });
    if (panel.showModal) panel.showModal(); else panel.setAttribute('open', '');
    area.focus(); area.select(); report(hint.textContent);
    return {method: 'select', element: area};
  }
  async function text(value, options) {
    value = String(value); options = options || {};
    var previous = document.activeElement, label = options.label || textFor('copyText', 'Copy text');
    try {
      if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value); report(textFor('copied', 'Copied'));
        return {method: 'clipboard'};
      }
    } catch (error) { /* try the plain HTTP path if permission is denied */ }
    var area = document.createElement('textarea');
    area.value = value; area.readOnly = true; area.setAttribute('aria-label', label);
    area.style.cssText = 'position:fixed;left:-10000px;top:0;'; document.body.appendChild(area);
    area.focus(); area.select(); var success = false;
    try { success = !!document.execCommand && document.execCommand('copy'); } catch (error) { /* selectable fallback */ }
    area.remove(); restoreFocus(previous);
    if (success) { report(textFor('copied', 'Copied')); return {method: 'execCommand'}; }
    return manual(value, label, previous);
  }
  window.CTMCopy = {version: 1, text: text};
})();
