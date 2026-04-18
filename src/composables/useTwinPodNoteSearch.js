// UNIT_TYPE=Hook

/**
 * Lists notes in a TwinPod pod by RDF type.
 *
 * Two-phase, type-driven discovery:
 *
 *   Phase 1 — enumerate candidate resources.
 *     GET each container in `containerPaths` as Turtle, parse into a
 *     TEMPORARY rdflib graph, and pull every `ldp:contains` object. The
 *     parse is temporary so the container's own LDP metadata (ldp:contains,
 *     uri4uri:path, sio:SIO_000148 reification types, etc.) does not
 *     pollute the shared `ur.rdfStore` — that store is reserved for
 *     type/attribute triples we actually want to filter on.
 *
 *   Phase 2 — classify each candidate by RDF type.
 *     Fire one `ur.fetchAndSaveTurtle` per candidate in parallel. Each
 *     parses the resource's own Turtle (which includes `a schema:Note`
 *     or `a neo:a_note` when NoteWorld or compatible tooling wrote it)
 *     into the shared `ur.rdfStore`. After all settle, we run ONE type
 *     match across the store and filter to the subjects in our candidate
 *     set (so unrelated triples already in the store from other
 *     composables don't leak into the result).
 *
 * Why this shape — and why NOT `/search/…`:
 *   TwinPod's `/search/{concept}` endpoint is a per-pod keyword index,
 *   not a type enumerator. Concept names are resolved against the pod's
 *   Neo ontology map and are NOT portable — verified 2026-04-18: the
 *   same 15 notes that `tst-first.demo.systemtwin.com/search/note`
 *   returns are entirely absent from `tst-ia2.demo.systemtwin.com`'s
 *   search index (returns 200 empty-body for both 'note' and effectively
 *   empty for 'notes'). We cannot rely on search to enumerate notes.
 *   The container listing is the only primitive that works on every pod.
 *
 * Why containerPaths is a parameter, not a constant:
 *   Per `Rule_Code_twinpod-client-package.md`'s "no hardcoded ontology"
 *   rule and the "interim `/t/` container as ACL workaround" framing in
 *   `project_twinpod_data_driven_layout` memory, the container path is
 *   a deployment detail, not a semantic criterion. The DEFAULT `['/t/']`
 *   matches the current NoteWorld invariant; callers running against
 *   pods with a different layout can override without forking.
 *
 *   CRITICAL: the container path is used ONLY to enumerate candidates.
 *   The note-ness decision is still made by the `typeUris` filter after
 *   Phase 2. If a resource's URI path happens to match a different
 *   container but its type is schema:Note, it is still discovered as
 *   long as that container is in `containerPaths`. URI-prefix filtering
 *   (e.g. requiring `/t/t_note_` in the path) is explicitly NOT done —
 *   discovery is about types, not about URI naming conventions.
 *
 * Why typeUris is a parameter:
 *   Same rule — the note types could be `schema:Note`, `neo:a_note`,
 *   or a future refinement. Defaults cover both today (NoteWorld writes
 *   `schema:Note`; other tooling may reify as `neo:a_note`).
 *
 * Error model:
 *   - Container listing: every path is attempted independently.
 *     `discovery-error` is set only when EVERY container listing fails.
 *     A single path failing is tolerated.
 *   - Per-resource GET: every GET is attempted independently
 *     (`Promise.allSettled`). A 404/500 on one note does not poison the
 *     others; the type match simply won't see a triple for it.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.containerPaths=['/t/']]
 *   Container paths (relative to podRoot, with leading and trailing
 *   slash) to enumerate. Listed in parallel; results unioned by URI.
 * @param {string[]} [opts.typeUris]
 *   Full URIs of RDF types that qualify a resource as a note. Defaults
 *   to `['http://schema.org/Note', 'https://neo.graphmetrix.net/node/a_note']`.
 *   A resource typed ANY of these is included.
 *
 * @returns {{
 *   notes:   import('vue').Ref<Array<{ uri: string }>>,
 *   loading: import('vue').Ref<boolean>,
 *   error:   import('vue').Ref<{type: string, message: string}|null>,
 *   searchNotes: (podRoot: string) => Promise<Array<{ uri: string }>>
 * }}
 *
 * Error types: 'invalid-input', 'discovery-error', 'network'.
 */

