# Changelog

## [5.2.5] - 2026-04-19
### Fixed — notes with æøå lose all text from the first non-ASCII character
- **Root cause:** `escapeTurtleString` in `useTwinPodNoteSave` encoded non-ASCII characters as Turtle `\uXXXX` escape sequences. TwinPod's server-side Turtle parser truncates the stored string value at the first `\u` sequence, silently discarding all text from that position onwards. On next read the note returned "hei " instead of "hei æøå".
- **Fix:** Non-ASCII characters are now sent as raw UTF-8 bytes — they are valid in Turtle 1.1 string literals (§3.3) and the current demo server accepts them without 422. Only the five characters that Turtle string syntax actually requires escaping (`\\`, `"`, `\n`, `\r`, `\t`) are still escaped.
- `unescapeTurtleString` is retained in `useTwinPodNoteRead` and `useTwinPodNotePreviews` for backward compatibility: any note previously saved with `\uXXXX` sequences will still decode correctly on read.
- The 5.2.3 CHANGELOG entry's claim that "TwinPod requires `\uXXXX` escaping on write (raw UTF-8 returns 422)" is superseded by this fix. That conclusion was drawn from an earlier server context; the current demo pod accepts raw UTF-8.

## [5.2.4] - 2026-04-19
### Fixed — clean up remaining `schema.org/Note` Turtle fixture strings in test files
- `useTwinPodNoteRead.test.js` and `useTwinPodNotePreviews.test.js` both used `https://schema.org/Note` as a throwaway type URI in Turtle-parsing assertion fixtures. The tests are about `ur.$rdf.parse` call shape — the RDF type value is irrelevant to what is being asserted — but keeping a non-existent URI in any fixture perpetuates confusion. Both fixtures updated to `https://neo.graphmetrix.net/node/a_paragraph` (the canonical Neo type per the 2026-04-18 ontology map).
- Historical CHANGELOG entries describing what previous versions actually wrote are not rewritten; they remain accurate documentation of behaviour at that time.
- No runtime code changed. No version bump needed for consumers (test-only change). Bumped to 5.2.4 to keep the CHANGELOG and package version aligned.

## [5.2.3] - 2026-04-19
### Fixed — non-ASCII characters (æ, ø, å) display as `\uXXXX` escape sequences on read
- **Root cause:** TwinPod stores `\uXXXX` Turtle escape sequences verbatim and does not unescape them on serialisation. rdflib returns these sequences as literal backslash-u character strings rather than the original Unicode characters. `useTwinPodNoteRead` and `useTwinPodNotePreviews` were returning the raw escape sequences to the UI, so any note saved with non-ASCII characters displayed as `\u00E6` etc. instead of `æ`.
- **Fix:** Added `unescapeTurtleString` helper to both `useTwinPodNoteRead` and `useTwinPodNotePreviews`. Applied to the `object.value` string returned from rdflib before storing in the reactive ref / previews cache. Handles both `\uXXXX` (BMP) and `\UXXXXXXXX` (non-BMP) forms.
- `escapeTurtleString` in `useTwinPodNoteSave` is unchanged — TwinPod requires `\uXXXX` escaping on write (raw UTF-8 returns 422) so the save pipeline must continue to escape. The round-trip is: escape on save → TwinPod stores escapes → unescape on read → correct characters in UI.

## [5.2.2] - 2026-04-19
### Changed — externalize `@kaigilb/twinpod-client` as a peer dependency
- `@kaigilb/twinpod-client` moved from `devDependencies` (bundled) to `peerDependencies` in `noteworld-notes/package.json`. Vite build config updated: `external: ['vue', '@kaigilb/twinpod-client']`.
- **Why:** When apps bundled both `noteworld-notes` (which had twinpod-client inlined) and `@kaigilb/twinpod-client` directly, two separate `ur` singleton instances existed at runtime. The app's `ur.hyperFetch` and the package's `ur.uploadTurtleToResource` operated on different objects — the auth session established by one was invisible to the other. Externalising forces both to resolve to the same `ur` instance at the app's module scope.
- Consumers must now list `@kaigilb/twinpod-client` as a direct dependency alongside `@kaigilb/noteworld-notes`. The `apps/noteworld` package.json already satisfies this requirement.

