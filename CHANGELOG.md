# Changes

## 0.9.0 (CTM Assessment 0.9.0)

The ai-feedback repository becomes **ctm-libs**, the internal library of CTM
Assessment: AI feedback folds into it, and it takes over what the components
shared or copied (settings, languages, the Python runtime, the dependency
locator). Course authors install CTM Assessment only.

### Changed for authors

- **Settings combine key by key in every CTM section** (`ai-feedback`,
  `ctm-assessment`, `math-exercise`, `py-exercise`): a page that sets one
  option of a section keeps the project's other options of that section
  (F-79). Before, a page's own `math-exercise:` map dropped the project's
  `feedback` and `stop-after`.
- **A credential in the metadata stops the render** (`api-key`, `token`,
  `secret`, ... in any CTM section; A1). It was a warning.
- **Two policy keys** (A2): `policy-files` adds up over project, profiles,
  `_metadata.yml` and page; `policy` selects, the nearest setting winning.
  `project-policy`, `page-policy` and `page-policy-files` keep working in 0.9
  with a warning each.
- **Unknown `ai-feedback:` and `ctm-assessment:` options** warn that they
  become errors in 1.0 (A3); `version:` is not an option (A7).
- **Explicit context also sends the section's prose** (A5): with
  `context: notes`, the feedback request holds the listed blocks and then the
  prose of the exercise's own section, without context blocks (the listed
  ones come first, the others belong to other exercises).
- **The AI context stays in the exercise's tab and leaves out `<details>`**,
  for automatic and explicit context alike: a tab of a tabset starts a
  section as a heading does (nested tabsets too), and after a tabset its
  section goes on without the tabs' prose; the content of `<details>` blocks
  (solutions, reading steps, hints) is never sent. Before, automatic context
  could carry other tabs' prose and closed solutions. This changes what a
  feedback request contains, not grading.
- **A site without AI feedback** (P22): `ai-feedback: enabled: false` (for
  example in a profile) or `CTM_FEEDBACK=off`. No page can turn it back on;
  nothing of AI feedback reaches the HTML; pages that asked for it get one
  build message.
- **New key `ctm-assessment: lang`**: the interface language of every
  component. Pages in Nynorsk (`nn`) get the Bokmål interface; region tags
  are understood everywhere (`de-CH` → German).
- **Scripts are cacheable files**: the runtime, the catalogues and the
  feedback files are HTML dependencies, loaded once per page.
- **`filters: [ai-feedback]` is deprecated**: it keeps working in 0.9 with
  one build warning. Use `filters: [ctm-assessment]`.
- **Pyodide 0.28.3** (Python 3.13, SymPy 1.13.3 as before) for the page's
  Python runtime, the version pyodide-interaktiv already uses (D4). On pages
  with pyodide-interaktiv the components use its Python, so a project that
  pins `pyodide: base-url` keeps that version there.
- **A component without CTM Assessment stops** with the install command
  (components' `ctm-bootstrap.lua`; `CTM_COMPONENT_DEV=1` for component
  development).
- Values that were accepted loosely (`py-exercise: submission`,
  `show-test-hints`, `feedback`; a component section that is not a mapping)
  warn that they become errors in 1.0.

### Unchanged

- The `ai-feedback:` section, `.ai-feedback` activities, teaching-policy
  files, the settings dialog and its browser storage ("Remember on this
  device" stays the default; A4).
- The browser API `AIFeedback` (its version is now ctm-libs' version) and
  the policy configuration it reads.
- The Python runtime's interface (`MathExerciseRuntime`).

### For maintainers

- `_extensions/ctm-libs`: `lua/ctm.lua` (the page's instance), `settings`,
  `locale`, `feedback`, `policy`, `runtime`, `deps`; `read-settings.ts` (the
  generalized `read-policies.ts`); `runtime/pyodide-runtime.js` (moved from
  math-exercise, byte-identical at first); `locales/` (`CTMLocales` and the
  catalogues `common`, `math-exercise`, `py-exercise` with Bokmål, `feedback`).
- `bootstrap/ctm-bootstrap.lua`: the file components copy byte for byte.
- `ctm-libs-end.lua`: listed last by the package, prints the page's build
  message about AI feedback left out.
- `_extensions/ai-feedback`: alias for 0.9.x (`feedback-quarto.lua` for
  older components' loaders, `ai-feedback.lua` for `filters: [ai-feedback]`).
- `scripts/sync-feedback-defaults.py` also generates the feedback interface
  strings from `locales/feedback.js` and keeps every version in step;
  `scripts/check-locales.py` checks the catalogues.
- Package `@erasmus-ctm/ctm-libs`.
