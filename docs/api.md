# API v1

The JavaScript global is `AIFeedback`. The headless `feedback-core.js` also
exports CommonJS for tests. No editor, checker, Python runtime or DOM is needed
to construct requests. The Quarto filter loads the runtime and shared UI.

```js
const client = AIFeedback.createClient({
  baseUrl: 'https://llm.hpc.ntnu.no/v1',
  model: 'moonshotai/Kimi-K2.6',
  apiKey: personalKey
});
const reply = await client.request(request, { signal: abortController.signal });
// { text: '...', format: 'markdown' }
```

## Request

| Property | Contract |
|---|---|
| `version` | Optional; must be `1` when supplied. |
| `task` | Required non-empty instruction string. |
| `profile` | `review` (default), `translation`, `language-quality`, `python`, `mathematics`. Supplies default criteria only. |
| `responses` | Array of `{id, value, format?, label?, language?}`. IDs are unique. `format` is `text`, `code`, `latex`, or `json`; value is always a string. Empty fields can accompany nonempty work. |
| `materials` | Optional array of `{id, role, text, language?}`. Role is `source`, `context`, or `reference`. Translation requires source material or a source image. |
| `attachments` | Optional array of `{id, role, label?, dataUrl}`. Role is `source`, `response`, or `context`. PNG/JPEG/WebP data URLs only. Maximum three images; 8 MiB each, 12 MiB combined. |
| `learner` | Optional `{level}`. A course label, not an implicit CEFR classification. |
| `criteria` | Optional string array overriding the profile defaults. |
| `evidence` | Optional array of `{label, text}` containing only assessment information the adapter permits the provider to see. Never pass the whole exercise/test configuration. |
| `feedback` | Optional teaching policy described below. |

At least one nonempty textual response or an image with role `response` is
required. A source image alone is not submitted work. A text-free handwriting
submission uses `responses: []` and an image with role `response`.

Unknown properties are omitted from the provider payload. Text requests are
limited to 100,000 characters independently of the image budget. No material
is silently truncated. Uploaded files and request bodies are not persisted.

`feedback` accepts:

- `language`: explanation language, default `en`; independent of UI, source
  and response languages. Quotations can retain their original language.
- `mode`: `review` (default) or `hints`.
- `maxIssues`: 1–20, default 3; `maxWords`: 20–2000, default 250.
- `allowFullRewrite`: boolean, default false. A teaching instruction, not a
  security boundary or a guarantee of model behavior.
- `steps`: explicit nonempty strings required for hint mode.
- `level`: 1-based step index, default 1.

An adapter can preserve an existing teaching policy, including mathematics'
fourth-step full solution, by setting the current step and rewrite permission.
The core does not infer progression from previous API calls.

## Prompt and transport

`AIFeedback.normalizeRequest(request)` returns a validated snapshot.
`AIFeedback.buildMessages(request)` returns system/user messages.
`AIFeedback.buildPrompt(request)` returns the copyable text from the same
builder. With images, it explicitly asks the learner to attach the original
files separately; image bytes are never placed in clipboard text.

`client.request(request, {signal})` validates, builds messages and sends them.
Provider settings live on the client, separately from learning content.
Requests have a 60-second deadline including response-body reading. Compatible
model controls may be negotiated; network errors, rate limits and server errors
are not blindly retried. Empty and truncated replies are rejected. Reasoning
tags cause one corrective retry. No Latin-only language heuristic applies to
the general API. Provider model names remain freely editable.

The advanced migration API `client.complete(messages, options)` uses the same
transport with caller-built messages. It preserves established subject prompts
without duplicating the provider client. `options.validate(text)` may return a
corrective instruction or a falsy value. It is called before and after one
corrective retry. `imageFallback: 'text'` explicitly permits a text fallback
for an optional illustration. The default rejects unsupported image requests;
activities relying on uploaded images must keep that default.

Errors are `FeedbackError` objects with a stable `code`: `INVALID_REQUEST`,
`CONFIGURATION`, `HTTP`, `NETWORK`, `TIMEOUT`, `ABORTED`, `EMPTY`, `TRUNCATED`,
`REASONING`, `VALIDATION`, `IMAGE_UNSUPPORTED`, or `COMPATIBILITY`.

## UI adapter

```js
const adapter = AIFeedback.attach({
  id: 'exercise-1',
  button: feedbackButton,
  output: feedbackPanel,
  getRequest: () => buildCurrentRequest(),
  // client: optional explicit client; otherwise use shared settings
  // uiLanguage: optional; defaults to document language
  // afterRender: optional callback for mathematical typesetting
});
adapter.cancel();
adapter.dispose();
```

`getRequest` may be asynchronous and must only collect a snapshot. It must not
execute learner code or have other side effects: it is called again to detect
edits during a pending request. The adapter increments hint state only after
a successful, current response (or copy prompt) is displayed. Hint state is
scoped to page path and activity ID in session storage. Review mode never
escalates. The adapter returns `request()`, `cancel()` and `dispose()` methods.