## [5.2.1] - 2026-04-19
### Fixed — new notes not appearing in home list after creation (blank node subject)
- **Root cause:** `useTwinPodNoteCreate` (since 5.1.0) and `useTwinPodNoteSave` (since 5.1.1) both wrote Turtle with a blank node (`_:t1` / `noteBlank`) as the RDF subject of the `rdf:type` and `schema:text` triples. TwinPod's search index associates `rdf:type` with the **resource URI**, not with blank nodes inside the document. A new note written with a blank node subject had no typed resource URI → TwinPod did not index it → it never appeared in `ur.searchAndGetURIs` results → `loadPreviews` was never called for it → the note created by the user showed no text on the home screen.
- **`useTwinPodNoteCreate`:** `runCreatePut` now uses `const noteNode = ur.$rdf.sym(resourceUrl)` as the RDF subject instead of `ur.getBlankNode(...)`. The resource URL is already known at PUT time (client-minted) so no information is lost.
- **`useTwinPodNoteSave`:** `runPut` Turtle template changed from `` `_:t1 a neo:a_paragraph ; ...` `` to `` `<${noteResourceUrl}> a neo:a_paragraph ; ...` ``.
- **`useTwinPodNoteCreate.test.js`:** `mockGetBlankNode` removed from hoisted mocks and `ur` mock (absence serves as a hard guard — any reversion to `getBlankNode` throws immediately). Old test `'calls ur.getBlankNode with a label containing the resource ID'` replaced with `'uses the resource URI as the RDF subject, not a blank node (5.2.1 regression guard)'`.
- **`useTwinPodNoteSave.test.js`:** new regression guard added: `'uses the note URL as the Turtle subject, not a blank node (5.2.1 regression guard)'` — asserts `<${NOTE_URL}>` is in the Turtle body and `_:` is absent.
- 151 unit tests pass (37 in useTwinPodNoteCreate, 35 in useTwinPodNoteSave).

## [5.2.0] - 2026-04-19
### Changed — eliminate direct window.solid.session.fetch calls; add ur.fetchResourceTurtle
- **Root cause of the violation:** `useTwinPodNoteRead` and `useTwinPodNotePreviews` both called `window.solid.session.fetch` directly. This bypassed the single-namespace rule (`{ ur }` only from `@kaigilb/twinpod-client`) and duplicated the header-setting concern in application code. VATester flagged both composables each run as accepted out-of-scope exceptions — this increment resolves the violations properly.
- **New primitive — `ur.fetchResourceTurtle(uri)`:** Added to `@kaigilb/twinpod-client` `src/util-rdf.js`. Wraps `window.solid.session.fetch` with `Accept: text/turtle` and `Cache-Control: max-age=0` (no hypergraph header — intentional: the hypergraph header causes TwinPod to return the full pod knowledge graph instead of the individual resource Turtle). Resolves to `{ ok: boolean, status: number, turtle: string }`. Header correctness is tested once in `twinpod-client/src/util-rdf.test.js`; composables need not re-test it.
- **`useTwinPodNoteRead`:** replaces the direct `window.solid.session.fetch` call with `const { ok, status, turtle } = await ur.fetchResourceTurtle(noteResourceUrl)`. Logic unchanged.
- **`useTwinPodNotePreviews`:** replaces the direct `window.solid.session.fetch` call with `const { ok, turtle } = await ur.fetchResourceTurtle(uri)`. Logic unchanged.
- **`useTwinPodNoteRead.test.js` rewritten:** `mockSessionFetch` / `window.solid` setup removed. New `mockFetchResourceTurtle` on the `ur` mock. `makeResponse` simplified to `{ ok, status, turtle }` (no `.text()` shim). Regression guard added: `'never calls window.solid.session.fetch directly — ur.fetchResourceTurtle only (5.2.0 guard)'` — if a future change reverts to direct session.fetch, the guard catches it because `window.solid` is no longer set up in `beforeEach`.
- **`useTwinPodNotePreviews.test.js` created** (was not previously present): 15 tests covering initial state, fetch delegation, text extraction, GMX predicate fallback, truncation (default + custom maxLength), error handling (non-ok + rejection + partial failure), and the 5.2.0 regression guard. localStorage cache tests (read-on-start + write-after-fetch) are deferred to E2E — jsdom's opaque origin makes localStorage methods unavailable, consistent with the same documented limitation in `useTwinPodNoteRead.test.js`.
- **4 new tests in `twinpod-client/src/util-rdf.test.js`** covering `ur.fetchResourceTurtle`: correct headers (including absence of hypergraph), resolves `{ ok, status, turtle }`, passes through error status, propagates rejection.
- Public API of noteworld-notes unchanged. This is a minor bump (5.1.x → 5.2.0) because `ur.fetchResourceTurtle` is a new public method added to twinpod-client.

