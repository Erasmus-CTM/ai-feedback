# Handoff: Erasmus-CTM/ctm-libs (shared library)

main `a4777b1` (21 Oct). Holds: ctm-bootstrap.lua (copied into components by script), settings/locale/catalogue, feedback (`ctm.feedback`, no-AI policy `ai-feedback: without-ai:` = unset→stop / text / self-check / drop; drop never a default), MathExerciseRuntime + CTMWorker (Pyodide runtime, stage 1/stage 2 loading, install ceiling 5 s, SHA-256-checked wheel cache), `ctm.checkers` (installs ctm-checkers payloads; base + STACK part; one queue per runtime), UI (`ctm-nav.js` deep/tab links, reveals, modes, `tab-ids.lua`), `ctm.source` (include resolution relative to the page; scan API `ctm.source.read`, `ctm.ui.rawHTML`, `ctm.ui.defaultTitle` used by ctm-assessment's converter). Still ships the `ai-feedback` alias (removed in L3x).

## Open at hand-off

- **#30** `consolidation/2026-10-step4-nav-callouts` (head a3df529 at hand-off): ctm-nav opens collapsed Quarto callouts around a link target (nested in tabs/reveals too); `ui` fixture in all three engines. Set with ctm-assessment #24. **Needs independent review.**

## LIB rules (keep)

- `MathExerciseRuntime.callCheckers(py, name, request)`; documented call text: `import builtins as _ctm_builtins` then `_ctm_builtins.__import__("ctm_checkers.browser", fromlist=["call"]).call(name, _ctm_builtins.globals())`.
- A runtime counts as gone only on positive evidence (`stop()`, `qpyodide-runtime-restart`, exact "Python was restarted."); repeat a call once only if `_ctm_request` was still present; calls serialized per runtime; installs and calls share one queue.

## Next work

1. **L3x** (step-3 design §10/§18.6): delete the ai-feedback alias, bridge, legacy-consumer tests and `moved-worker.yml`; keep `templates/ai-feedback/` (forwarder). Set with ctm-assessment U3c.
2. **Phase B store** (step-4 design B1): one store API; autosave on by default; export items (`exportItem()`) for B7; copy helper `ui/ctm-copy.js` (Clipboard API → execCommand → select + Ctrl+C hint).
3. **Step 5**: `ctm.assets.url()` / `CTMAssets.url()` for local assets; worker for standalone pages; preload.
4. Follow-ups: docs line for pyodide-interaktiv without the restart event; `_ctm_request` cleanup when `__builtins__ = {}`; ctm-nav tests: a row-only reflow test, `serve()` must skip a missing font, two lines > 100 chars; `/` includes resolve to filesystem root when there is no project (Quarto uses the page folder).

---

## Common context (same in every repo)

This file hands the remaining work to another agent (e.g. Codex). Published designs live in `Erasmus-CTM/ctm-assessment` `docs/consolidation/` (the step-5 offline/exam design and the variants design are added there by the handoff branch of ctm-assessment).

## Where things stand

| Step | State |
|---|---|
| 1 ctm-libs (shared library, ai-feedback renamed) | merged |
| 2 ctm-checkers (all checker Python in one place) | merged; STACK fix chain in progress (S-01, S-02, S-13 merged; S-07/S-05/S-10/S-11 in progress) |
| 3 pyodide-interaktiv onto ctm-libs | merged (ctm-libs #27, math-exercise #26, py-exercise #9, pyodide-interaktiv #5, ctm-assessment #22); alias removal L3x/U3c not started |
| 4 UI (reveals, modes, tab links, autosave) | phase A merged; ctm-demo migrated; final set open (ctm-libs #30 + ctm-assessment #24); ingmat3a migration waits for AC to merge `linalg-branch` into ingmat3a `main`; phases B (store/progress/quizzes/export) and C (languages) not started |
| 5 runtime + offline/exam build | designed and approved (`ctm-assessment` `docs/consolidation/2026-10-step5-offline-exam.md`), not started; December exam is a target, not a constraint |
| 6 stack-sympy onto shared runtime, packaged | not started |
| 7 grading options | not started |
| 8 PR to pyodide-interaktiv `main` | not started (AC's members decide) |
| Variants redesign | designed and approved (`ctm-assessment` `docs/consolidation/2026-10-variants.md`), not started; after the question-tests PR |

Open PRs at hand-off: ctm-libs #30 and ctm-assessment #24 (one set, see their files); a ctm-checkers + stack-sympy STACK set may appear (S-07/S-05/S-10/S-11), opened by an agent still running at hand-off. **None of these has had its independent review yet.** Review before AC merges.

## Rules (binding, from AC)

- **AC merges everything.** Agents never merge, never force-push a published branch, never create release tags. Merge commits only.
- **Merge protocol for sets** (ctm-assessment `docs/consolidation`, step-1 §12.1): a set of cross-repo PRs pins its dependencies at the reviewed PR head commits (never merge commits), carries no review-ref trailers, every branch is up to date with its base, one combined CI run tests the whole set, and AC merges it in one sitting in a stated order. Before sending: head SHAs unchanged, not behind; after merging: merge tree equals head tree.
- **Commits** are authored AND committed as `Andrey Chesnokov <aacchhee@gmail.com>`. Add a trailer naming the agent that did the work (earlier commits used `Co-Authored-By: Claude … <noreply@anthropic.com>`); keep AC's identity as author/committer.
- **Independent review** of every PR (fresh reviewer, max effort) until nothing substantive remains; CI watched until green. Reviews before every merge request to AC.
- **No code duplication across repos.** One home per piece of code (ctm-libs: runtime/UI/bootstrap/feedback; ctm-checkers: all checker Python; components keep only their own Lua/JS/CSS). Generated copies (shipped ctm-libs copy in pyodide-interaktiv, bootstrap copies) must be produced and CI-checked by script.
- **No backwards-compatibility break without AC's approval.**
- **Licence:** AGPL-3.0-or-later for code. Question XML: CTM's own CC BY-SA 4.0; STACK fixtures GPL-3.0 with notice; HELM rows CC BY-NC (test data only, labelled).
- **No HTML in Markdown authoring.**
- **ingmat3a must build green and clean** (0 warnings). Course `main` branches change only through migration PRs that AC merges.
- **Wording rule (STACK):** two upstream STACK security issues were reported privately (feedback-variable names; question-variable names with Greek letters or underscores). In anything public, describe only what our engine does ("student answers may not use question- or feedback-variable names"); never describe STACK's behaviour on this.
- **Courses:** ingmat3a is pinned to ctm-assessment `9ed46a4` until its migration PR; ctm-demo follows `ref: main`.

## Environment notes (from this session; may differ for you)

- GitHub GraphQL, codeload.github.com and jsDelivr were blocked; Actions logs could not be downloaded (read check-run annotations instead). Browser tests that need CDN files route them to local copies (see `ctm-assessment` tools and the Pyodide dist notes).
- Only Chromium ran locally; Firefox and WebKit run in CI.
- Quarto 1.8.27; Pyodide 0.28.3 (0.27.2 also tested).

## Housekeeping for AC

- Delete branches: ctm-demo `stack-repro`, `stack-notes`; ctm-assessment `diag/s10-webkit`; ctm-libs `consolidation/2026-10-step3-review`, `probe/webkit-tabs`.
- Optional: delete ctm-demo Actions artifact 12325605804 (old PR #15 build).
- STACK author: send the "semantics page updated" note once https://erasmus-ctm.github.io/stack-sympy/compliance/semantics.html#author-attention shows eight rows (it was deployed; the CDN was still serving the old page at hand-off). Second private STACK report (question-variable names) is ready in `ctm-audit-2026-10/stack/private/stack-question-variable-names.zip` if not yet sent.
- jsxgraph-quarto PR #2 (fork aacchhee/jsxgraph-quarto `audit/2026-10`, head 0b64e98) bundles 1.14.1 and is ready; paste `jsxgraph/pr2-update-1.14.1.md` into its description and send `jsxgraph/reply-2026-10-21.txt`.
