# First-visit isolation reload

The service worker can become active while initial KaTeX dynamic imports,
Monaco AMD callbacks, MathJax typesetting and font requests are still running.
Reloading then cancels requests and leaves rejected promises in the departing
page. `window.load` alone does not cover those asynchronous component tasks.

The existing shared runtime now exposes `trackInitialUI(promise)` and
`whenInitialUIReady()`. Components register initial UI work synchronously in
module evaluation, before `load`; their promises cover actual editor/question
construction, including KaTeX's stylesheet and modules. Registration closes at
load even if no reload barrier is requested; the barrier awaits those tasks, existing parent MathJax startup and the
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

Fatal worker events retain their native error reporting and reject pending
startup, RPC and package-setup promises instead of leaving them waiting.
The dead proxy rejects later calls immediately; no runtime is automatically
replaced. An explicit restart creates one replacement and retains normal
restart notifications. Failed postMessage calls reject their own operation
and remove their pending entry. Worker object URLs are released once.

Local explicit stage-1 packages are checked against the served subset and
verified in Pyodide's loaded-package registry after loading. A reported or
silent missing package fails required startup before plugin hooks or optional
background setup run. Stage-2 failure remains a separate degradation path.
Range-stall retries and idle-install admission do not provide an end-to-end
deadline for lock loading, interpreter bootstrap or Python package execution.

Encoded wheels require complete representations. A measured jsDelivr response
advertised a range of Brotli bytes, while Fetch exposed decoded bytes. Advancing
by the decoded length then requested the wrong compressed offset and eventually
failed decoding. Before prefetching each wheel, a bounded HEAD is consumed to
completion. Visible identity metadata retains range prefetch; encoded, hidden or
unsupported metadata selects a complete GET. This is still prefetch, with the
same final lock-file SHA verification and cache/install admission rules. A server
changing to encoding after HEAD triggers a consumed partial attempt followed by
whole GET; decoder warnings and browser request failures remain observable.

Exposed Content-Range boundaries, total size and received length must agree.
Changed totals retry the same offset; a whole response to a later range replaces
the earlier partial chunks. CORS-hidden range headers retain the existing short
range/416 fallback. The COI service-worker bytes remain unchanged: controlled
Chromium identity/Brotli transport checks confirmed complete verified bytes both
with and without that worker. These focused transport checks do not replace
actual first-visit CI or prove Python/bootstrap readiness.
