# Shared matrix input (step 6)

`ctm.matrix.use()` adds the shared matrix CSS and after-body JavaScript once per
page. The browser interface remains `window.MatrixInput.create(options)`; parsing,
grading and storing responses belong to each consumer.

The initial extraction preserves math-exercise's editor bytes. A separate S-18
change adds an optional string `spec.label`: controls and cells use this authored
display label, falling back to the existing `spec.name` for older specifications.
The internal name, structural labels, ids and response coordinates do not change.
`data-matrix-label` retains the display label when resizing rebuilds the cells.
All label values are HTML-attribute escaped. The caller may localize the controls'
group label with `options.labels.matrixSizeControls`, alongside the existing row,
column and action labels.

Expected rendered differences for the step-6 integration comparison are limited to:

- the matrix script/style dependency moving from the component to
  `ctm-matrix-input-<library-version>/ctm-matrix-input.{js,css}`;
- the localized matrix-size-controls `aria-label` (English is unchanged);
- `data-matrix-label` and cell/control `aria-label` text when an authored display
  label is supplied. The label must survive resizing; the internal answer name
  and ids stay unchanged.

There is no verdict, input transport, layout or default interaction change. The
`matrix-labels.test.cjs` fixtures exercise authored and legacy labels, resizing,
translation and markup injection rejection. The component's existing matrix,
storage and transport tests run against this shared source.
