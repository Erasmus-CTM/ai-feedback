# Teaching policies and progressive feedback

AI Feedback ships its default setup in
`_extensions/ai-feedback/feedback-defaults.yml`. The browser runtime includes a
generated copy, so rendering requires no extra YAML package or network request.
Keep the installed defaults unchanged; put course-specific overrides in local files.

## One file or several

For one file, add this to `_quarto.yml` or a standalone page's front matter:

```yaml
ai-feedback:
  policy-files: feedback.yml
```

For separate files, list them in order:

```yaml
ai-feedback:
  policy-files:
    - feedback/common.yml
    - feedback/math.yml
    - feedback/python.yml
    - feedback/pyodide.yml
    - feedback/plain-text.yml
```

Paths are relative to the Quarto project root, or to the standalone input page.
Missing files and malformed policies stop rendering with an explanation.
Each file has an `ai-feedback` mapping containing `defaults`, `integrations`, or
both. Later files override earlier values **within the same scope**. A new
`steps` list replaces that entire list; `steps: []` disables progression.

Use `policy-files` when combining policies: Quarto's ordinary `metadata-files`
merges arrays before filters run and can append or deduplicate steps. Existing
inline `ai-feedback.defaults` and `ai-feedback.integrations` metadata also work,
but their values have already undergone Quarto's normal metadata merging.

## Example local policy

```yaml
ai-feedback:
  defaults:
    max-words: 150
    reset-on-run: true
    allow-full-solution: false
  integrations:
    math-exercise:
      prompt: |
        Prefer the methods taught in this course.
        Use the learner's own notation.
      steps:
        - prompt: Ask one guiding question.
        - prompt: Explain the relevant concept without calculations.
        - prompt: Describe the method without finishing the exercise.
        - prompt: Give a worked solution and explain it.
          allow-full-solution: true
          max-words: 350
    py-exercise:
      reset-on-run: false
      steps:
        - prompt: Point out where the learner should look next.
        - prompt: Explain the problem without supplying finished code.
```

The other integration names are `pyodide-interaktiv` and `plain-text`. All four
support the same options. The number of steps is the length of the list, with a
maximum of 20. One step is valid; after the last step, later requests repeat it.

## Defaults and precedence

| Integration | Shipped behavior |
|---|---|
| `plain-text` | Review without a hint sequence; activity criteria still apply |
| `py-exercise` | Review without a hint sequence; assignment restrictions still apply |
| `math-exercise` | Four steps: question, concept, procedure, worked solution; 120 words |
| `pyodide-interaktiv` | Three increasingly detailed hints without finished code; 250 words |

The shipped behavior retains each integration's teaching approach. Its prompt
instructions are stored centrally in English; feedback is still written in the
integration's selected language unless the policy overrides `language`. UI,
source and response languages remain separate.

Effective settings use this precedence, lowest to highest:

1. Shipped common defaults.
2. Shipped integration defaults (and legacy `feedback-hints: false` for Pyodide).
3. Local common defaults, merged in file order.
4. Local integration settings, merged in file order.

Legacy inline policy metadata is the final project layer. New policy definitions should use external YAML files. Page files form a separate, higher-precedence layer. Integration-specific settings
win over common defaults regardless of which file contains them. A local `prompt`
replaces the prompt in that scope; the effective common and integration prompts
are both included. An explicit non-Python activity `max-issues` attribute overrides the policy limit.
Stable shared rules, assignment restrictions, authored activity
criteria, learner responses and eligible evidence remain separate from these
teaching instructions. Replacing a step list never inherits permissions from
steps in the old list.

Available policy fields:

| Field | Meaning |
|---|---|
| `prompt` | Author instructions for common or integration-specific feedback |
| `language` | Explanation language; otherwise inherited from the integration |
| `max-words` | Integer from 20 to 2000; shipped common default 250 |
| `max-issues` | Integer from 1 to 20; shipped common default 3 |
| `allow-full-solution` | Boolean; default false; true permits a complete response |
| `reset-on-run` | Boolean; default true; Run/Check restarts hints at step one |
| `steps` | Ordered list of mappings with a required `prompt`; empty means review mode |

Each step may also override `max-words`, `max-issues` and
`allow-full-solution`. The prompt must agree with its permissions. These are
instructions to a model, not a guarantee that a model obeys them.

