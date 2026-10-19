# Reference

[Start here](../README.md) · [API](api.md) · [Installation](installation.md)

Course authors read the same settings in the CTM Assessment guide; this page
is the library's own reference.

## Settings

CTM settings live in four sections of the Quarto metadata:

| Section | Keys |
|---|---|
| `ctm-assessment` | `stop-after` (seconds before a running check offers Stop, default 20), `lang` (the language of every component) |
| `ai-feedback` | `mode` (`copy`, `api`), `storage` (`local`, `session`), `base-url`, `model`, `ui-language`, `feedback-language`, `enabled`, `policy-files`, `policy` |
| `math-exercise` | `lang`, `feedback` (`auto`, `true`, `false`), `stop-after` |
| `py-exercise` | `lang`, `feedback`, `stop-after`, `forbidden-imports`, `forbidden-keywords`, `submission`, `submission-key`, `show-test-hints` |

Settings combine **key by key** across `_quarto.yml`, the active profiles'
`_quarto-<profile>.yml` (with several profiles the first listed wins, as in
Quarto), `_quarto.yml.local`, the `_metadata.yml` files from the project root
to the page's folder, and the page's front matter. A page that sets one key
of a section keeps the project's other keys of that section. For a key:

| Step | Source |
|---|---|
| 1 | the page's front matter |
| 2 | Quarto's merged metadata: `metadata-files`, `format: html:` scoped settings, notebooks, `-M`; it holds the key unless the page's own map of the section dropped it |
| 3 | `_quarto.yml`, profiles, `_quarto.yml.local`, `_metadata.yml` (the nearest wins) |
| 4 | `stop-after` and `lang` only: steps 1–3 for `ctm-assessment` (a component's own spelling wins at any level) |
| 5 | `lang` only: Quarto's `lang` |
| 6 | the default |

Two exceptions: `ai-feedback: enabled` is off when any level turns it off
(below), and the policy keys follow their own rules ([policies](feedback-policies.md#load-definitions-then-select)).

Checks at render time:

- A key that looks like a credential (`api-key`, `apikey`, `key`, `token`,
  `secret`, `password`, `authorization`, in any CTM section and at any level)
  **stops the render**: Quarto metadata is published with the site. Remove
  the key; learners enter their own key in the Feedback settings. ctm-libs'
  messages never repeat the value, but Quarto itself may print the page's
  metadata, key included, when a single-file render fails.
- Unknown `ai-feedback` and `ctm-assessment` options warn and are ignored;
  they become errors in CTM Assessment 1.0. `version` is not an option.
- `mode`, `storage` and `base-url` values that cannot be used warn and fall
  back to the default (a rejected URL is never repeated).
- Values that were accepted loosely before 0.9 (`py-exercise: submission`,
  `show-test-hints`, `feedback` other than true/false; a component section
  that is not a mapping) warn; other wrong values stop the render, naming the
  key and the file.

## Languages

A component's interface language is its own option (`math-exercise: lang`,
`py-exercise: lang`, `ai-feedback: ui-language`), then `ctm-assessment: lang`,
then Quarto's `lang`, then English; then the first language of the tag's
chain that the component has: `nb-NO` → nb; `no` → nb; `nn` → nn, nb;
`de-CH` → de; anything else → en. Every component speaks English, German and
Norwegian Bokmål; the feedback interface also Spanish. The feedback's own
language (`feedback-language`) is passed to the AI as written, from the
activity, `ai-feedback: feedback-language`, `ctm-assessment: lang` or `lang`.

## A site without AI feedback

One source can build a site without AI feedback, for exams or institutions
that do not allow it:

```yaml
# _quarto-no-ai.yml, then: quarto render --profile no-ai
ai-feedback:
  enabled: false
```

or `CTM_FEEDBACK=off quarto render` (other values than `off` and `on` warn).
Any level can turn AI feedback off; no page can turn it back on. Then:

- no Feedback buttons, no settings gear, no ai-feedback scripts or styles;
- `.ai-feedback` activities keep their visible task (and source text) as an
  `.ai-feedback-task` block, without answer box or button;
- criteria, starters, teaching policies and learning context are not written
  into the HTML; policy files are still checked, so both builds fail alike;
- a page that asked for feedback gets one build message naming what was left
  out (its activities, the exercises and cells whose feedback a component
  left out, or its own `ai-feedback: enabled: true`); a project-wide
  `enabled: true` is not repeated on every page, and pages without AI content
  stay quiet. It is never an error.

pyodide-interaktiv 1.8 reads its own `pyodide: feedback`; ctm-libs sets it to
false when its filter runs before pyodide-interaktiv's (the package order, or
`filters: [ai-feedback, pyodide-interaktiv]`). Components released before
CTM Assessment 0.9 do not know the switch when they run outside the package:
pyodide-interaktiv 1.8 listed before ctm-libs (`filters: [pyodide-interaktiv,
ai-feedback]`), math-exercise 0.9 and py-exercise 0.3 (whose
`__pyExerciseConfig.feedback` stays true) keep their Feedback buttons, which
their scripts disable with a note that ai-feedback is missing; nothing of AI
feedback is loaded or written into the page.

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
over-budget references are skipped with a browser-console warning. Since 0.9.0
the listed blocks are followed by the prose of the exercise's own section
(since its heading), without the listed blocks, so the task's data in the
prose reaches the feedback too; the 1,500-character cap counts that prose
only.

Reusable tagged blocks can be referenced by any integration. See the
[combined authoring examples](https://github.com/Erasmus-CTM/ctm-assessment/blob/main/docs/reference.md#reuse-one-block-across-different-integrations).

## Prompts, hints and local YAML

Shipped defaults are always available. Loading `policy-files` only registers
named definitions; select a baseline with `policy`, or select
`feedback-policy` on an exercise.

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
  policy-files: feedback.yml
  policy: brief-feedback
```

A child inherits omitted fields. A supplied `steps` list replaces the complete
inherited sequence; `steps: []` selects review without hint progression.
`base-prompt` applies throughout, while `step-prompt` adds the current step's
instructions. Step limits and permissions override the policy for that step.

Successful feedback advances one step; the last repeats. Failed, cancelled or
stale requests consume no step. Run/Check resets by default; select a policy
with `reset-on-run: false` to preserve progression. Changing the effective policy
resets saved progress. See the [complete policy guide](feedback-policies.md)
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

Options combine key by key across `_quarto.yml`, the active profiles,
`_quarto.yml.local`, `_metadata.yml` and page front matter ([settings](#settings)).
Unknown options and unsupported values warn and are ignored; a
credential-like key stops the render.

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
editor, checker and evidence boundary. [API reference](api.md).

The Quarto side is `ctm.feedback` ([API](api.md#ctmfeedback)): `markCallout`
(a Callout pass), `prepare(doc)`, `selection(block, options)` and
`context(block, options, isPyodide)`. Components load ctm-libs through their
`ctm-bootstrap.lua`; all policy, context and feedback implementation is here.

### Standalone example

`example.qmd` demonstrates the library with AI feedback activities
(`filters: [ctm-libs]`). The example builds on pushes and pull requests;
download the `standalone-example` Actions artifact. Feedback defaults to copy
mode, which needs no API key.