## [5.1.8] - 2026-04-19
### Fixed — F.Find_Note note list still empty on real pod (wrong rdf:type match)
- **Root cause (discovered via live debug panel):** The real TwinPod search endpoint (`{pod}/search/a_paragraph`) does not return `rdf:type neo:a_paragraph` triples. It returns SIO-typed Turtle where note resources carry `rdf:type sio:SIO_000110`, and the SIO class itself carries `neo:m_cid "a_paragraph"` to link it to the Neo concept name. The v5.1.7 approach of `ur.rdfStore.match(null, rdf:type, neo:a_paragraph)` therefore found zero triples — the list stayed empty. Verified 2026-04-19 by injecting a temporary debug panel into HomeView showing the raw search response and store match results.
- **Fix — two-step SIO class resolution:**
  1. Wildcard match on `neo:m_cid`: `ur.rdfStore.match(null, neo:m_cid, null)` — filter results by `st.object.value === conceptName` to find the SIO class URI (e.g. `sio:SIO_000110`) for each Neo concept name.
  2. Collect note subjects: `ur.rdfStore.match(null, rdf:type, classNode)` — excludes the class node itself (`uri !== classNode.value`). Union and dedup across all `typeUris` via a `Set`.
  The wildcard approach avoids typed-literal comparison issues (`"a_paragraph"^^xsd:string` vs plain literal) — `st.object.value` always returns the string content regardless of datatype.
- **E2E fixture updated:** `SEARCH_TURTLE` now uses the real SIO format (`a sio:SIO_000110 . sio:SIO_000110 neo:m_cid "a_paragraph"^^xsd:string .`) to match actual pod behavior. The previous `rdf:type neo:a_note` fixture would silently fail with the new composable.
- **Unit tests rewritten:** `setStoreTypeHits` helper replaced by `setStoreMatches` which correctly mocks the two-step pattern: m_cid predicate match returns class node stmts; rdf:type match returns note stmts for the given class URI. Mock extended with `NS.NEO` factory. New regression guard: `'queries rdfStore with neo:m_cid predicate to resolve SIO class (5.1.8 guard)'` — locks in the two-step approach; a revert to direct `rdf:type neo:a_paragraph` matching would fail this guard loudly.
- 38 unit tests (up from 33 — added `'excludes SIO class node from results'` and `'calls store.match with neo:m_cid not rdf:type directly on typeUri'`; all type-filter and union/dedup tests rewritten to the SIO two-step pattern; 4 gap tests added by VATester covering notes.value reactive ref, stale-list reset, and loading=false on error paths).

