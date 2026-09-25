# Phase 1: recovery and verification

Recovered on 2026-09-25 from the
[original planning conversation](https://chatgpt.com/share/6ab6cdfa-9ce4-83ed-bc28-319adacf5c6d)
and the repository at `24105429237f07ae4fb35344e2575348d20c2a97`.

## Agreed scope

Phase 1 establishes the reusable Quarto extension before any consumer migration:

| Requirement | Implementation / verification |
|---|---|
| Clear API independent of checkers, Python and editors | API v1 in `docs/api.md`; five representative request fixtures and core tests |
| Shared provider transport and teaching policy | Headless JavaScript core; copy/API modes; cancellation, timeouts, compatibility, safe rendering and configurable hints |
| Shared Quarto resources and context | Lua filter; `.ai-feedback-context`, `.ai-context` and permanent `.math-exercise-context` alias; LaTeX-preserving context resolver |
| Translation and simple language activities | Textarea activities; independent UI, source, response and feedback languages |
| Images of learner work and source pictures | Explicit image roles; image-only learner responses; required images are never silently dropped |
| One website configuration and cogwheel | Shared settings dialog; configurable endpoint/model; no provider presets; explicit legacy-settings import |
| English page, German original, Norwegian translation | Sixth rendered example, with English feedback and explicit source reference |
| Working examples and README API guide | Quarto examples and API quick start; tested GitHub Actions Pages deployment |
| Distinct author explanation and learner task | Six author callouts outside task cards; explicit context selection excludes author notes from prompts |
| Uploadable handwritten Spanish sample | `assets/spanish-handwriting.png`, linked for download beside the handwriting activity |

## What the interrupted chat had completed

- [PR #1](https://github.com/Erasmus-CTM/ai-feedback/pull/1) merged on 2026-09-25,
  producing `6ae0a91263963044c62111343794d0af8a4307ba`.
- Commit `2410542` added prominent examples/API links.
- Pages was enabled after an initial deployment failure. The main workflow
  [run 36179218304](https://github.com/Erasmus-CTM/ai-feedback/actions/runs/36179218304)
  subsequently succeeded, and the examples URL returned HTTP 200 during recovery.
- The user reported that direct feedback worked with their API key. This is a
  user-reported provider check; recovery tests do not independently verify NTNU
  connectivity, VPN access or live model quality.
- The chat then requested clearer example instructions and a handwriting sample.
  `feature/clear-example-instructions` existed but still pointed to `2410542`:
  those final edits had not been published. This follow-up completes that work.

## Verification of the follow-up

Source files were fetched from the exact base commit above, not an unpinned
working branch. See `verification/phase-1-source.json` for the complete file list
and Git blob identities. Quarto 1.8.27 matches the repository workflow.

- `npm ci --ignore-scripts` installed the locked test dependencies.
- `npm run test:render` rendered both website pages and passed the rendered-page
  integration check. It exercises all six Feedback buttons, context/source
  roles, languages, author-note exclusion and the published PNG download.
- The handwriting test uploads the actual downloadable PNG with an empty
  textarea, checks copy-mode attachment instructions, and verifies that the
  same bytes enter a mocked direct API request. No typed transcription or
  author-only correction hints accompany the image.
- `npm test` after rendering runs all 20 tests without skips.
- GitHub Actions repeats unit/DOM tests and rendering for the PR. The main-only
  deployment job publishes `_site` after merge. No `gh-pages` branch is needed.

The sample was recreated using the built-in image generator because the earlier
chat's image was not available in this workspace. Its generation specification
was a straight-on photo of lightly ruled paper with clear blue handwriting,
three lines, no annotations, and this exact text including intentional mistakes:

```text
Me llamo Ana.
Yo vive en Trondheim.
Me gusta los libros.
```

The mistakes are educational test input, not suggested correct Spanish. The
sample was visually checked for exact text before inclusion.

## Boundary before migration

No consumer repository is changed by this work. Their main heads were checked
during recovery and still match the original upstream references:

| Repository | Main commit |
|---|---|
| py-exercise | `aea03115e2b8ae1e404a13c00dcef8b4df09118b` |
| pyodide-interaktiv | `f815bc2b145f3e4e4132101cb274a65893780874` |
| math-exercise | `fc549d25121abb24bba4a9096f2328f54d3675c7` |

The initial plan chose Pyodide first as the smaller extraction. After the user
asked why py-exercise could not start first, the recommendation became
**py-exercise → Pyodide → math-exercise**. No technical dependency requires
Pyodide first. See [the migration plan](migration.md) for preservation criteria.

Live feedback on the new handwriting sample remains a manual model-quality
check using the user's configured endpoint and key. Automated tests verify
packaging and transport, not what a live model says about the image.
