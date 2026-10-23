# Shared student variant choice

Components register one ordinary `ctm.ui.exercise`/`CTMStore.register` entry,
and call `ctm.variants.use()` to emit the shared `CTMVariants` chooser. Only
deployed student records with positive stable `n`, nonempty `id` and `hash`
belong here. Generation, approval and unnumbered review proposals are native
authoring concerns.

Create the chooser with `{label, variants, saved: handle.restoreChoice()}`.
`CTMStore.seed()` and `.page` provide its course learner seed and page identity;
explicit `seed`, `page` and `query` options are available for scoped callers.
`current()`, `seen()` and `state()` expose the selected record and current cycle.
Register P17 callbacks `variant: () => chooser.current()` and
`seen: () => chooser.seen()`, then persist selection with
`handle.choice(chooser.state())` after the component has applied the choice.
The ordinary handle still owns answer/result saving.

Saved hash wins, then stable number, then id. `restored()` exposes the original
record and `restored`, `changed`, `withdrawn` or `empty` state. Only `restored`
permits filling old answers: changed/withdrawn records must remain available
as an offer, before the component overwrites the saved selection. Without a
matching saved choice, `?variant=<label>:<n>` wins over rendezvous selection.
Ranking and seen cycles use `n`, so renaming a variable cannot reshuffle learners.
Adding a record preserves the relative ranking of every existing record.

`next()` selects an unseen record; after all deployed records have appeared,
it starts a fresh cycle without an immediate repeat when another record exists.
The component asks before clearing filled answers, clears stale feedback,
renders the question, announces localized “Variant N”, and focuses it.
The chooser does not make those UI decisions or grade answers.

Choice and seen share the P17 exercise record. With saving disabled, only
identity and seen are kept in session storage, with empty inputs and no grade.
An untouched answer does not erase the choice. Changed choices cancel pending
debounces and cached old grades. The component supplies the authoritative
current-cycle seen list; legacy adapters without that callback retain the old
merge behavior. Exercise, page and course clearing remove session choices too.
Inaccessible storage retains the store's existing same-page memory fallback.
On `ctm:store-enabled`, the component persists its current accepted choice again
so the new saving backend receives it; session choices are not silently promoted.
