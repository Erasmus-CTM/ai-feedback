// S-18: accessible labels use the authored display label, not an internal key.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {JSDOM} = require('jsdom');
const C = require('./helpers/ctm-libs.cjs');
const source = fs.readFileSync(path.join(C.library, 'ui/ctm-matrix-input.js'), 'utf8');
const axis = {auto: true, initial: 1, min: 1, max: 3};

function page(spec, labels = {}) {
  const dom = new JSDOM('<body></body>', {runScripts: 'outside-only'});
  dom.window.eval(source);
  const renderer = dom.window.MatrixInput.create({labels});
  dom.window.document.body.innerHTML = renderer.renderHTML(spec).html;
  const wrap = dom.window.document.body.firstElementChild;
  return {dom, wrap, renderer, editor: renderer.mount(wrap)};
}

test('authored display label survives resize and controls use the caller language', () => {
  const {dom, wrap, editor} = page({name: 'ans1', label: 'Koeffisientmatrisen', rows: axis, cols: axis},
    {matrixRows: 'Rader', matrixColumns: 'Kolonner', matrixAddRow: 'Legg til rad', matrixSizeControls: 'Matrisestørrelse'});
  try {
    assert.equal(wrap.querySelector('input').getAttribute('aria-label'), 'Koeffisientmatrisen, Rader 1, Kolonner 1');
    assert.equal(wrap.querySelector('[data-dynamic-action="add-row"]').getAttribute('aria-label'), 'Legg til rad Koeffisientmatrisen');
    assert.equal(wrap.querySelector('.math-dynamic-matrix-controls').getAttribute('aria-label'), 'Matrisestørrelse');
    editor.resize(2, 2);
    assert.equal(wrap.querySelector('[data-matrix-row="2"][data-matrix-column="2"]').getAttribute('aria-label'), 'Koeffisientmatrisen, Rader 2, Kolonner 2');
    assert.equal(wrap.querySelector('[data-dynamic-action="add-row"]').getAttribute('aria-label'), 'Legg til rad Koeffisientmatrisen');
    assert.equal(wrap.querySelector('input').dataset.dynamicMatrixName, 'ans1');
  } finally { dom.window.close(); }
});

test('legacy specifications keep name-based labels and display text cannot inject markup', () => {
  const old = page({name: 'A', rows: axis, cols: axis});
  try {
    assert.equal(old.wrap.querySelector('input').getAttribute('aria-label'), 'A, Rows 1, Columns 1');
    assert.equal(old.wrap.querySelector('[data-dynamic-action="add-row"]').getAttribute('aria-label'), 'Add row A');
  } finally { old.dom.window.close(); }
  const labelled = page({name: 'ans1', label: '<img src=x onerror="run()">', rows: axis, cols: axis});
  try {
    assert.equal(labelled.wrap.querySelector('img'), null);
    assert.match(labelled.wrap.querySelector('input').getAttribute('aria-label'), /^<img src=x/);
    assert.throws(() => labelled.renderer.renderHTML({name: 'A', label: {}, rows: axis, cols: axis}), /display label/);
  } finally { labelled.dom.window.close(); }
});