## When the counter changes

A successfully displayed API reply or copy prompt advances that exercise's
counter. Failed, cancelled and stale requests do not. Editing preserves the
counter and invalidates old evidence. Run or Check resets it by default;
`reset-on-run: false` preserves progression. Explicit Reset always restarts it.
Loading a new mathematics pool task also restarts it.

Counters persist independently per page/exercise in the browser tab. Changing
the effective policy resets its saved progression, avoiding accidental reuse of
a final-step permission from a previous policy. Reset also cancels pending
feedback so a late reply cannot restore an old hint.

The shared runtime controls progression and prompt assembly. Integrations collect
only their task, current response, authored criteria and eligible prior evidence.
Feedback itself never executes Run or Check.

## Maintainers

After intentionally editing shipped defaults, run:

```sh
python scripts/sync-feedback-defaults.py
python scripts/sync-feedback-defaults.py --check
```

Generation uses PyYAML. Consumers load the single installed shared extension;
there are no fallback bundles to synchronize. The combined examples, builder
and pinned integration branches live in
[Erasmus-CTM/ctm-assessment](https://github.com/Erasmus-CTM/ctm-assessment).
Its builder copies `feedback.yml` and an optional `feedback/` directory.
Use ai-feedback 0.5.0 with the matching integration branches.

## Page scope and named exercise policies (0.6.0)

All new policy definitions live in external YAML files. An exercise may only
select an existing named policy inline; it cannot embed a policy mapping.
Existing inline document defaults/integrations remain supported for compatibility.
Named `policies` and `exercises` mappings are rejected in document front matter.

```yaml
# _quarto.yml
ai-feedback:
  policy-files: feedback/course.yml
```

```yaml
# A page's front matter; one path or an ordered list
ai-feedback:
  page-policy-files: feedback/chapter-3.yml
```

Paths in both lists are relative to the project root, including pages in nested
folders. For standalone documents, paths are relative to the input document.
There is no filename-based discovery: each file must be listed explicitly.

```yaml
# feedback/chapter-3.yml
ai-feedback:
  defaults:
    max-words: 160
  integrations:
    math-exercise:
      max-words: 100
  policies:
    short-hints:
      prompt: Prefer the methods taught in this chapter.
      reset-on-run: true
      steps:
        - prompt: Ask one guiding question.
        - prompt: Explain the relevant idea without a completed solution.
  exercises:
    math-exercise:
      quadratic-practice:
        max-words: 80
```

Select that reusable policy inside any code integration:

````markdown
```{math-exercise}
#| label: quadratic-practice
#| feedback-policy: short-hints
Solve $x+2=5$: $x=$ _[3].
```
````

For text/image activities, use `feedback-policy="short-hints"` on the
`.ai-feedback` Div. Its explicit `#id` is its exercise key. Python and mathematics
use their authored `#| label:`; use stable, unique labels within each integration
when configuring exercise-specific settings. Unlabelled exercises can select a
named policy but should not be targeted through generated IDs.

Precedence, lowest to highest:

1. Shipped common and integration defaults.
2. Project files: common defaults, then integration settings.
3. Page files: common defaults, then integration settings.
4. YAML exercise entries for the integration and authored ID/label, merged in
   project-file order followed by page-file order.
5. The named policy explicitly selected on that exercise.
6. The current step's permitted per-step settings.

Within each scope later files override earlier files. A page common setting can
override a project integration setting. Named definitions merge by name in file
order (project then page). Selecting a name does not automatically activate it
elsewhere. No named-policy inheritance or inline definitions are supported.

Scalars replace, omitted keys inherit, and `steps` replaces the entire list.
`steps: []` disables hints. Replacing steps never inherits old per-step solution
permissions. An exercise/named `prompt` replaces the effective integration prompt;
the effective common prompt and separate authored criteria still apply. Existing
explicit text-activity `max-issues` attributes retain their compatibility priority.
Unknown selected names, missing files and invalid fields stop rendering clearly.
Named and exercise policy entries must define at least one option; empty sections
are ignored. Use `steps: []` explicitly when requesting review without hints.

All integrations pass only the selection and authored exercise key to the shared
resolver. The resulting policy governs prompts, limits, steps and Run/Check
resets. Only a change to that exercise's effective policy resets its saved hint
counter; editing an unused named policy does not reset unrelated exercises.