import { ref } from 'vue'
import { ur } from '@kaigilb/twinpod-client'

const DEFAULT_CONTAINER_PATHS = ['/t/']
const DEFAULT_TYPE_URIS = [
  'http://schema.org/Note',
  'https://neo.graphmetrix.net/node/a_note'
]

export function useTwinPodNoteSearch(opts = {}) {
  const containerPaths = Array.isArray(opts.containerPaths) && opts.containerPaths.length > 0
    ? opts.containerPaths
    : DEFAULT_CONTAINER_PATHS
  const typeUris = Array.isArray(opts.typeUris) && opts.typeUris.length > 0
    ? opts.typeUris
    : DEFAULT_TYPE_URIS

  const notes = ref([])
  const loading = ref(false)
  const error = ref(null)

  // Enumerates ldp:contains subjects from a single container. Returns
  // { uris: string[], failed: boolean }. An empty container is
  // { uris: [], failed: false } — not a failure.
  async function listContainer(containerUrl) {
    try {
      const res = await ur.hyperFetch(containerUrl, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'text/turtle' }
      })
      if (!res.ok) return { uris: [], failed: true }
      const turtle = await res.text()

      const tmp = ur.$rdf.graph()
      ur.$rdf.parse(turtle, tmp, containerUrl, 'text/turtle')

      const uris = tmp
        .match(ur.$rdf.sym(containerUrl), ur.NS.LDP('contains'), null)
        .map(st => st.object.value)

      return { uris, failed: false }
    } catch {
      return { uris: [], failed: true }
    }
  }

  async function searchNotes(podRoot) {
    if (!podRoot) {
      error.value = { type: 'invalid-input', message: 'podRoot is required' }
      return []
    }

    loading.value = true
    error.value = null

    const root = podRoot.endsWith('/') ? podRoot.slice(0, -1) : podRoot

    try {
      // Phase 1 — enumerate.
      const containerResults = await Promise.allSettled(
        containerPaths.map(path => listContainer(`${root}${path}`))
      )

      const candidates = []
      const seenCandidates = new Set()
      let anyContainerOk = false
      for (const r of containerResults) {
        if (r.status === 'fulfilled' && !r.value.failed) {
          anyContainerOk = true
          for (const uri of r.value.uris) {
            if (!seenCandidates.has(uri)) {
              seenCandidates.add(uri)
              candidates.push(uri)
            }
          }
        }
      }

      if (!anyContainerOk) {
        // Every container listing failed. We have no enumeration and
        // cannot classify — this is a real failure, not empty state.
        error.value = {
          type: 'discovery-error',
          message: 'All container listings failed'
        }
        notes.value = []
        return []
      }

      // Fast path: zero candidates → zero notes, no GETs needed.
      if (candidates.length === 0) {
        notes.value = []
        return []
      }

      // Phase 2 — classify. One parallel GET per candidate; each parses
      // its own rdf:type triples into the shared ur.rdfStore. Failures
      // are swallowed (the store simply won't get triples for that URI,
      // so it drops out of the filter below).
      await Promise.allSettled(
        candidates.map(uri => ur.fetchAndSaveTurtle(uri, true))
      )

      // ONE type match across the store, restricted to our candidate set.
      // The candidate set filter prevents the store's existing triples
      // (from other composables on the same page) from leaking in.
      const hits = []
      const seenHits = new Set()
      for (const typeUri of typeUris) {
        const typeNode = ur.$rdf.sym(typeUri)
        const stmts = ur.rdfStore.match(null, ur.NS.RDF('type'), typeNode)
        for (const st of stmts) {
          const uri = st.subject.value
          if (seenCandidates.has(uri) && !seenHits.has(uri)) {
            seenHits.add(uri)
            hits.push({ uri })
          }
        }
      }

      notes.value = hits
      return hits
    } catch (e) {
      // Per-step failures are already absorbed inside listContainer and
      // Promise.allSettled; this catches anything thrown by the type
      // match itself or by unexpected bugs.
      error.value = { type: 'network', message: e?.message || String(e) }
      notes.value = []
      return []
    } finally {
      loading.value = false
    }
  }

  return { notes, loading, error, searchNotes }
}
