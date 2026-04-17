// UNIT_TYPE=Hook

/**
 * Creates a new note on TwinPod using the Stack B rdflib Turtle pipeline.
 *
 * Pipeline: build triples in a temp ur.$rdf.graph() → ur.storeToTurtle → ur.modifyTurtle
 * → ur.uploadTurtleToResource (PUT text/turtle to create the target resource).
 *
 * The resource URI is client-minted as `{podRoot}/t/t_note_{ts}_{rand4}`.
 * A blank node subject carries `rdf:type schema:Note` and `schema:text " "`.
 *
 * @param {object} [options]
 * @param {string} [options.typeUri='http://schema.org/Note'] - RDF type for the Note.
 *
 * @returns {{
 *   noteUri: import('vue').Ref<string|null>,
 *   loading: import('vue').Ref<boolean>,
 *   error:   import('vue').Ref<{type: string, message: string, status?: number}|null>,
 *   createNote: (podBaseUrl: string) => Promise<string|null>
 * }}
 *
 * Error types: 'invalid-input', 'http', 'network'.
 */

import { ref } from 'vue'
import { ur } from '@kaigilb/twinpod-client'

const DEFAULT_TYPE_URI = 'http://schema.org/Note'
const INITIAL_TEXT = ' '

function mintResourceId() {
  const rand = Math.random().toString(36).slice(2, 6)
  return `t_note_${Date.now()}_${rand}`
}

export function useTwinPodNoteCreate({ typeUri = DEFAULT_TYPE_URI } = {}) {
  const noteUri = ref(null)
  const loading = ref(false)
  const error = ref(null)

  async function createNote(podBaseUrl) {
    if (!podBaseUrl) {
      error.value = { type: 'invalid-input', message: 'podBaseUrl is required' }
      return null
    }

    noteUri.value = null
    loading.value = true
    error.value = null

    const root = podBaseUrl.endsWith('/') ? podBaseUrl.slice(0, -1) : podBaseUrl
    const resourceId = mintResourceId()
    const resourceUrl = `${root}/t/${resourceId}`

    try {
      const { node: noteBlank } = ur.getBlankNode('Note: ' + resourceId)

      const tempStore = ur.$rdf.graph()
      const add = (s, p, o) => tempStore.add(s, p, o, ur.$rdf.defaultGraph())

      add(noteBlank, ur.NS.RDF('type'), ur.$rdf.sym(typeUri))
      add(noteBlank, ur.NS.SCHEMA('text'), ur.$rdf.literal(INITIAL_TEXT))

      let turtle = ur.storeToTurtle(tempStore, '')
      turtle = ur.modifyTurtle(turtle)

      const result = await ur.uploadTurtleToResource(resourceUrl, turtle, { method: 'PUT', returnResponse: true })

      if (!result.ok) {
        error.value = { type: 'http', status: result.status, message: `Create failed with HTTP ${result.status}` }
        return null
      }

      noteUri.value = resourceUrl
      return resourceUrl
    } catch (e) {
      error.value = { type: 'network', message: e?.message || String(e) }
      return null
    } finally {
      loading.value = false
    }
  }

  return { noteUri, loading, error, createNote }
}
