// UNIT_TYPE=Hook

/**
 * Loads short text previews for a list of note URIs.
 *
 * Uses ur.fetchResourceTurtle (no hypergraph header) so TwinPod returns the
 * actual note Turtle instead of the pod knowledge graph.
 * Fetches all URIs in parallel and stores results in a reactive object.
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

// TwinPod stores \uXXXX escape sequences verbatim — unescape on read.
function unescapeTurtleString(str) {
  if (!str) return str
  return str
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\U([0-9A-Fa-f]{8})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
}

export function useTwinPodNotePreviews({ predicateUri = DEFAULT_TEXT_PREDICATE, maxLength = 60 } = {}) {
  const previews = ref({})

  async function fetchPreview(uri) {
    // Show cached text immediately while fetch is in flight
    try {
      const cached = localStorage.getItem('notetext:' + uri)
      if (cached) previews.value[uri] = cached.length > maxLength ? cached.slice(0, maxLength) + '…' : cached
    } catch { /* ignore */ }

    try {
      const { ok, turtle } = await ur.fetchResourceTurtle(uri)
      if (!ok) return
      const tempGraph = ur.$rdf.graph()
      ur.$rdf.parse(turtle, tempGraph, uri, 'text/turtle')
      const pred = ur.$rdf.sym(predicateUri)
      const gmxPred = ur.$rdf.sym(GMX_TEXT_PREDICATE)
      const statements = tempGraph.statementsMatching(null, pred, null, null)
      const fallback = tempGraph.statementsMatching(null, gmxPred, null, null)
      const all = [...statements, ...fallback]
      const text = all.length > 0 ? unescapeTurtleString(all[all.length - 1].object.value).trim() : ''
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