Institutions can set `ai-feedback: base-url:` and `model:` in project YAML.
These are defaults for the settings form; personal keys are never read from
document metadata. There are no bundled provider presets.

Call `AIFeedback.openSettings()` to open the single shared settings panel.
The same cogwheel beside every activity opens one dialog. Base URL, model,
key and mode are shared across all pages on the same browser origin through
one localStorage record by default; session storage is optional. Separate
domains cannot share browser storage. Legacy configurations are offered as
explicit import choices, never silently combined. Supported initial UI languages: English, German, Norwegian Bokmål
and Spanish; explanation languages remain unrestricted.

## Feedback rendering

Model replies render safe Markdown and inline/display LaTeX (`$...$`, `$$...$$`,
`\(...\)` and `\[...\]`). Math is typeset after insertion using a lazy-loaded
KaTeX module, including on pages without initial mathematical content. Code
spans/blocks and copy prompts stay literal. If the renderer cannot load, readable
TeX remains in place. `afterRender` runs after shared typesetting.

## Quarto authoring

Use a fenced Div with `.ai-feedback` and a unique ID. Supported attributes:
`profile`, `ui-language`, `response-language`, `feedback-language`,
`source-language`, `learner-level`, `max-issues`, `context`, `source`,
`image-upload="true"`, and `image-role`.

Within it, `.feedback-source` supplies visible original text;
`.feedback-criteria` supplies author-selected criteria to the feedback request
without displaying them in the learner's task. Multiple criteria blocks are
collected in order. These are client-side configuration, not confidential data;
`.feedback-starter` initializes the textarea. Remaining prose is the task.

`context="id1,id2"` references tagged context blocks. The canonical class is
`.ai-feedback-context`; `.ai-context` is a short alias and
`.math-exercise-context` is a permanent compatibility alias. Duplicate
IDs are included once, in reference order. Multiple alias classes on one block do not
duplicate it. `context="none"` disables learning context; an explicit `source`
still supplies the source required for the task. Without `context`, recent
section prose is collected at render time, capped at 1,500 Unicode characters
without splitting blocks. Explicit references share a 6,000-character budget.
Missing, untagged, empty or oversized context blocks are skipped with warnings.
An unavailable required translation source produces an error.

Lua preserves LaTeX before rendering. The browser resolver also recognizes the
legacy math metadata and supported MathJax/KaTeX source. UI controls, hidden
content and previous feedback are excluded. Material roles belong to each
reference, so the same tagged block may be context in one task and source in
another.

Adapters using `attach` may define `getRequest({hintLevel})`. The hint level is
frozen for a request and its final stale-response check. Use it to coordinate
step-dependent policy such as allowing a worked solution on step four. The
adapter compares the complete request, including feedback policy, before
rendering; cancellation during either asynchronous collection prevents success.

Since 0.3.0, `handle.cancel({clearOutput: true})` cancels quietly and keeps the
output empty even if network, snapshot collection or typesetting later finishes.
Adapters use this for edits, Reset and execution invalidation. No-argument
`cancel()` retains the visible cancellation notice. Neither consumes a hint.

## Layered policies (0.4.0)

Use `attach({integration: 'math-exercise', ...})` (or `plain-text`, `py-exercise`,
`pyodide-interaktiv`) to resolve shipped and local policies centrally. The adapter
supplies task, responses, domain criteria, evidence and its default explanation
language. `getRequest` no longer needs to choose a hint level or permission.

`handle.reset('run')` quietly cancels pending feedback and resets the counter when
`reset-on-run` is true. Call it at the start of Run/Check. `handle.reset()` always
restarts the sequence; call it on explicit Reset/new pool task. Edits should use
`cancel({clearOutput: true})` and invalidate evidence without resetting progression.

`resolvePolicy(integration, language, legacyDefaults, configuration)` resolves a
policy; `applyPolicy(integration, request, hintLevel, legacyDefaults)` applies it.
Legacy defaults exist for Pyodide's `feedback-hints: false`; local YAML overrides
them. Do not copy teaching prompts into adapters. See [policy authoring](feedback-policies.md).

## Shared context and Quarto preparation

`AIFeedback.contextMaterials({mode, refs, text})` returns request materials.
`mode` is `auto`, `none` or `explicit`; `refs` is a comma-separated list of
tagged element IDs; `text` is the source-filter snapshot for automatic context.
All integrations use this API.

`feedback-quarto.lua` exposes `markCallout` (a Quarto Callout prepass),
`prepare(doc)` (idempotent document preparation/resource registration), and
`context(block, options, isPyodide)` (the shared context descriptor). The module
uses its installed directory for resources. A consumer's small loader locates
the project installation; it must run preparation before converting code cells.
