# First-visit isolation reload

The service worker can become active while initial KaTeX dynamic imports,
Monaco AMD callbacks, MathJax typesetting and font requests are still running.
Reloading then cancels requests and leaves rejected promises in the departing
page. `window.load` alone does not cover those asynchronous component tasks.

The existing shared runtime now exposes `trackInitialUI(promise)` and
`whenInitialUIReady()`. Components register initial UI work synchronously in
module evaluation, before `load`; their promises cover actual editor/question
construction, including KaTeX's stylesheet and modules. The barrier closes after
load dispatch, awaits those tasks, existing parent MathJax startup and the
current `document.fonts.ready`. Duplicate calls share one promise. Late
registration is a contract error; later user-created IDE editors are outside
the initial construction batch. An older loaded runtime retains its live
namespace/methods and receives only missing readiness methods.

Task failures are reported immediately to the console, even if no reload is
needed; the barrier rejects with the same error. Failures are never readiness.
This is an initial CTM/parent-document contract, not a claim that arbitrary
opaque frames or future network requests have settled.

The Python component owns the COI decision and its existing recent-reload,
hard-reload and failed-check records. It publishes its startup promise
immediately so other components cannot create a fallback interpreter, but holds
worker creation while an automatic reload is possible. It does **not** wait for
Python packages, authored setup/output/autorun cells or learner execution in the
UI barrier: doing so would form a UI -> Python -> COI -> UI deadlock.

One pending automatic reload waits for UI. It rechecks user interaction and
reload limits immediately before writing flags/navigation. Duplicate ready
events cannot schedule another navigation. Interaction cancels automatic
navigation and releases the current runtime. A 30-second readiness deadline
leaves `needs-reload` and releases Python; it never triggers a delayed reload,
and late readiness cannot reverse that decision. UI failure also retains the
current document with a visible error. Already isolated and unavailable paths
start without waiting for UI. The existing five-second missing-COI-script
fallback remains; learner input is not discarded. Existing input/Stop shared
buffer eligibility and authored startup ordering remain unchanged.

Focused native contracts cover phase ordering, early rejection, duplicate
barriers, late registration, retained old runtime, duplicate COI signals,
interaction, deadline and recent-record rechecks. Actual first-visit browser
proof must still retain all raw failures and request lifecycles. This source
change alone does not clear static/live-course rollout or offline acceptance.
