// UNIT_TYPE=Hook

/**
 * Reads a note's current text from its TwinPod resource.
 *
 * Fetches the resource Turtle via window.solid.session.fetch (no hypergraph
 * header — avoids TwinPod returning the full pod knowledge graph instead of
 * the specific resource), parses it into a local temp graph, then queries for
 * all statements with the text predicate. Returns the last value — TwinPod
 * preserves state history; the current value is the last statement in
 * serialisation order.
 *
 * @param {object} [options]
 * @param {string} [options.predicateUri='http://schema.org/text'] - Predicate to read.
 *
 * @returns {{
 *   text:    import('vue').Ref<string|null>,
 *   loading: import('vue').Ref<boolean>,
 *   error:   import('vue').Ref<{type: string, message: string, status?: number}|null>,
 *   loadNote: (noteResourceUrl: string) => Promise<string|null>
 * }}
 *
 * Error types: 'invalid-input', 'not-found', 'http', 'network'.
 */

import { ref } from 'vue'
import { ur } from '@kaigilb/twinpod-client'

const DEFAULT_TEXT_PREDICATE = 'http://schema.org/text'
const GMX_TEXT_PREDICATE = 'http://graphmetrix.com/node#m_text'

export function useTwinPodNoteRead({ predicateUri = DEFAULT_TEXT_PREDICATE } = {}) {
  const text = ref(null)
  const loading = ref(false)
  const error = ref(null)

  async function loadNote(noteResourceUrl) {
    if (!noteResourceUrl) {
      error.value = { type: 'invalid-input', message: 'noteResourceUrl is required' }
      return null
    }

    text.value = null
    loading.value = true
    error.value = null

    try {
      // Use session.fetch directly — no hypergraph header, so TwinPod returns
      // the actual resource Turtle instead of the full pod knowledge graph.
      const response = await window.solid.session.fetch(noteResourceUrl, {
        headers: {
          Accept: 'text/turtle',
          'Cache-Control': 'max-age=0'
        }
      })

      if (response.status === 404) {
        error.value = { type: 'not-found', message: `Note not found: ${noteResourceUrl}` }
        return null
      }

      if (!response.ok) {
        error.value = { type: 'http', status: response.status, message: `HTTP ${response.status}` }
        return null
      }

      const turtle = await response.text()
      const tempGraph = ur.$rdf.graph()
      ur.$rdf.parse(turtle, tempGraph, noteResourceUrl, 'text/turtle')
      const pred = ur.$rdf.sym(predicateUri)
      const gmxPred = ur.$rdf.sym(GMX_TEXT_PREDICATE)
      const s1 = tempGraph.statementsMatching(null, pred, null, null)
      const s2 = tempGraph.statementsMatching(null, gmxPred, null, null)
      const all = [...s1, ...s2]
      let value = all.length > 0 ? all[all.length - 1].object.value : ''
      if (!value.trim()) {
        try { value = localStorage.getItem('notetext:' + noteResourceUrl) || '' } catch { /* ignore */ }
      }
      text.value = value
      return value
    } catch (e) {
      error.value = { type: 'network', message: e?.message || String(e) }
      return null
    } finally {
      loading.value = false
    }
  }

  return { text, loading, error, loadNote }
}
