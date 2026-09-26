# Shared integration workbench

All common examples and acceptance checks belong to **ai-feedback**.
The source is the root **`examples.qmd`**: six text/image activities plus
Python unit-test and mathematics exercises.
The entry page uses topic includes in `examples/` to render one HTML page with
**Non-Python**, **Python** and **Mathematics** tabs. The Python tab includes five
partially completed functions, with separate author notes and learner tasks.
Add a sibling tab and topic include for each new integration.
Develop and validate each shared adapter here first; only then open consumer PRs.
The current adapters are py-exercise and mathematics; Pyodide is deferred.

## Set up and serve

Requirements: Python 3.12+, Git, Node 22/npm and Quarto **1.8.27**. Install
`sympy==1.14.0` and `networkx==3.4.2` in the Python used by `python`, or set
`PYTHON` to that interpreter for the mathematics tests.

```sh
python scripts/setup-feedback-integration.py --test
python -m http.server 8000 --directory .feedback-workspace/site/_site
```

Open <http://localhost:8000/examples.html>. The setup script copies the root
Quarto source files and exact extension revisions into an isolated generated
workspace. It does not create a separate example source page in a consumer repo.
Use an HTTP origin: Monaco and Pyodide workers do not work reliably with `file://`.

## Repository selection

`repos.json` is the branch/pin manifest:

| Repository | Branch | Default source |
|---|---|---|
| ai-feedback | `main` | This checkout, including local edits |
| py-exercise | `feature/shared-feedback-integration` | Pinned branch commit |
| math-exercise | `feature/shared-feedback-integration` | Pinned branch commit |
| pyodide-interaktiv | `main` | Pinned pre-migration commit |

The script records every resolved commit, local dirty-file list and copied
extension file's SHA-256 in `resolved-repos.json`. That record is included in the
rendered site and linked from `examples.qmd`. External sources are downloaded as
exact-commit archives. No upstream checkout is overwritten.

Use the configured external branch tips instead of pins:

```sh
python scripts/setup-feedback-integration.py --refresh --test
```

This writes the resolved record, not a changed manifest. Update pins explicitly
when a new tested baseline is accepted. To include local consumer branch work:

```sh
python scripts/setup-feedback-integration.py \
  --source py-exercise=../py-exercise \
  --source math-exercise=../math-exercise \
  --source pyodide-interaktiv=../pyodide-interaktiv \
  --test
```

Overrides must be Git checkouts; their actual SHAs and dirty-file lists are
recorded. `--workspace PATH` selects a different generated workspace. An unrelated
nonempty folder is rejected rather than overwritten.

## Browser validation

After initial setup, install Chromium and run the real browser check:

```sh
npx playwright install chromium
python scripts/setup-feedback-integration.py --test --browser
```

CI installs Chromium's system dependencies too. `CHROMIUM_EXECUTABLE` can point
to an existing Chromium binary; `CTM_BROWSER_PROXY` supports a required network
proxy. Provider credentials are neither needed nor supplied.

The browser check executes real Python execution via Pyodide, Monaco and SymPy on the combined
`examples.html`. It checks failing/passing Python responses, forbidden imports,
Reset, all five mathematics examples and their four feedback levels, and the shared
copy prompt/cogwheel. It fails when those runtimes cannot load. Python execution
is not mocked. The six standalone activities also retain their existing
rendered-page/image-transport checks. Live AI replies remain outside CI.
The browser check also switches to the **Python** tab: every starter must run
and fail at least one check, a corrected version must pass, and Reset must restore
the exact starter. It verifies printed output, code restrictions and hidden hints.

The existing examples workflow runs all checks before uploading the rendered
site and revision/browser reports. Successful main builds deploy the same site
with GitHub Pages. Feature branches retain a `rendered-examples` artifact.

## Migration boundary

Python tasks use shared Feedback and settings from the pinned
`feature/shared-feedback-integration` branch, not the main runtime. Feedback
reads current code without execution and includes only code-matched checker
summaries and learner output. Edits and Reset invalidate that evidence.
Mathematics uses shared settings, transport and rendering while retaining its four-step teaching policy. Feedback never runs its checker. Only matching prior Check evidence is sent; graph payloads, expected values and checker source stay local. The generated standalone fallback must match all four shared runtime files byte for byte. The separate
interactive Pyodide example is removed; its source pin is retained for the future
integration. Python exercises still use Pyodide internally to execute code.

The adapters must omit stale output and hidden test source, preserve
Check/Reset/submission, and use the shared API and cogwheel without executing
code for feedback. Validate them here before opening a consumer PR.

## Pyodide integration

The fourth tab includes `examples/_pyodide.qmd`: three incomplete programs for
price, accumulation and circle area. `pyodide-interaktiv` is pinned to its shared
feedback feature branch, alongside py-exercise and math-exercise. All consumers
share settings, transport and LaTeX rendering. Pyodide retains three hints that
never supply finished code, and feedback never executes Python.

The builder verifies that both generated fallback bundles match the shared
runtime byte for byte. Tests cover fresh stdout evidence, edit/reset/run/restart
invalidation, no raw stderr, standalone documents and both filter orders.
Consumer PRs remain deferred until this common page is accepted.
