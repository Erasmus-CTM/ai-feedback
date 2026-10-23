# Shared layout lifecycle candidate

`ui/ctm-layout.js` is the canonical shared CTM implementation. It is not loaded by production dependencies yet. Activation depends on the original-fixture browser proof and canonical producer/component changes.

`CTMLayout.ready(callback)` releases shared reveal/save/progress initialization once complete build-time content has been parsed, before deferred modules register DOMContentLoaded observers. The saved-answer manifest is already an end-of-content marker; reveal-only pages can emit a non-rendering `ctm-layout-ready` marker. Late scripts and pages without a marker retain a DOMContentLoaded readiness path. It does not delay startup by a timer, start Python or execute answers.

`CTMLayout.fitEditor(editor, container, {minHeight})` consumes supported Monaco APIs with `automaticLayout: false`. It owns the native container ResizeObserver and content-size subscription. Callbacks copy the latest content-box dimensions and schedule one rendering-frame task; only that task writes the existing fit-to-content height and calls `editor.layout`. Fractional/untransformed box dimensions and Monaco's minimum hidden dimensions are retained. A height write receives its new box through native observation. Editor disposal cancels pending work, disconnects the scoped observer and disposes subscriptions. A window-resize fallback exists where ResizeObserver is absent.

`CTMLayout.task(callback)` is the small one-pending-frame scheduler used by that integration. Repeated notifications while rendering is paused retain one task. No idle polling or time-based fallback is added.

This is local integration work. Quarto and Monaco sources, native constructors and raw errors remain unchanged. The shared early-startup hypothesis and later editor feedback path need separate causal/behavior evidence; a green helper unit test alone does not clear strict store/course acceptance or fake-clock behavior. Consumers must register this exact canonical dependency rather than copy the helper.