## [5.1.7] - 2026-04-19
### Fixed — F.Find_Note home list empty; correct TwinPod discovery primitive
- **Root cause:** `useTwinPodNoteSearch` v5.1.4–5.1.6 used LDP container listing as the discovery mechanism. This was architecturally wrong for two reasons: (1) TwinPod has no folder structure for data — containers (`/t/`) are an ACL workaround, not semantic classification (confirmed by Kai 2026-04-19); (2) the per-candidate resource GET (Phase 2) returns Neo-state-shaped Turtle in which the note's type is expressed as a Neo state property, not a direct `rdf:type` triple on the note URI — so the `rdf:type` filter silently dropped every candidate. The home list was always empty on a real pod regardless of which notes existed.
- **Fix:** replace the entire container-listing + per-candidate-GET pipeline with a single call to `ur.searchAndGetURIs(podRoot, conceptName, { force: true })` per type. The pod's `{pod}/search/{conceptName}` endpoint IS type-aware: it returns semantic Turtle with proper `rdf:type` triples for every resource of that concept. `ur.rdfStore.match(null, rdf:type, typeNode)` then finds hits correctly. Verified 2026-04-19 against `tst-ia2.demo.systemtwin.com`: `{pod}/search/a_paragraph` returns all 6 typed paragraphs including "big baller".
- **Critical insight — concept name vs. label:** v5.1.2–5.1.3 also used the search endpoint but with human-readable concept labels (`'note'`, `'notes'`). `{pod}/search/note` returns 200 empty-body on tst-ia2. The search index is keyed on the **Neo concept identifier** (`a_paragraph`, not `note`). Default concepts are now derived from `typeUris` by taking the last URI path segment: `neo:a_paragraph` → `'a_paragraph'`, `neo:a_note` → `'a_note'`.
- **`force: true`:** bypasses the `ur.searchAndGetURIs` session-level cache so newly created notes appear on the home screen immediately without requiring a page reload.
- **API change:** `containerPaths` parameter removed (it described the container-listing path, which is no longer used). `typeUris` parameter retained (defaults unchanged: `[neo:a_paragraph, neo:a_note]`). This is a minor breaking change for any caller that set custom `containerPaths`; callers using defaults are unaffected.
- **New regression guard:** `'never searches for concept "note" or "notes"'` locks out the 5.1.2–5.1.3 wrong-label regression. Guard `'uses ur.searchAndGetURIs; never uses container listing'` locks out the 5.1.4–5.1.6 wrong-primitive regression.
- All prior v5.1.4–5.1.6 test infrastructure (container mocks, `mockHyperFetch`, `mockSessionFetch`, per-graph match routing) replaced with a clean search-based harness. 33 unit tests.

