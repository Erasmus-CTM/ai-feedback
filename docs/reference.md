# Detailed functionality reference

[Start here](../README.md) · [Authoring guide](authoring.md)

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
[combined authoring examples](https://github.com/Erasmus-CTM/ctm-assessment/blob/main/docs/reference.md#reuse-one-block-across-different-integrations).

## Prompts, hints and local YAML

Shipped defaults are always available. Loading `policy-files` or
`page-policy-files` only registers named definitions; activate a baseline with
`project-policy` or `page-policy`, or select `feedback-policy` on an exercise.

```yaml
# feedback.yml
ai-feedback:
  policies:
    course-feedback:
      base-prompt: Use the terminology taught in this course.
      max-words: 180
      steps:
        - step-prompt: Ask one guiding question.
        - step-prompt: Explain the relevant idea without finished code.
    brief-feedback:
      extends: course-feedback
      max-words: 80
```

```yaml
# Page front matter
ai-feedback:
  page-policy-files: feedback.yml
  page-policy: brief-feedback
```

A child inherits omitted fields. A supplied `steps` list replaces the complete
inherited sequence; `steps: []` selects review without hint progression.
`base-prompt` applies throughout, while `step-prompt` adds the current step's
instructions. Step limits and permissions override the policy for that step.

Successful feedback advances one step; the last repeats. Failed, cancelled or
stale requests consume no step. Run/Check resets by default; select a policy
with `reset-on-run: false` to preserve progression. Changing the effective policy
resets saved progress. See the [complete policy guide](https://github.com/Erasmus-CTM/ai-feedback/blob/main/docs/feedback-policies.md)
for inheritance, explicit scopes and targeted exercise overrides.

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

Options combine key by key across `_quarto.yml`, the active profile file,
`_metadata.yml` and page front matter (details in the
[installation guide](installation.md#provider-settings-and-data-sent)); unknown
options, unsupported values and credential-like keys produce a render warning
and are ignored.

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

## Integrating another activity

Use `AIFeedback.attach({integration, id, button, output, getRequest})` for policy,
progression, settings, requests and rendering. `getRequest` should collect data
without executing code. Use `AIFeedback.contextMaterials({mode, refs, text})` for
context and `handle.reset('run')` on Run/Check. Call `handle.cancel({clearOutput:
true})` on edits and `handle.reset()` on explicit Reset. The consumer owns its
editor, checker and evidence boundary. [API reference](../docs/api.md).

The Quarto side exposes `feedback-quarto.lua`: a `markCallout` filter prepass,
`prepare(doc)` and `context(block, options, isPyodide)`. Consumers contain only
small dependency-discovery glue. All policy, context and feedback implementation
belongs here.


### Standalone example

`example.qmd` demonstrates this package with shared feedback. No additional Quarto extension is required. The example builds automatically on pushes and pull requests; download the `standalone-example` Actions artifact. Feedback defaults to copy mode, which needs no API key.

See [AI Feedback 0.8 policies](feedback-policies.md) for current policy syntax.
