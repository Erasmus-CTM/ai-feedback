# Migration sequence and verification

1. **API and shared extension**: headless client, prompt builder, context aliases,
   settings, text activities, image input, API and rendered-example tests.
2. **py-exercise (recommended first integration)**: add the missing feedback
   capability; retain code-matched checker snapshots, constraints and only
   permitted messages. Preserve Check, Reset and submission behavior. Feedback
   must not execute code, expose hidden tests or use stale checker results.
3. **Mathematics**: preserve task/LaTeX source, checker evidence, matrices,
   graphical responses and existing four-step policy. Run existing regression
   tests against the integration before removing old provider logic.
4. **Pyodide (current integration)**: preserve three hint levels and cached output. Feedback never
   executes Python. Move provider transport and settings to shared APIs.

The original plan placed Pyodide first because its existing feedback module is
the smaller extraction. There is no dependency requiring that order. Following
the phase 1 recovery discussion on 2026-09-25, the recommendation is to start with
py-exercise to deliver the missing capability and validate checker evidence
early. The subsequent user request moves mathematics ahead of Pyodide; consumer PRs still follow acceptance here.

See [the phase 1 record](phase-1.md) for the recovered scope and verification.

Develop each shared adapter and its acceptance checks in this repository first.
`examples.qmd` is the common page for the active integrations, built from explicit
branch revisions by `scripts/setup-feedback-integration.py`.
Its **Non-Python**, **Python**, **Mathematics** and **Pyodide** tabs contain all examples,
including partially completed Python and mathematics tasks. Topic sources live in `examples/` and are included in
one HTML page. Add a sibling tab and include for each subsequent integration. Only after the
integration works here should a separate consumer PR propagate it. The live example site is deployed only after
tests and actual Quarto rendering succeed. PRs retain rendered artifacts for
review without deploying over the working site. Automatic tests use mocked
provider replies; they never claim to verify a live model or NTNU VPN access.

Initial upstream references:

| Repository | Commit |
|---|---|
| math-exercise | fc549d25121abb24bba4a9096f2328f54d3675c7 |
| pyodide-interaktiv | f815bc2b145f3e4e4132101cb274a65893780874 |
| py-exercise | aea03115e2b8ae1e404a13c00dcef8b4df09118b |

Existing documents keep working through the migrations. When the shared
extension is installed explicitly, all consumers use its single runtime.
For unchanged documents, migration adapters may bundle the identical versioned
runtime as a compatibility dependency. Such copies are generated from this
repository and must never be edited independently. Release updates must verify
the bundled files match the pinned shared release.
