# Development

[Start here](../README.md) · [API](api.md) · [Reference](reference.md)

## Layout

```
_extensions/ctm-libs/            the library (authors never list it; the package does)
  _extension.yml                 version of everything below
  ctm-libs.lua                   filter entry: ctm.filters() (Meta, Callout, Pandoc)
  read-settings.ts, deno.json    settings reader (quarto run), with its isolated Deno configuration
  lua/ctm.lua                    the page's instance; lazily loaded modules:
  lua/settings.lua               ctm.settings
  lua/locale.lua                 ctm.locale
  lua/feedback.lua, policy.lua   ctm.feedback (activities, context, policies, P22)
  lua/runtime.lua, deps.lua      ctm.runtime, ctm.deps
  feedback/                      AIFeedback browser files, feedback-defaults.yml
  runtime/pyodide-runtime.js     MathExerciseRuntime
  locales/                       ctm-locale.js (CTMLocales) and the message catalogues
_extensions/ai-feedback/         alias for 0.9.x (feedback-quarto.lua, ai-feedback.lua)
bootstrap/ctm-bootstrap.lua      the file every component copies
scripts/                         sync-feedback-defaults.py, check-locales.py, capture-legacy-locales.mjs
tests/                           npm test; tests/legacy (CI job with the old components)
```

## Tests

```sh
npm ci
npm test                                     # unit tests and Quarto render tests (Quarto 1.8.27 or later)
python -m pip install 'PyYAML>=6'
python scripts/sync-feedback-defaults.py --check
python scripts/check-locales.py
```

In VS Code, **Terminal → Run Task…** offers the same commands
(`.vscode/tasks.json`). The render tests build small projects in temporary
folders with this repository's extensions and a probe component
(`tests/fixtures/probe`) that loads ctm-libs through the canonical bootstrap
and evaluates Lua against it.

CI (`.github/workflows`):

- `test.yml`: the checks above;
- `example.yml`: renders `example.qmd`;
- `legacy-consumers.yml`: the components as merged before the consolidation
  (math-exercise `bf6caf3`, py-exercise `c14c5f4`) and pyodide-interaktiv
  1.8 (`8a16aa7`) render through the ai-feedback alias; pyodide-interaktiv's
  own tests run with `AI_FEEDBACK_EXTENSION=_extensions/ctm-libs/feedback`;
  `quarto add Erasmus-CTM/ai-feedback@<branch>` still installs both extensions;
- `browser.yml`: the runtime loads Pyodide from jsDelivr in Chromium.

The CTM Assessment umbrella runs `npm test` here as well, against the
package it builds.

## Generated files and versions

`python scripts/sync-feedback-defaults.py` regenerates

- the shipped policies in `feedback/feedback-core.js` from
  `feedback/feedback-defaults.yml`;
- the interface strings of `feedback/ai-feedback.js` from
  `locales/feedback.js` (that file stays self-contained: pyodide-interaktiv
  1.8's tests load the three feedback files without a locale runtime);
- the version, from `_extensions/ctm-libs/_extension.yml`, in the alias
  manifest, the `VERSION` of `feedback-core.js`, `package.json` and
  `package-lock.json`.

`--check` fails when one of them differs. For a release, change the version
in `_extensions/ctm-libs/_extension.yml` and run the script. The alias must
have ctm-libs' version: older components' loaders compare its manifest with
the version ctm-libs registers.

## Messages

Every interface text is in a catalogue, `locales/<namespace>.js`: valid
JavaScript (`CTMLocales.add("<namespace>", …)`) whose payload between
`/*BEGIN-JSON*/` and `/*END-JSON*/` is strict JSON. English is the reference;
every language listed in `$languages` has every key. Edit the JSON only,
then run `python scripts/check-locales.py` (format, completeness, `$ref`
targets, `$t` arguments, plurals; it prints the coverage). After editing
`locales/feedback.js`, run the sync script.

A component uses its namespace in Lua (`ctm.locale.text`) and in the browser
(`CTMLocales.table(namespace, lang)` after `ctm.locale.use(namespace)`).
A new language is added to `$languages` with all its texts.

`tests/goldens/legacy-locales.json` holds the texts of math-exercise 0.9 and
py-exercise 0.3, recorded once by `scripts/capture-legacy-locales.mjs`;
`tests/locale.test.cjs` keeps the catalogues byte-identical to them.

## The component bootstrap

`bootstrap/ctm-bootstrap.lua` is copied byte for byte into every component
(the CTM Assessment build compares the copies). It holds only the location
logic: the package requirement (`CTM_COMPONENT_DEV=1` for component
development), the search for ctm-libs, and the interface level `API`. Raise
`ctm.api` in `lua/ctm.lua` (and `API` in the bootstrap) only for changes that
older components cannot use.

## What older consumers rely on (until the alias goes)

pyodide-interaktiv 1.8 and the components released before the consolidation
load `_extensions/ai-feedback/feedback-quarto.lua` through their
`feedback-loader.lua`. They need:

- that file name, in a folder `ai-feedback` next to `ctm-libs`;
- the alias manifest's version equal to ctm-libs' version (they compare it
  with `_G.__ctmAiFeedbackInstallation`, which `lua/feedback.lua` registers);
- the module's `prepare`, `markCallout`, `selection` and `context`, and the
  browser API of `AIFeedback` (`version`, `attach`, `settingsButton`,
  `openSettings`, `buildSettings`, `contextMaterials`, `locales`, …).

`legacy-consumers.yml` checks all of this.

## Python runtime

`runtime/pyodide-runtime.js` names the Pyodide version (`indexURL`). A new
version changes the browser's SymPy and Python: it is gated by the umbrella's
Pyodide parity harness (every exercise of the example sites and courses under
both versions) and goes in a commit of its own. CI's native checks use the
SymPy version that Pyodide ships.
