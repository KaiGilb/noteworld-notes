# Changelog

## [5.1.4] - 2026-04-18
### Fixed — F.Find_Note still empty on pods whose search index doesn't cover the notes
- `useTwinPodNoteSearch` switches to **two-phase type-driven discovery**: (1) enumerate candidate URIs from every container in `containerPaths` via `ur.hyperFetch` (Turtle parsed into a temporary rdflib graph so LDP metadata doesn't leak into the shared store); (2) classify each candidate via `ur.fetchAndSaveTurtle` in parallel (populates `ur.rdfStore` with the resource's real `rdf:type`); then one match on `rdf:type ∈ typeUris` (default `schema:Note ∪ neo:a_note`) filtered to the candidate set.
- Why this replaces v5.1.3's `/search/{concept}` approach: verified 2026-04-18 against `tst-ia2.demo.systemtwin.com`, the pod's search index does not cover the notes at all — `/search/note` returns 200 empty-body, `/search/notes` returns one unrelated resource whose text happens to contain the word "notes". No combination of concept terms can enumerate the actual 15 notes via search on that pod. `/t/` container listing returns all 15 as `ldp:contains` relations, making it the only primitive that works across every pod we've tested.
- Container paths are a parameter, not a constant, so callers running against pods with a different layout can override without forking (same `no-hardcoded-ontology` principle as `typeUris`). The container path is used ONLY to enumerate candidates; the note-ness decision is the type match, not the path.
- URI prefix / naming filtering (`/t/t_note_`) is NEVER applied — a resource is a note iff its `rdf:type` matches. Regression guard: test "returns notes regardless of URI path / naming".
- Error model: `discovery-error` is set only when EVERY container listing fails; a partial failure in a multi-container config is tolerated. Per-candidate GET failures are swallowed (the resource simply won't appear in the type match).
- 36 unit tests (up from 34 in 5.1.3 — tests fully rewritten to cover Phase 1, Phase 2, type filter, union, partial-failure tolerance, and regression guards).

## [5.1.3] - 2026-04-18
### Fixed — F.Find_Note still empty on pods whose search indexer doesn't map `note`
- `useTwinPodNoteSearch` now issues a parallel pod-local search for every term in `concepts` (default `['note', 'notes']`) via `ur.searchAndGetURIs`, and unions the subjects across the shared `ur.rdfStore` with a single type match on `schema:Note ∪ neo:a_note`. TwinPod's search endpoint is a per-pod concept resolver backed by that pod's Neo ontology map; concept labels are NOT portable. Observed 2026-04-18: `tst-first/search/note` returns notes, `tst-ia2/search/note` returns 200 empty-body, `tst-ia2/search/notes` returns the 15 notes that 5.1.2 was missing.
- Added `concepts` option so callers building other vocabularies (`['task','tasks']`, `['idea','ideas']`, etc.) can override the default without forking the composable (consistent with the "no hardcoded ontology" rule in `Rule_Code_twinpod-client-package.md`).
- Error model: `Promise.allSettled` — each concept query fails independently. `error` (type `search-error`) is set ONLY when every query fails; an empty-body 200 is a legitimate "no hits under this concept", not a failure. A partial success keeps whatever the successful query produced.
- **Removed** the LDP container listing of `{pod}/t/` that an earlier 5.1.3 draft introduced. Discovery must be type-driven (RDF type + attributes), not location-driven (container path + URI prefix). Crawling `/t/` baked the interim ACL workaround into the package and would have excluded any note minted under a different path.
- Reverses the `neo:a_note`-only filter introduced in v5.1.1; retains the dual-type union added in v5.1.2. Regression guards lock in: no `ur.hyperFetch` against containers, no URI-prefix filtering, `schema:Note` always in the queried types, both `note` and `notes` queried by default.

## [5.1.2] - 2026-04-18
### Fixed — F.Find_Note returned zero NoteWorld-authored notes (dual-type filter)
- `useTwinPodNoteSearch` now filters the rdfStore on EITHER `schema:Note` (http://schema.org/Note) OR `neo:a_note` (https://neo.graphmetrix.net/node/a_note) and unions the subjects. Both `useTwinPodNoteCreate` and `useTwinPodNoteSave` write notes typed `schema:Note`, so the v5.1.1 single-type filter (neo:a_note only) matched zero subjects and F.Find_Note silently returned an empty list on every pod. The `neo:a_note` branch is retained so pods containing Neo-shaped notes from other tooling are still listed alongside NoteWorld notes.
- Dedup behaviour unchanged: a subject typed both ways appears exactly once.
- Regression guard added — test fails if the filter drops `schema:Note`.

## [5.1.1] - 2026-04-18
### Fixed — real-pod save + find (post-Inc-2 defect pass)
- `useTwinPodNoteSave` now calls `ur.uploadTurtleToResource` with `method: 'PUT'` (full-replace). The previous default (PATCH with `Content-Type: text/turtle`) is not a valid Solid operation — Solid PATCH requires `application/sparql-update` or `application/n3`. The real pod at `tst-first.demo.systemtwin.com` misreports the PATCH + text/turtle combo as `401 "session expired"`, silently breaking every optimistic save since v4.0.0. PUT matches `useTwinPodNoteCreate` and the "build whole Turtle document on every save" model this composable already uses.
- `useTwinPodNoteSearch` is now type-driven single-source: drops the LDP container listing of `{pod}/t/` (returned 403 against this pod and was the wrong abstraction — notes are discovered by RDF type, not by which container they currently live in), and corrects the type filter from `neo:a_fragmented-document` (v5.0.0 regression) back to `neo:a_note` — the type TwinPod assigns to note-shaped resources.

## [5.1.0] - 2026-04-18
### Added — optimistic create (S.OptimisticCreate / Increment 2)
- `useTwinPodNoteCreate` now mints the resource URI and flips `pendingUri` + `creating` synchronously BEFORE the first `await`, enabling fire-and-forget create. Callers that do not await can read `pendingUri.value` immediately and navigate while the PUT runs in the background. The returned Promise still resolves to the eventual PUT outcome so existing await-style callers keep working.

## [5.0.1] - 2026-04-18
### Changed — non-blocking save (S.OptimisticSave / Increment 1)
- `useTwinPodNoteSave.saveNote` now returns to its caller without awaiting the PUT. The PUT runs in the background; UI state is exposed via `saving` / `saved` / `error` refs. The returned Promise still resolves to the eventual PUT outcome so existing await-style callers keep working.
- Multiple rapid saves coalesce last-write-wins: at most one PUT in flight per composable instance plus at most one queued. The queued PUT carries the most recent text submitted; intermediate text is dropped.
- `saving` ref now means "PUT in flight or queued" — it stays true until the queue fully drains.
- Public API surface unchanged (no new refs, no signature changes).

VDT: `5 - Project/NoteWorld/vdts/NoteWorld-VDT-2026-04-18.md` — S.OptimisticSave delivers V.Speed_Save_Note (6.5 s → ~50 ms perceived).

## [5.0.0] - 2026-04-17
### Breaking — single `ur` namespace, `solidFetch` param removed
- All four composables now import only `{ ur }` from `@kaigilb/twinpod-client`; no `solidFetch` parameter.
- `useTwinPodNoteCreate({ typeUri })` — removed `solidFetch` first arg; uses `ur.*` internally.
- `useTwinPodNoteSave({ predicateUri, typeUri })` — removed `solidFetch` first arg; uses `ur.*` internally.
- `useTwinPodNoteRead({ predicateUri })` — removed `solidFetch` first arg; removed Inrupt helpers entirely.
  - Rewrote to use `ur.fetchAndSaveTurtle(url, true)` + `ur.rdfStore.statementsMatching` instead of `getSolidDataset`/`getThing`/`getStringNoLocaleAll`.
  - 404 from `fetchAndSaveTurtle` → `error.type = 'not-found'`; other HTTP errors → `error.type = 'http'`.
- `useTwinPodNoteSearch({ conceptName, lang })` — removed `solidFetch` first arg; `ur.searchAndGetURIs(podRoot, conceptName, options)` new call signature (podRoot explicit first param, options object).

## [4.0.0] - 2026-04-15
### Breaking — Stack B Turtle pipeline, Solid container model
- All four composables now accept `solidFetch` as first arg (built from `createSolidFetch`).
- `useTwinPodNoteCreate(solidFetch, { typeUri })` — creates note at `{podRoot}/t/` via Stack B (blank node → storeToTurtle → modifyTurtle → PUT text/turtle).
- `useTwinPodNoteSave(solidFetch, { predicateUri, typeUri })` — persists text via Stack B (PATCH text/turtle).
- `useTwinPodNoteRead(solidFetch, { predicateUri })` — reads text via `getSolidDataset`/`getThing`/`getStringNoLocaleAll`; last value is current (TwinPod state history).
- `useTwinPodNoteSearch(solidFetch, { conceptName, lang })` — searches via `searchAndGetURIs(solidFetch, podRoot, conceptName, options)`.

## [3.0.0] - 2026-04-15
### Breaking changes
- `useTwinPodNoteCreate` now creates notes via `PATCH {podRoot}/node/Substance` with `Content-Type: application/sparql-update` and body `INSERT DATA { <client-minted-uri> a <neo:a_note> . }`.
- The URI is minted client-side (`{podRoot}/node/t_note_{timestamp}_{4-rand}`) because the TwinPod server returns `201 "Success"` with no `Location` header.
- Removed the `missing-location` error state; it is no longer meaningful.
### Rationale
- `@kaigilb/noteworld-notes@2.0.0` POSTed Turtle to `{podRoot}/node/` and read a `Location` header. That contract was wrong — the TwinPod server at `tst-first.demo.systemtwin.com` returns `404` on `OPTIONS /node/` (and `POST /node/`), so every real-pod call failed. All 2.0.0 tests passed only because they mocked the wrong response shape.
- The real contract was verified by a direct probe against the real pod on 2026-04-15. See `/Users/kaigilb/Vault_Ideas/9 - Standard/Reference_Code_TwinPod-Writes.md` for full details.

## [2.0.0] - 2026-04-14
### Breaking changes
- `useTwinPodNoteCreate` now accepts `hyperFetch` (from the app's `rdfStore.js`) instead of `twinpodFetch`
- `createNote(podBaseUrl)` now accepts the pod base URL without trailing slash instead of a container URL
- Composable now POSTs a complete Turtle document (`<> a neo:a_note .`) to `{podBaseUrl}/node/`
- All TwinPod communication is `text/turtle` — no plain text, no JSON-LD

## [1.0.0] - 2026-04-13
### Initial release
- `useTwinPodNoteCreate` composable — creates a new empty LWS resource in a TwinPod container and returns its URI
