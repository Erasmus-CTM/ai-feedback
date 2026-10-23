# Monaco workers and the COI decision

The shared runtime installs Monaco's public `MonacoEnvironment.getWorker`
hook before py-exercise or pyodide-interaktiv loads Monaco. Monaco 0.46 accepts
`Promise<Worker>` here. Editor construction stays independent of this promise,
so it can finish the initial UI barrier that precedes the COI reload decision.
Only lazy worker construction waits for `qpyodideCoiSettled`. Retired documents
never resolve that decision and never construct their lazy workers. Pages without
that COI component start workers normally.

Existing `getWorker`, `getWorkerUrl` and `createTrustedTypesPolicy` callbacks
retain their receiver, arguments, results and failures. The default path uses
Monaco 0.46's exported AMD `vs/base/browser/defaultWorkerFactory` bootstrap helper
to retain its cross-origin Blob/baseUrl/importScripts and same-origin URL rules.
The worker entry URL uses the injected AMD `require` dependency: Monaco's global
loader does not expose `toUrl`. The focused regression executes that actual
0.46 loader as well as the callback contract checks.
That helper is a version-bound integration seam, not a stable public API; check
it when updating the pinned Monaco version.

The runtime captures Monaco's own `defaultWorkerFactory` Trusted Types policy,
without creating an additional policy or bypassing CSP. The normal CTM head
ordering loads this hook before `editor.main`. A separately preloaded Monaco
factory under a restrictive Trusted Types CSP cannot expose its private existing
policy; such an integration needs its authored `getWorker` hook. Failures remain
observable rather than falling back to an ungated worker.