## [5.1.6] - 2026-04-19
### Fixed — F.Find_Note silently empty on every real pod (hypergraph-header regression since 5.1.4)
- `useTwinPodNoteSearch` Phase 2 now fetches each candidate note via `window.solid.session.fetch` directly — mirroring the pattern `useTwinPodNoteRead` and `useTwinPodNotePreviews` have used since those composables' inception — instead of `ur.fetchAndSaveTurtle`.
- Why this was silently broken: `ur.fetchAndSaveTurtle` delegates to `ur.aLoadURI`, which sets the request header `hypergraph: 'hypergraphstring_env'`. With that header TwinPod returns the pod's **Neo hypergraph view** of the resource, in which the note's type lives on a state node (`@t_type → @a_paragraph`) rather than as a direct `rdf:type` triple on the note URI. The Phase 2 filter `match(null, rdf:type, a_paragraph)` therefore matched zero candidates on every real pod — the home-screen note list silently returned `[]` even when the notes existed and were readable by `useTwinPodNoteRead` (which has bypassed the hypergraph header since day one for exactly this reason). Verified 2026-04-19 against `tst-ia2.demo.systemtwin.com`: note "big baller" (typed `@a_paragraph` "Unit of Thought") was present on the pod and visible via another app, but did not appear in NoteWorld's home list.
- Without the hypergraph header the pod echoes back the resource's actual Turtle — the same bytes we PUT during save — which DOES contain `<subject> a neo:a_paragraph ; <text-pred> "…"`. The rdf:type match now finds hits.
- Implementation: Phase 2 maps each candidate through `classifyCandidate(uri)`: direct `session.fetch` → parse into a fresh temp graph → `match(null, rdf:type, typeNode)` against each `typeUri`. A hit on ANY typeUri on ANY subject within the note's own graph classifies the candidate as a note (the subject of the type triple is typically a blank node, not the note URI, so we do not constrain the subject). Per-candidate failures are swallowed so one broken note does not poison the list.
- Public API unchanged. `containerPaths` and `typeUris` options still accepted; behaviour and defaults unchanged.
- Regression guard added: test `'uses window.solid.session.fetch directly; NEVER calls ur.fetchAndSaveTurtle (5.1.6 guard)'` — the spy for `ur.fetchAndSaveTurtle` is wired to throw on any call, so any future refactor that routes Phase 2 through the hypergraph-header path fails loudly. The 5.1.4 guard `'uses ur.fetchAndSaveTurtle for per-candidate classification'` has been replaced by this inverse guard; keeping the old guard would lock in the bug.
- Test harness rewritten to mock `window.solid.session.fetch` and route per-graph `.match()` calls by the base URI recorded at `$rdf.parse` time. No test in the 5.1.5 harness could have caught this bug because they mocked `ur.rdfStore.match` directly, bypassing the actual fetch path — their passes depended on fictional data the real pod never serves.

## [5.1.5] - 2026-04-18
### Changed — retire dead URI `http://schema.org/Note`, adopt `neo:a_paragraph`
- `http://schema.org/Note` does not exist in the schema.org vocabulary (verified 2026-04-18). Every prior version that wrote `a schema:Note` was minting an unresolvable type URI, and the v5.1.2/5.1.3/5.1.4 search filters that included `schema:Note` in the union were carrying a dead leg. This release replaces it with the existing Neo native type `https://neo.graphmetrix.net/node/a_paragraph` ("unit of thought", confirmed by Kai 2026-04-18 against the live Neo ontology).
- `useTwinPodNoteCreate`: `DEFAULT_TYPE_URI` flips `http://schema.org/Note` → `https://neo.graphmetrix.net/node/a_paragraph`. New notes are now typed `neo:a_paragraph`.
- `useTwinPodNoteSave`: `DEFAULT_TYPE_URI` flips the same way; the inline Turtle template now emits `@prefix neo: <https://neo.graphmetrix.net/node/> .` and `_:t1 a neo:a_paragraph` (replacing the `schema:` prefix and `schema:Note` type).
- `useTwinPodNoteSearch`: `DEFAULT_TYPE_URIS` becomes `['https://neo.graphmetrix.net/node/a_paragraph', 'https://neo.graphmetrix.net/node/a_note']` — `schema:Note` removed (dead URI), `a_note` retained for back-compat with notes written by earlier NoteWorld versions and other Neo-shaped tooling. The Phase-2 type-match logic is unchanged; only the default URI list shifted.
- Regression guard rewritten, not deleted: the v5.1.2 `'includes schema:Note in the queried types'` guard now reads `'includes neo:a_paragraph in the queried types (5.1.5 guard)'`. Deleting the guard would have left no protection against a future re-narrowing of the default type list; rewriting it preserves the protection on the new canonical type.
- Pod-data migration: NONE. Pre-5.1.5 notes typed `schema:Note` remain in pods and continue to be findable through the `a_note` leg of the union for any pod that has them; the union also accepts existing `a_note`-typed notes from earlier NoteWorld writes. New notes are typed `a_paragraph` going forward.
- Public API surface unchanged. `predicateUri` / `typeUri` options still accepted; only their defaults moved.

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
