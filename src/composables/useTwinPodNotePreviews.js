// UNIT_TYPE=Hook

/**
 * Loads short text previews for a list of note URIs.
 *
 * Uses the same direct window.solid.session.fetch approach as useTwinPodNoteRead
 * (no hypergraph header) so TwinPod returns the actual note Turtle.
 * Fetches all URIs in parallel and stores results in a reactive Map.
 *
 * @param {object} [options]
 * @param {string} [options.predicateUri='http://schema.org/text'] - Predicate to read.
 * @param {number} [options.maxLength=60] - Max preview characters.
 *
 * @returns {{
 *   previews: import('vue').Ref<Record<string, string>>,
 *   loadPreviews: (uris: string[]) => Promise<void>
 * }}
 */

import { ref } from 'vue'
import { ur } from '@kaigilb/twinpod-client'

const DEFAULT_TEXT_PREDICATE = 'http://schema.org/text'
const GMX_TEXT_PREDICATE = 'http://graphmetrix.com/node#m_text'

export function useTwinPodNotePreviews({ predicateUri = DEFAULT_TEXT_PREDICATE, maxLength = 60 } = {}) {
  const previews = ref({})

  async function fetchPreview(uri) {
    // Show cached text immediately while fetch is in flight
    try {
      const cached = localStorage.getItem('notetext:' + uri)
      if (cached) previews.value[uri] = cached.length > maxLength ? cached.slice(0, maxLength) + '…' : cached
    } catch { /* ignore */ }

    try {
      const response = await window.solid.session.fetch(uri, {
        headers: { Accept: 'text/turtle', 'Cache-Control': 'max-age=0' }
      })
      if (!response.ok) return
      const turtle = await response.text()
      const tempGraph = ur.$rdf.graph()
      ur.$rdf.parse(turtle, tempGraph, uri, 'text/turtle')
      const pred = ur.$rdf.sym(predicateUri)
      const gmxPred = ur.$rdf.sym(GMX_TEXT_PREDICATE)
      const statements = tempGraph.statementsMatching(null, pred, null, null)
      const fallback = tempGraph.statementsMatching(null, gmxPred, null, null)
      const all = [...statements, ...fallback]
      const text = all.length > 0 ? all[all.length - 1].object.value.trim() : ''
      if (text) {
        previews.value[uri] = text.length > maxLength ? text.slice(0, maxLength) + '…' : text
        try { localStorage.setItem('notetext:' + uri, text) } catch { /* ignore */ }
      }
    } catch {
      // silently skip — preview is best-effort
    }
  }

  async function loadPreviews(uris) {
    await Promise.all(uris.map(fetchPreview))
  }

  return { previews, loadPreviews }
}
