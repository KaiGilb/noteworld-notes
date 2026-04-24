// UNIT_TYPE=Hook

/**
 * Lists notes in a TwinPod pod by searching for Neo concept types.
 *
 * **TwinPod has no folder structure for data.** Discovery is always
 * type-driven via the pod's search endpoint, never via LDP container
 * listing. (Confirmed by Kai 2026-04-19.)
 *
 * Approach — search-first, two-step SIO class resolution:
 *   For each URI in `typeUris`, derive the Neo concept name (the last
 *   path segment, e.g. `a_paragraph` from
 *   `https://neo.graphmetrix.net/node/a_paragraph`) and call
 *   `ur.searchAndGetURIs(podRoot, conceptName, { force: true })`.
 *
 *   The pod's `{podRoot}/search/{conceptName}` endpoint returns Turtle
 *   where note resources are typed via a SIO class URI (e.g.
 *   `sio:SIO_000110`), not directly as `neo:a_paragraph`. The SIO class
 *   carries `neo:m_cid "a_paragraph"` to link it back to the Neo concept
 *   name. Two-step resolution after each search populates `ur.rdfStore`:
 *     1. Find the SIO class node whose `neo:m_cid` value matches the
 *        concept name (wildcard match on `neo:m_cid`, filter by value).
 *     2. Collect all subjects typed as that class — those are the notes.
 *
 *   Verified 2026-04-19 against tst-ia2.demo.systemtwin.com:
 *   `{pod}/search/a_paragraph` returns Turtle where notes are typed
 *   `rdf:type sio:SIO_000110` and the class carries
 *   `neo:m_cid "a_paragraph"`. `rdf:type neo:a_paragraph` does not appear.
 *
 * Why `force: true`:
 *   Bypasses the `ur.searchAndGetURIs` session cache so new notes appear
 *   immediately without a page reload.
 *
 * Error model:
 *   `search-error` is set only when every search fails (HTTP >= 400 or
 *   all searches reject). A 200 with empty body is a valid empty state
 *   (pod has no notes of that concept yet). Individual search failures
 *   are tolerated; the store match simply won't see triples for that type.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.typeUris]
 *   Full URIs of RDF types that qualify a resource as a note. Defaults
 *   to `['https://neo.graphmetrix.net/node/a_paragraph',
 *           'https://neo.graphmetrix.net/node/a_note']`.
 *   The Neo concept name for the search endpoint is derived as the last
 *   path/fragment segment of each URI.
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

const DEFAULT_TYPE_URIS = [
  'https://neo.graphmetrix.net/node/a_paragraph',
  'https://neo.graphmetrix.net/node/a_note'
]

// Derive the Neo concept name from a full type URI.
// 'https://neo.graphmetrix.net/node/a_paragraph' → 'a_paragraph'
// 'http://example.org/vocab#MyType'              → 'MyType'
function conceptName(typeUri) {
  return typeUri.split('/').pop().split('#').pop()
}

export function useTwinPodNoteSearch(opts = {}) {
  const typeUris = Array.isArray(opts.typeUris) && opts.typeUris.length > 0
    ? opts.typeUris
    : DEFAULT_TYPE_URIS

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

    try {
      // Search for each type's concept name in parallel.
      // Each call parses its Turtle into ur.rdfStore automatically.
      const results = await Promise.allSettled(
        typeUris.map(uri =>
          ur.searchAndGetURIs(podRoot, conceptName(uri), { force: true })
        )
      )

      // search-error only when every search explicitly failed.
      // A resolved search with empty results is valid (no notes yet).
      // HTTP >= 400 counts as failed — a 500 on the search endpoint
      // means we cannot enumerate and should surface an error, not
      // silently return an empty list.
      const anyOk = results.some(
        r => r.status === 'fulfilled' &&
             !r.value?.error &&
             (!r.value?.status || r.value.status < 400)
      )
      if (!anyOk) {
        error.value = { type: 'search-error', message: 'All concept searches failed' }
        notes.value = []
        return []
      }

      // Two-step SIO class resolution — union and dedup across all typeUris.
      //
      // The pod's search response types notes as instances of a SIO class
      // (e.g. rdf:type sio:SIO_000110), not directly as neo:a_paragraph.
      // The Neo concept name is linked to the SIO class via
      // neo:m_cid "a_paragraph" on the class node. So:
      //   Step 1 — find each SIO class whose neo:m_cid value matches
      //            the concept name (wildcard match on M_CID, then filter
      //            by st.object.value to avoid typed-literal comparison).
      //   Step 2 — collect all subjects typed as that SIO class.
      const M_CID = ur.NS.NEO('m_cid')

      const hits = []
      const seen = new Set()

      for (const typeUri of typeUris) {
        const cid = conceptName(typeUri)

        // Step 1: find the SIO class(es) that map to this concept name.
        const classNodes = []
        for (const st of ur.rdfStore.match(null, M_CID, null)) {
          if (st.object.value === cid) {
            classNodes.push(st.subject)
          }
        }

        // Step 2: collect note subjects typed as each matching class.
        for (const classNode of classNodes) {
          for (const noteSt of ur.rdfStore.match(null, ur.NS.RDF('type'), classNode)) {
            const uri = noteSt.subject.value
            // Exclude the concept class node itself (it's typed as a different SIO class)
            if (!seen.has(uri) && uri !== classNode.value) {
              seen.add(uri)
              hits.push({ uri })
            }
          }
        }
      }

      notes.value = hits
      return hits
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
