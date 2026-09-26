# Installation and setup

[Start here](../README.md) · [Authoring guide](authoring.md)

## Install once, activate automatically

Install ai-feedback **once in the Quarto project**, alongside the exercise
extensions. Consumers do not contain private copies of its runtime.

```sh
quarto add Erasmus-CTM/ai-feedback@feature/scoped-policies
```

**Integration-branch preview:** until this work is merged, install
`Erasmus-CTM/ai-feedback@feature/scoped-policies` and each consumer's
`feature/shared-feedback-integration` branch. Main-branch consumers do not yet
have this protocol. The common examples builder pins the exact tested revisions.

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
are supported; duplicate installations or a missing shared dependency produce
an actionable render error. Rendering does not download dependencies.

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

Local storage shares settings across pages on the same origin. Session storage
limits them to a browser tab. Users can edit settings and explicitly import old
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

