# AI Feedback for Quarto

One feedback service for text and images, `py-exercise`, `math-exercise` and
`pyodide-interaktiv`. It owns prompts, progressive hints, provider settings,
requests, cancellation, Markdown/LaTeX rendering and learning-context collection.
Exercise plugins supply the task, current response and safe evidence from a
previous Check or Run. Feedback never executes learner code or assigns grades.

[Combined examples](https://erasmus-ctm.github.io/ctm-assessment/example.html) ·
[Examples source](https://github.com/Erasmus-CTM/ctm-assessment/blob/main/example.qmd) · [Teaching policies](docs/feedback-policies.md) ·
[JavaScript API](docs/api.md)

## Install once, activate automatically

Install ai-feedback **once in the Quarto project**, alongside the exercise
extensions. Consumers do not contain private copies of its runtime.

```sh
quarto add Erasmus-CTM/ai-feedback
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

## Author text, translation and image tasks

````markdown
::: {.ai-feedback #spanish profile="language-quality" response-language="es" feedback-language="en" learner-level="Spanish course 1"}
Write five sentences about your daily routine.

::: {.feedback-starter}
Me llamo Ana. Yo vivir en Oslo.
:::

::: {.feedback-criteria}
Identify up to three useful improvements. Preserve the learner's meaning.
:::
:::
````

The main prose is the learner's task. `.feedback-criteria` is hidden author
instruction; `.feedback-starter` pre-fills the response. Profiles are `review`,
`language-quality`, `translation`, `python` and `mathematics`.

Translation activities can use a nested `.feedback-source` or
`source="original-id"` pointing to a tagged context block. `source-language`,
`response-language` and `feedback-language` are independent. A selected source
remains part of the task even with `context="none"`.

Use `image-upload="true" image-role="response"` for photographed learner work,
or `image-role="source"` for an image to describe. PNG, JPEG and WebP are
supported (at most three images, 8 MiB each, 12 MiB combined). Images remain in
memory. Copy mode requires attaching them separately in the chosen chat app;
direct feedback needs a vision-capable provider. Required images are not silently
dropped. Mathematics may explicitly fall back to its supplied textual graph
summary when a provider cannot accept the optional graph image.

## The same learning context in all four integrations

| Setting | Meaning |
|---|---|
| Omitted or `context: auto` | Preceding prose since the latest heading, including that heading |
| `context: none` | No surrounding learning context |
| `context: notes` | Only the tagged block `notes`, anywhere on the page |
| `context: notes,formula` | Those tagged blocks in the specified order |

Text activities use attributes such as `context="notes"`; code cells use
`#| context: notes`. Code integrations also accept `feedback-context` as an
explicit alias; that alias takes precedence.

**Pyodide exception:** `context: interactive`, `setup` and `output` retain their
execution meaning. Use `feedback-context` when specifying both execution and
feedback context. Other context values, including `none`, control feedback and
leave execution at its normal default.

Automatic context is collected once from the source document before exercise
transformation, not by scraping the rendered page. It keeps whole recent blocks
up to 1,500 characters and preserves source LaTeX. Code, other activities,
feedback criteria/starters, `.example-author-notes`, `.ai-feedback-ignore`,
hidden content and generated cell output are excluded. Author callouts remain
visible but are excluded from context. Heading boundaries apply inside nested
containers too; a single oversized latest block is omitted rather than sliced.

Explicit context uses a combined 6,000-character budget and preserves math
through MathJax or KaTeX rendering. Missing, duplicate, untagged, empty or
over-budget references are skipped with a browser-console warning. Explicit
selection replaces automatic prose; it does not append to it.

Reusable tagged blocks can be referenced by any integration. See the
[combined authoring examples](https://github.com/Erasmus-CTM/ctm-assessment#reuse-one-block-across-different-integrations).

## Prompts, hints and local YAML

Defaults ship in `_extensions/ai-feedback/feedback-defaults.yml`. Leave that
file unchanged and override it in a local file:

```yaml
# feedback.yml
ai-feedback:
  defaults:
    max-words: 180
    reset-on-run: true
  integrations:
    py-exercise:
      prompt: Use the terminology taught in this course.
      steps:
        - prompt: Ask one guiding question.
        - prompt: Explain the relevant idea without finished code.
        - prompt: Explain a complete solution.
          allow-full-solution: true
```

Load one file with `ai-feedback.policy-files: feedback.yml`, or list several
files in order. Later files override earlier values within the same scope;
integration settings override common defaults. Step lists are replaced in full;
`steps: []` gives ordinary review mode. Inline Quarto metadata can override files.
Use this loader for ordered step replacement: native `metadata-files` may merge
arrays before the filter sees them.

| Integration | Shipped behavior |
|---|---|
| Non-Python | Review, no hint sequence |
| py-exercise | Review, no hint sequence |
| math-exercise | Four steps; full worked solution permitted at step four |
| pyodide-interaktiv | Three steps; last describes the approach, without finished code |

Each successful feedback advances one step; the last step repeats. Failed,
cancelled or stale responses consume no step. Editing invalidates evidence and
pending feedback but preserves progression. **Run/Check resets hints by default**;
set `reset-on-run: false` globally or per integration to preserve them. Explicit
Reset/new math task always restarts. Changing the effective policy resets saved
progress. Counters belong to the activity and page in the current browser tab.

Policies also support `language`, `max-issues`, `allow-full-solution` and
per-step limits. Prompts are author instructions; they never appear in the
learner's task. [Full schema, precedence and examples](docs/feedback-policies.md).

Page front matter may load `ai-feedback.page-policy-files` to override project
settings. Define reusable policies under `ai-feedback.policies` in those YAML
files and select one with `feedback-policy="name"` (text activities) or
`#| feedback-policy: name` (code cells). Inline selections contain names only.
YAML `ai-feedback.exercises.<integration>.<label-or-id>` targets individual
exercises. See [page/exercise precedence and examples](docs/feedback-policies.md#page-scope-and-named-exercise-policies-060).

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

## Integrating another activity

Use `AIFeedback.attach({integration, id, button, output, getRequest})` for policy,
progression, settings, requests and rendering. `getRequest` should collect data
without executing code. Use `AIFeedback.contextMaterials({mode, refs, text})` for
context and `handle.reset('run')` on Run/Check. Call `handle.cancel({clearOutput:
true})` on edits and `handle.reset()` on explicit Reset. The consumer owns its
editor, checker and evidence boundary. [API reference](docs/api.md).

The Quarto side exposes `feedback-quarto.lua`: a `markCallout` filter prepass,
`prepare(doc)` and `context(block, options, isPyodide)`. Consumers contain only
small dependency-discovery glue. All policy, context and feedback implementation
belongs here.

## Development

```sh
npm ci
npm test
python -m pip install PyYAML==6.0.2
python scripts/sync-feedback-defaults.py --check
```

Edit `feedback-defaults.yml`, then run `python scripts/sync-feedback-defaults.py`
to regenerate the embedded browser policy. This repository tests the shared
runtime and API. It does not own consumer examples, installation assembly or site
deployment: those live in [ctm-assessment](https://github.com/Erasmus-CTM/ctm-assessment).
That repository pins consumer branches and runs Quarto and real-browser gates.

## License

AGPL-3.0-or-later. Shared rendering, context and model-policy code originated in
Erasmus-CTM/math-exercise, with feedback-interface ideas from
Erasmus-CTM/pyodide-interaktiv, under the same license.

### Standalone example

`example.qmd` demonstrates this package with shared feedback. No additional Quarto extension is required. The example builds automatically on pushes and pull requests; download the `standalone-example` Actions artifact. Feedback defaults to copy mode, which needs no API key.
