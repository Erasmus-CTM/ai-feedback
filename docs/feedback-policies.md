# Explicit teaching policies

AI Feedback 0.8 uses `base-prompt` for instructions throughout an activity and
`step-prompt` for the current feedback step. The old `prompt` key is rejected
with a migration message. Fixed shared instructions and authored exercise
criteria remain separate from configurable teaching instructions.

## Load definitions, then select

Loading YAML files registers definitions without activating them. Paths are
relative to the project root (or the standalone document). Files contain an
`ai-feedback` mapping with `policies` and optional `exercises` sections.

```yaml
# feedback.yml
ai-feedback:
  policies:
    guided-practice:
      base-prompt: Preserve the learner's notation and use the course methods.
      max-words: 160
      steps:
        - step-prompt: Ask one guiding question.
        - step-prompt: Explain the relevant idea without finishing the exercise.
    brief-practice:
      extends: guided-practice
      max-words: 80
    worked-review:
      extends: guided-practice
      steps:
        - step-prompt: Give a complete worked explanation.
          allow-full-solution: true
          max-words: 250
```

Select explicitly in Quarto metadata:

```yaml
ai-feedback:
  policy-files: feedback.yml
  project-policy: guided-practice
```

A page can load additional definitions and explicitly change its baseline:

```yaml
ai-feedback:
  page-policy-files: feedback/chapter.yml
  page-policy: brief-practice
```

Policy selections are read from project configuration, active profile files,
directory `_metadata` files and page front matter (both `.yml` and `.yaml`
configuration filenames are supported). Use these sources for policy selectors
rather than CLI metadata or native `metadata-files`.

Both file options accept one path or an ordered list. A file name has no special
meaning. `page-policy-files` alone never changes the page baseline. No automatic
`defaults` or `integrations` sections are accepted in authored policy files or
inline metadata. The installed `feedback-defaults.yml` is the internal shipped
baseline, not an authored override file.

Select a specialization on one exercise with `#| feedback-policy: worked-review`.
For text activities use `feedback-policy="worked-review"` on the `.ai-feedback`
Div. Without a selection, the effective integration baseline remains active.

Project/page selections can instead map integration names to policies:

```yaml
ai-feedback:
  policy-files: feedback.yml
  page-policy:
    default: guided-practice
    math-exercise: brief-practice
```

The `default` selection applies first, followed by the selected integration.
Supported integration names are `plain-text`, `math-exercise`, `py-exercise` and
`pyodide-interaktiv`. A map's common base instructions and its integration base
instructions are both included; a scalar selection replaces the integration base.

## Inheritance and precedence

Each named policy has at most one parent. Parent definitions may appear before
or after children. Unknown parents and cycles fail rendering, even when the
invalid policy is unused. Definitions with the same name merge field by field
in project-file order followed by page-file order. An omitted parent retains an
earlier declaration; `extends: null` explicitly removes that named-parent link.

A policy with no parent inherits the effective integration settings at its point
of application. A parent chain contributes only its supplied fields; it does not
freeze defaults or discard lower-scope settings. A reusable policy therefore
inherits the appropriate defaults for whichever integration selects it.

Resolution order is:

1. Shipped common/integration defaults and integration runtime options.
2. Explicit `project-policy` selection(s).
3. Explicit `page-policy` selection(s).
4. Matching YAML exercise-ID overrides.
5. The exercise's explicitly selected `feedback-policy`, including its ancestry.
6. The current step's settings.

To target a stable authored label without repeating a selection:

```yaml
ai-feedback:
  exercises:
    math-exercise:
      quadratic-practice:
        max-words: 90
```

This applies only to that integration and label; it is not a page-wide override.
Text activities use their explicit Div ID. Code activities use `#| label:`.

## Fields and replacement rules

| Field | Meaning |
|---|---|
| `extends` | One named parent; only inside named policies; null clears parent |
| `base-prompt` | Integration instructions; replaces the inherited base string |
| `language` | Feedback explanation language, independent of UI/response languages |
| `max-words` | Integer 20–2000 |
| `max-issues` | Integer 1–20 |
| `allow-full-solution` | Boolean permission for a full solution; defaults false |
| `reset-on-run` | Whether Run/Check restarts progression; defaults true |
| `steps` | Complete sequence, maximum 20 steps; empty selects review mode |

Omitted values inherit. Scalars replace. Supplying `steps` replaces the whole
list: no appending, padding, or merging corresponding steps. Old per-step
permissions disappear with the replaced list. Each step requires `step-prompt`
and may override `max-words`, `max-issues`, and `allow-full-solution`.

The final request combines fixed shared instructions, authored criteria, the
resolved base instructions, and only the current step's instructions. Replacing
the step list does not replace the base prompt. Explicit text-activity
`max-issues` attributes retain priority over policy limits.

Shipped mathematics has four steps (question, concept, procedure, worked
solution), Pyodide has three hints, and text/Python exercises start in review
mode. The resulting step count is exactly the final list's length. Later
requests repeat the final step. A successful displayed reply or copy prompt
advances progress; failed, cancelled or stale requests do not. Edits preserve
progress. Explicit Reset always restarts it. Changed effective parent settings
reset dependent counters; changing an unused policy does not.

The example policy disclosure shows selected scopes and parent chains plus the
resolved step count, per-step limits/permissions and base instructions. The raw
YAML below is the input definition, not a claim that every displayed policy is
active.

## Migration and maintenance

Rename policy `prompt` to `base-prompt`, and step `prompt` to `step-prompt`.
Move authored automatic defaults/integration overrides into named policies and
select them explicitly using `project-policy` or `page-policy` (use integration
maps when scope-specific behavior is needed). There are no old spelling aliases.

After editing shipped defaults run `python scripts/sync-feedback-defaults.py`;
CI checks generated/browser defaults agree with the YAML. All consumers use the
single installed shared extension. Test adapters and runtime behavior in the
CTM Assessment umbrella before adopting changes in course sites.
