# Shared integration workbench

All common examples and acceptance checks belong to **ai-feedback**.
The source is the root **`examples.qmd`**: six text/image activities followed by
Python unit-test, mathematics and interactive Python baseline exercises.
The companion `py-exercise-examples.qmd` page has five partially completed Python
functions, with separate author notes and learner tasks.
Develop and validate each shared adapter here first; only then open consumer PRs.
The first adapter is py-exercise, followed by Pyodide and mathematics.

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
| math-exercise | `main` | Pinned pre-migration commit |
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

The browser check executes real Pyodide, Monaco and SymPy on the combined
`examples.html`. It checks failing/passing Python responses, forbidden imports,
Reset, mathematics accepting 42, interactive Python printing 6, and the shared
copy prompt/cogwheel. It fails when those runtimes cannot load. Python execution
is not mocked. The six standalone activities also retain their existing
rendered-page/image-transport checks. Live AI replies remain outside CI.
The browser check also opens `py-exercise-examples.html`: every starter must run
and fail at least one check, a corrected version must pass, and Reset must restore
the exact starter. It verifies printed output, code restrictions and hidden hints.

The existing examples workflow runs all checks before uploading the rendered
site and revision/browser reports. Successful main builds deploy the same site
with GitHub Pages. Feature branches retain a `rendered-examples` artifact.

## Migration boundary

These three consumer examples establish coexistence before adapter changes.
py-exercise has no shared-feedback button yet, while mathematics and Pyodide
still have their legacy settings and teaching policies. Passing the baseline
does not imply those implementations have already migrated.

The next adapter must use code-matched checker snapshots, omit stale output and
hidden test source, preserve Check/Reset/submission, and use the shared API and
cogwheel without executing code for feedback. Add its checks here before opening
a consumer PR. The early py-exercise scaffold PR was closed unmerged and its
branch returned to the original runtime tree, ready for that later work.
