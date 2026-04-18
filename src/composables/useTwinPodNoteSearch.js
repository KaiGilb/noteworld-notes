// UNIT_TYPE=Hook

/**
 * Lists notes in a TwinPod pod by RDF type, not by container.
 *
 * Notes are discovered via the TwinPod search endpoint — a pod-local concept
 * lookup that returns Turtle into `ur.rdfStore`. The returned store is then
 * filtered for subjects typed either `schema:Note` OR `neo:a_note`.
 *
 * Design note — type-driven discovery (5.1.1):
 *   Resources are identified by RDF type plus the `t_type_` URI prefix, NOT
 *   by which container they live in. The current interim `/t/` container is
 *   an ACL workaround, not a semantic boundary, so listing it via LDP would
 *   both (a) leak implementation detail into the query, and (b) fail against
 *   pods whose ACL forbids container listing (e.g. `/t/` → 403 on this pod).
 *   v5.0.0 added an LDP listing path alongside the search; it was the wrong
 *   abstraction and has been removed here.
 *
 * Design note — dual-type filter (5.1.2):
 *   `useTwinPodNoteCreate` and `useTwinPodNoteSave` both write notes typed
 *   `schema:Note` (http://schema.org/Note). The v5.1.1 filter matched only
 *   `neo:a_note`, so NoteWorld-authored notes never appeared in F.Find_Note.
 *   We now match on both predicates and union the results:
 *     - `schema:Note`  — what NoteWorld writes (the canonical case).
 *     - `neo:a_note`   — Neo-shaped notes from other tooling or TwinPod
 *                         reifications; kept so a pod that mixes sources
 *                         lists everything rather than hiding half.
 *
 * @returns {{
 *   notes:   import('vue').Ref<Array<{ uri: string }>>,
 *   loading: import('vue').Ref<boolean>,
 *   error:   import('vue').Ref<{type: string, message: string}|null>,
 *   searchNotes: (podRoot: string) => Promise<Array<{ uri: string }>>
 * }}
 *
 * Error types: 'invalid-input', 'search-error', 'network'.
 */

import { ref } from 'vue'
import { ur } from '@kaigilb/twinpod-client'

export function useTwinPodNoteSearch() {
  const notes = ref([])
  const loading = ref(false)
  const error = ref(null)

  async function searchNotes(podRoot) {
    if (!podRoot) {
      error.value = { type: 'invalid-input', message: 'podRoot is required' }
      return []
    }

    loading.value = true
    error.value = null

    const root = podRoot.endsWith('/') ? podRoot.slice(0, -1) : podRoot

    try {
      const searchResult = await ur.searchAndGetURIs(root, 'note', {
        force: true, lang: 'en', rows: 100, start: 0
      })

      if (searchResult?.error) {
        error.value = { type: 'search-error', message: 'Search returned an error' }
        notes.value = []
        return []
      }
      if (typeof searchResult?.status === 'number' && searchResult.status >= 400) {
        error.value = { type: 'search-error', message: `Search failed with HTTP ${searchResult.status}` }
        notes.value = []
        return []
      }

      // Extract subjects typed as notes from the store `searchAndGetURIs`
      // auto-parsed into. Matches EITHER `schema:Note` (what NoteWorld writes)
      // OR `neo:a_note` (Neo-shaped notes from other tooling). Restricting to
      // these two types keeps unrelated 'note'-keyword hits from leaking in.
      const schemaHits = ur.rdfStore
        .match(null, ur.NS.RDF('type'), ur.NS.SCHEMA('Note'))
        .map(st => st.subject.value)
      const neoHits = ur.rdfStore
        .match(null, ur.NS.RDF('type'), ur.NS.NEO('a_note'))
        .map(st => st.subject.value)

      // Union + dedup by URI. A note that is typed both ways (TwinPod
      // reification, or a resource re-saved after an older format) must
      // still appear exactly once.
      const seen = new Set()
      const deduped = []
      for (const uri of [...schemaHits, ...neoHits]) {
        if (!seen.has(uri)) { seen.add(uri); deduped.push({ uri }) }
      }

      notes.value = deduped
      return deduped
    } catch (e) {
      error.value = { type: 'network', message: e?.message || String(e) }
      notes.value = []
      return []
    } finally {
      loading.value = false
    }
  }

  return { notes, loading, error, searchNotes }
}
