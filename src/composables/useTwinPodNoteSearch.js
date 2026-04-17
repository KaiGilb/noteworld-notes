// UNIT_TYPE=Hook

/**
 * Lists notes from the TwinPod pod by reading the LDP container at {podRoot}/t/
 * for legacy notes, combined with TwinPod search for neo:a_fragmented-document
 * typed resources for notes created via the native graph store.
 *
 * Primary: LDP container listing of {podRoot}/t/ (fast, complete for /t/ notes).
 * Secondary: TwinPod search endpoint for neo:a_fragmented-document (finds /node/ notes).
 * Results are deduplicated by URI.
 *
 * @returns {{
 *   notes:   import('vue').Ref<Array<{ uri: string }>>,
 *   loading: import('vue').Ref<boolean>,
 *   error:   import('vue').Ref<{type: string, message: string}|null>,
 *   searchNotes: (podRoot: string) => Promise<Array<{ uri: string }>>
 * }}
 */

import { ref } from 'vue'
import { ur } from '@kaigilb/twinpod-client'

const LDP_CONTAINS = 'http://www.w3.org/ns/ldp#contains'

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
    const seen = new Set()
    const results = []

    function addUri(uri) {
      if (!seen.has(uri)) {
        seen.add(uri)
        results.push({ uri })
      }
    }

    try {
      // 1. LDP container listing of /t/ for legacy notes
      try {
        const res = await window.solid.session.fetch(`${root}/t/`, {
          headers: { Accept: 'text/turtle', 'Cache-Control': 'max-age=0' }
        })
        if (res.ok) {
          const turtle = await res.text()
          const g = ur.$rdf.graph()
          ur.$rdf.parse(turtle, g, `${root}/t/`, 'text/turtle')
          g.statementsMatching(null, ur.$rdf.sym(LDP_CONTAINS), null, null)
            .map(st => st.object.value)
            .filter(uri => uri.includes('t_note_'))
            .forEach(addUri)
        }
      } catch { /* ignore — fall through to search */ }

      // 2. TwinPod search for neo:a_fragmented-document (finds /node/ notes)
      try {
        const searchResult = await ur.searchAndGetURIs(root, 'note', {
          force: true, lang: 'en', rows: 100, start: 0
        })
        if (!searchResult.error && !(searchResult.status >= 400)) {
          ur.rdfStore
            .match(null, ur.NS.RDF('type'), ur.NS.NEO('a_fragmented-document'))
            .forEach(st => addUri(st.subject.value))
        }
      } catch { /* ignore */ }

      notes.value = results
      return results
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
