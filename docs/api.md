# ctm-libs API

For maintainers of CTM components. Course authors never use ctm-libs
directly: they install CTM Assessment, which bundles it.

- [Loading ctm-libs from a component](#loading-ctm-libs-from-a-component)
- [Lua: ctm.settings](#ctmsettings) · [ctm.locale](#ctmlocale) ·
  [ctm.feedback](#ctmfeedback) · [ctm.runtime](#ctmruntime) · [ctm.deps](#ctmdeps)
- [Browser: dependencies and globals](#browser-dependencies-and-globals) ·
  [CTMLocales](#ctmlocales) · [MathExerciseRuntime](#mathexerciseruntime) ·
  [AIFeedback](#aifeedback-api-v1)

## Loading ctm-libs from a component

A component copies [`bootstrap/ctm-bootstrap.lua`](../bootstrap/ctm-bootstrap.lua)
next to its filter, byte for byte (the CTM Assessment build compares the
copies), and loads the page's instance with it:

```lua
local ctm = dofile(quarto.utils.resolve_path("ctm-bootstrap.lua"))("math-exercise")
```

The bootstrap

1. requires the CTM Assessment package: a `ctm-assessment` extension next to
   the component (the package layout) or in the project's `_extensions`
   (also under an owner folder). Without it the render stops with
   `Install CTM Assessment: quarto add https://erasmus-ctm.github.io/ctm-assessment/ctm-assessment.tar.gz`.
   Component development builds and component CI set `CTM_COMPONENT_DEV=1`
   to build against a ctm-libs installation without the package;
2. finds ctm-libs next to the component first (`_extensions/ctm-libs` in the
   package, or the same owner folder), then in the project's `_extensions`
   (`ctm-libs` or `<owner>/ctm-libs`; the nearest `_extensions` for a
   single file), and stops with the same install command when there is none;
3. checks the interface level (`ctm.api >= 1`).

Every filter of a page gets the same instance (`_G.__ctmLibs`); a page that
would combine two installations of different versions stops. The instance
has `ctm.dir`, `ctm.version`, `ctm.api`, `ctm.path(...)` (absolute path of a
file of the installation) and `ctm.filters()` (the passes of the
`ctm-libs` filter: Meta, Callout, Pandoc). Modules load on first use.

Rules inside ctm-libs: paths only from its own installation (never
`quarto.utils.resolve_path` or relative dependency paths, which resolve
against the running component); HTML only (neutral values for other
formats); authoring errors stop the render with `assert(false, message)`.

### ctm.settings

Every CTM section (`ai-feedback`, `ctm-assessment`, `math-exercise`,
`py-exercise`) is read key by key from `_quarto.yml`, the active profiles
(the first listed wins), `_quarto.yml.local`, the `_metadata.yml` files from
the project root to the page and the page's front matter, plus Quarto's
merged metadata ([precedence](reference.md#settings)). A page that sets one
key of a section keeps the project's other keys.

```lua
ctm.settings.load(meta)                          -- every entry point, once per page (the first call counts)
ctm.settings.get(section, key, opts)             -- value, origin, section
ctm.settings.string(section, key, opts)          -- lists are joined, as pandoc.utils.stringify did
ctm.settings.bool(section, key, opts)            -- true/false or "true"/"false"; else stops, naming key and origin
ctm.settings.number(section, key, opts)          -- opts.positive (> 0), opts.unit ("seconds") for the message
ctm.settings.choice(section, key, values, opts)  -- one of values; true/false count as "true"/"false"
ctm.settings.list(section, key, opts)            -- YAML list or comma-separated string -> trimmed strings
ctm.settings.policies()                          -- {json = "<browser policy configuration>", names = {[name] = true}}
```

`opts.default` is the value when the key is unset; `opts.shared` falls back
to `ctm-assessment.<key>` (for `stop-after` and `lang`; a component's own
spelling wins at any level); `opts.loose` (bool) warns and uses the default
instead of stopping, for values that were accepted loosely before 0.9.
`origin` names the file (`_quarto.yml`, `chapter/_metadata.yml`,
`chapter/page.qmd`) or `document metadata`.

The reader (`read-settings.ts`, one `quarto run` per page) starts on the
first value asked for, and only on HTML pages whose metadata has a CTM
section; without one every value is its default. Its warnings print once;
its errors stop the render in one message.

### ctm.locale

One resolver and one message catalogue ([`locales/`](../_extensions/ctm-libs/locales)).

```lua
local lang, tag, origin = ctm.locale.resolve("py-exercise")   -- "nb", "nn", "page.qmd"
ctm.locale.text("py-exercise", "noscript", lang)              -- a string (or data); extra arguments fill {placeholders}
ctm.locale.use("py-exercise")                                 -- HTML dependencies ctm-locale and ctm-locale-py-exercise
ctm.locale.supported("feedback")                              -- {"en", "de", "nb", "es"}
ctm.locale.tag("ai-feedback", "feedback-language")            -- the raw tag of an option, through ctm-assessment: lang and lang
ctm.locale.language("feedback", "de-CH")                      -- "de": the first language of the chain the catalogue has
ctm.locale.normalize("nb-NO"), ctm.locale.chain("nn")         -- "nb"; {"nn", "nb", "en"}
```

A component's language is its own option (`math-exercise: lang`,
`py-exercise: lang`; `ai-feedback: ui-language` for `"ai-feedback"`), then
`ctm-assessment: lang`, then Quarto's `lang`, then `en`; then the first
language of that tag's chain the namespace supports (`nb-NO` → nb, en;
`no` → nb; `nn` → nn, nb, en; `de-CH` → de, en). A text a language lacks
falls back to English with one build warning.

### ctm.feedback

```lua
ctm.feedback.prepare(doc)                         -- idempotent page preparation (loads the settings itself)
ctm.feedback.markCallout(callout)                 -- Callout pass: hidden callouts never reach a feedback context
ctm.feedback.selection(block, opts)               -- {exercise = label or id, name = feedback-policy}
ctm.feedback.context(block, opts, isPyodide)      -- {mode = auto|explicit|none, refs, text}
ctm.feedback.enabled()                            -- true, or false and the reason (P22)
ctm.feedback.request(component, wanted, origin)   -- wanted and enabled; a refused wish is named in the page's build message
ctm.feedback.flush()                              -- prints that message now (ctm-libs-end.lua; the package lists it last)
```

`prepare` registers the `ai-feedback` dependency, `window.__aiFeedbackConfig`
and `window.__aiFeedbackPolicies`, turns `.ai-feedback` activities into
`.ai-feedback-activity` with their data, and records for every code cell the
prose of its section (`data-ai-feedback-context`) before components convert
the cells. With an explicit context the context blocks are left out of that
prose (A5). `selection` and `context` need the page's settings: call them
after `prepare` or after `ctm.settings.load`.

Without AI feedback (P22: `ai-feedback: enabled: false` or `CTM_FEEDBACK=off`)
`prepare` writes nothing of AI feedback, `selection` still checks the policy
name and leaves it out, `context` returns mode `none`, and the Meta pass sets
`pyodide: feedback: false` for pyodide-interaktiv 1.8. A component asks with
`request("math-exercise", wanted, "feedback: true in _quarto.yml")`, and only
for blocks that are on the page; whatever a page asked for but did not get
(those requests, its exercises that only AI feedback can assess, its pyodide
cells under an explicit `pyodide: feedback: true`, its own
`ai-feedback: enabled: true`) is listed in one build message per page. The
package prints it from `ctm-libs-end.lua`, which it lists after every CTM
filter, including any that runs at a later `at:` stage; elsewhere the message
is printed when Pandoc closes the page's Lua state. A CTM filter running after
the end filter that leaves out something new produces a second message (from
that fallback).

Exercises that only AI feedback can assess (activities; math-exercise in
`mode: custom` without a checker; py-exercise without tests; reference.md)
are found by `prepare`'s walk, before the components see their blocks, and
handled by `ai-feedback: without-ai` (`policy.withoutAI()`,
`policy.withoutAIAction()` in `lua/policy.lua`): `text` (and `self-check`,
for now) replaces each by its question with a localized note
(`common.withoutAI`), `drop` removes it, and unset makes `flush()` stop the
build with one error naming them all. Components need no code of their own
for it. The end filter announces itself when Quarto loads it
(`_G.__ctmLibsEnd`); where it is not listed, `prepare` stops the page
itself.

### ctm.runtime

```lua
ctm.runtime.use()                      -- HTML dependency ctm-runtime (runtime/pyodide-runtime.js, head)
ctm.runtime.stopAfter("py-exercise")   -- seconds before a running check offers Stop: <component>: stop-after,
                                       -- ctm-assessment: stop-after, 20
```

### ctm.deps

```lua
ctm.deps.installed("jsxgraph")             -- next to ctm-libs, or in the project's _extensions
ctm.deps.uses(doc)                         -- {["ai-feedback"] = true, jsxgraph = true} for the page's blocks
ctm.deps.requireUsed(doc, "math-exercise") -- stops with the install command when .jsxgraph blocks lack JSXGraph
ctm.deps.html{name = ..., scripts = {"locales/common.js"}}  -- add_html_dependency with files of ctm-libs
```

## Browser: dependencies and globals

| Dependency (stable name) | Files (head) | Registered by | Global |
|---|---|---|---|
| `ctm-locale` | `locales/ctm-locale.js`, `locales/common.js` | `ctm.locale.use()` | `CTMLocales` |
| `ctm-locale-<namespace>` | `locales/<namespace>.js` | `ctm.locale.use(namespace)` | (adds the catalogue) |
| `ctm-runtime` | `runtime/pyodide-runtime.js` | `ctm.runtime.use()` | `MathExerciseRuntime` |
| `ai-feedback` | `feedback/feedback-core.js`, `feedback-dom.js`, `ai-feedback.js`, `ai-feedback.css` | `ctm.feedback.prepare` (when on) | `AIFeedback` |

All carry ctm-libs' version. Quarto keeps one dependency per name, so each
file loads once per page whatever the mix of components, as a cacheable file
(inlined only with `embed-resources`). Configuration objects stay inline
before the body: `window.__aiFeedbackConfig`, `window.__aiFeedbackPolicies`.

### CTMLocales

```js
CTMLocales.add(namespace, catalogue)        // what each locales/<namespace>.js does
CTMLocales.table('math-exercise', 'nb')     // compiled messages: strings, data and functions (L.resPartial(50))
CTMLocales.t('py-exercise', 'allPassed', 'de', 3)
CTMLocales.resolve('py-exercise', 'nn')     // 'nb'
CTMLocales.normalize('nb-NO'); CTMLocales.chain('nn'); CTMLocales.languages('feedback')
```

A key a language lacks falls back to English, with one console warning per
table. Catalogue entries: a string (may hold HTML), data (arrays, objects
without `$` keys), `{"$ref": "common.stop"}`, `{"$t": "Row {row}", "$args":
["row"]}` (optionally `"$lookup": {"form": "formNames"}`, a data entry with a
`"*"` default), and plurals `{"$args": ["n"], "$plural": "n", "one": "...",
"other": "..."}` (`one` when the argument is exactly 1). See
[development](development.md#messages) for adding messages.

### MathExerciseRuntime

The page-wide Python runtime (Pyodide from jsDelivr, or pyodide-interaktiv's
worker when that is on the page): `indexURL`, `loadTimeout`, `loadScript`,
`ensurePyodide`, `installModule`, `forgetModules`, `ensureGuard`, `canStop`,
`stop`, `stopCount`, `whenSlow`. A copy with this interface replaces an older
one that loaded first.

## AIFeedback (API v1)

The JavaScript global is `AIFeedback` (version = ctm-libs' version). The
headless `feedback-core.js` also exports CommonJS for tests. No editor,
checker, Python runtime or DOM is needed to construct requests.

```js
const client = AIFeedback.createClient({
  baseUrl: 'https://llm.hpc.ntnu.no/v1',
  model: 'moonshotai/Kimi-K2.6',
  apiKey: personalKey
});
const reply = await client.request(request, { signal: abortController.signal });
// { text: '...', format: 'markdown' }
```

### Request

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

### Prompt and transport

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

### UI adapter

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

### Feedback rendering

Model replies render safe Markdown and inline/display LaTeX (`$...$`, `$$...$$`,
`\(...\)` and `\[...\]`). Math is typeset after insertion using a lazy-loaded
KaTeX module, including on pages without initial mathematical content. Code
spans/blocks and copy prompts stay literal. If the renderer cannot load, readable
TeX remains in place. `afterRender` runs after shared typesetting.

### Quarto authoring

Use a fenced Div with `.ai-feedback` and a unique ID. Supported attributes:
`profile`, `ui-language`, `response-language`, `feedback-language`,
`source-language`, `learner-level`, `max-issues`, `context`, `source`,
`image-upload="true"`, and `image-role`. `ui-language` goes through the
language chain (`de-CH` → de); `feedback-language` is passed as written.

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
without splitting blocks. The section is the innermost heading or tab (a tab
of a tabset starts one, as a heading does). The content of `<details>` blocks
and collapsed callouts (solutions, reading steps, hints) is not sent as
section prose; blocks an exercise lists explicitly are still sent, and an
exercise inside such a block gets its text. Explicit references share a
6,000-character budget; since 0.9.0 they are followed by the section's own
prose, without context blocks (the listed ones are sent on their own, the
others belong to other exercises), under the same 1,500-character cap.
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

### Explicit policies

Use `attach({integration: 'math-exercise', ...})` (or `plain-text`, `py-exercise`,
`pyodide-interaktiv`) to resolve shipped and local policies centrally. The adapter
supplies task, responses, domain criteria, evidence and its default explanation
language. `getRequest` no longer needs to choose a hint level or permission.

`handle.reset('run')` quietly cancels pending feedback and resets the counter when
`reset-on-run` is true. Call it at the start of Run/Check. `handle.reset()` always
restarts the sequence; call it on explicit Reset/new pool task. Edits should use
`cancel({clearOutput: true})` and invalidate evidence without resetting progression.

`resolvePolicy(integration, language, runtimeOptions, configuration, selection)`
returns an independent effective policy. `configuration` contains ordered
`layers`/`pageLayers` of named `policies` and targeted `exercises`, plus explicit
`projectPolicy`/`pagePolicy` names or integration selector maps. `selection` is
`{exercise: labelOrId, name: policyName}`. Loading definitions alone has no effect.

`applyPolicy(integration, request, hintLevel, runtimeOptions, selection)` applies
the active base instructions, step instructions, limits and permissions.
`runtimeOptions` supplies integration defaults (for example Pyodide's
`feedback-hints: false` contributes `steps: []`); explicitly selected YAML
policies can override them. `explainPolicy(integration, language, configuration,
selection, runtimeOptions)` returns the effective policy and named scope chains
for author-facing summaries. Adapters pass `policySelection` and `policyDefaults`
to `attach` rather than copying teaching prompts. See [policy authoring](feedback-policies.md).

### Shared context

`AIFeedback.contextMaterials({mode, refs, text})` returns request materials.
`mode` is `auto`, `none` or `explicit`; `refs` is a comma-separated list of
tagged element IDs; `text` is the section prose collected at render time.
`auto` sends the prose; `explicit` sends the listed blocks (6,000-character
budget) followed by the prose of the exercise's own section without context
blocks (0.9.0); `none` sends nothing. All integrations use this API; the Lua
side is `ctm.feedback` (above).

### JSXGraph visual context

Plain-text activities may mix tagged text and explicit diagram references:
`context="lesson, jsxgraph:diagram-id"`. The math-exercise integration supports
the equivalent `#| context:` option from version 0.8.0. `context="none"` still
disables context; a nearby diagram is never attached implicitly.

The iframe must use `assessment_id="diagram-id"` and register its board, a JSON
`response` provider describing current state, and `ai: {render: true}` using
`JXG.QuartoAssessment.register`. The selected board image and state are context;
they do not replace the learner's typed response. Include all relevant changing
geometry and view bounds in the state. Missing boards, failed exports, or state
over 1 MiB fail visibly rather than sending incomplete context. Existing image
size/count limits also apply. No images are saved in browser storage.

Custom adapters opt in with `attach({contextRefs: () => refs, ...})`. The shared
adapter collects `jsxgraph:` references asynchronously before sending and again
when checking for an obsolete response. `contextMaterials` continues to collect
text references; `collectVisualContexts(refs)` returns `{materials, attachments}`
for explicit lower-level integrations. Duplicate diagram references are included
once. Message replies must match the iframe window, protocol, version, request
ID and assessment ID. In copy mode, the UI exposes image previews and download
links so the learner can attach them in their chat.
