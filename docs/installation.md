# Installation and setup

[Start here](../README.md) · [Authoring guide](authoring.md)

## Install once, activate automatically

Install ai-feedback **once in the Quarto project**, alongside the exercise
extensions. Consumers do not contain private copies of its runtime.

```sh
quarto add Erasmus-CTM/ai-feedback@main
```

Use Quarto 1.8.27 or later with AI Feedback 0.8. For the combined distribution,
install the [CTM Assessment umbrella](https://github.com/Erasmus-CTM/ctm-assessment)
so it owns the component sources and the temporary Pyodide migration pin.
Standalone consumers install this shared dependency from current `main`.

For text/image activities alone:

```yaml
filters: [ai-feedback]
```

For exercise pages, list the exercise filters you use:

```yaml
filters:
  - math-exercise
  - pyodide-interaktiv
  - py-exercise
py-exercise:
  feedback: true
pyodide:
  feedback: true
ai-feedback:
  mode: copy
  storage: local
```

An enabled consumer automatically loads the installed ai-feedback module during
HTML rendering, including text/image activities on that page. An explicit
`ai-feedback` filter also works, in either order. Resources and settings load
once. Flat and owner-qualified `_extensions` layouts and nested project pages
are supported. A consumer uses the ai-feedback installed next to it (for
example inside the CTM Assessment package), so separately added copies may have
other versions; a page that combines consumers bound to different ai-feedback
versions, several installations without one next to the consumer, or a missing
shared dependency produce an actionable render error. Rendering does not
download dependencies.

`py-exercise` loads its browser Python runtime directly when used alone, or
reuses the runtime from `pyodide-interaktiv` when both are present. Feedback-disabled Python/Pyodide pages do not require
ai-feedback unless another enabled integration uses it. This feedback interface
is for HTML; exercise extensions retain their own non-HTML behavior.


## Provider settings and data sent

Every cogwheel opens the same settings dialog. Copy mode needs no account and
makes no provider request. Direct API mode uses an OpenAI-compatible endpoint,
model and personal key entered in the browser. Institutional defaults belong in
Quarto metadata; never put keys in the project:

```yaml
ai-feedback:
  mode: copy
  storage: local
  base-url: https://your-institution.example/v1
  model: your-model-id
```

These settings combine key by key across `_quarto.yml`, the active profiles'
`_quarto-<profile>.yml` (with several profiles the first listed wins, as in
Quarto), `_quarto.yml.local`, directory `_metadata.yml` files and page front matter,
so a page that selects a `page-policy` keeps the project's `mode`, `base-url`,
`model` and `storage`. A value in the page's own front matter wins; values that
only Quarto's merged metadata contains (notebook front matter, `format: html:`
scoped settings) are used too. Settings supplied through `metadata-files` are
not combined with a page's own `ai-feedback` mapping; put them in `_quarto.yml`
or `_metadata.yml`.

Rendering warns about unknown options (for example `base_url`), unsupported
`mode`/`storage` values, an invalid `base-url` (without repeating it) and
anything that looks like a credential (`api-key`, `token`, ...); such values
are ignored and never written into the page.

Local storage shares settings across pages on the same origin. Session storage
limits them to a browser tab. Without `storage:` the default is `local`, unless
an integration sets its own default (`pyodide: feedback-storage:`). Users can edit settings and explicitly import old
consumer settings. The chosen provider must allow browser CORS access; network
or VPN requirements remain the institution's responsibility.

Direct requests contain the task, current response, selected context, policy
and optional attachments/evidence. Python tests, expected math answers,
checker source and raw tracebacks are not feedback material. A previous
Check/Run contributes evidence only while it matches the current response;
editing, resetting or rerunning invalidates it. Pyodide sends a generic run
status and learner stdout, not raw stderr, HTML output or plots. Graph adapters
supply an explicit summary and optional image; raw graph/checker objects stay
local. These are client-side learning tools, not secure examination systems.

