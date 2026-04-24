// UNIT_TYPE=Hook

/**
 * Creates a new note on TwinPod using the Stack B rdflib Turtle pipeline.
 *
 * Pipeline: build triples in a temp ur.$rdf.graph() → ur.storeToTurtle → ur.modifyTurtle
 * → ur.uploadTurtleToResource (PUT text/turtle to create the target resource).
 *
 * The resource URI is client-minted as `{podRoot}/t/t_note_{ts}_{rand4}`.
 * The resource URI is the RDF subject carrying `rdf:type neo:a_paragraph` and `schema:text " "`.
 * Using the resource URI (not a blank node) ensures TwinPod's search index can associate
 * the type with the resource URI and include the note in search results.
 *
 * Optimistic create (S.OptimisticCreate / Increment 2):
 * `createNote` mints the URI and flips `creating=true` / `pendingUri` synchronously,
 * BEFORE the first `await`. Callers that do not await can read `pendingUri.value`
 * immediately and navigate while the PUT runs in the background. The returned
 * Promise still resolves to the confirmed URI (or null on failure) so existing
 * await-style callers keep working.
 *
 * Callers gating their own behaviour on the create PUT (e.g. deciding whether
 * to skip an initial read) should use the URL query flag `?new=1` set at
 * navigation time — the editor then skips its `loadNote` until the user saves.
 * This increment deliberately does NOT expose a cross-view pending registry;
 * coordination is via the URL only.
 *
 * @param {object} [options]
 * @param {string} [options.typeUri='https://neo.graphmetrix.net/node/a_paragraph'] - RDF type for the Note.
 *
 * @returns {{
 *   pendingUri: import('vue').Ref<string|null>,
 *   noteUri:    import('vue').Ref<string|null>,
 *   creating:   import('vue').Ref<boolean>,
 *   loading:    import('vue').Ref<boolean>,
 *   error:      import('vue').Ref<{type: string, message: string, status?: number}|null>,
 *   createNote: (podBaseUrl: string) => Promise<string|null>
 * }}
 *
 * `pendingUri` is the minted URI the moment createNote is called (before the PUT).
 * `noteUri` is populated only after the PUT succeeds — it is the "server-confirmed"
 * URI. Existing callers that read `noteUri` keep their previous semantics.
 * `creating` is true from the synchronous mint until the PUT settles (success or fail).
 * `loading` is retained as an alias of `creating` for back-compatibility with
 * callers wired up before the optimistic refactor.
 *
 * Error types: 'invalid-input', 'http', 'network'.
 */

import { ref } from 'vue'
import { ur } from '@kaigilb/twinpod-client'

const DEFAULT_TYPE_URI = 'https://neo.graphmetrix.net/node/a_paragraph'
const INITIAL_TEXT = ' '

function mintResourceId() {
  const rand = Math.random().toString(36).slice(2, 6)
  return `t_note_${Date.now()}_${rand}`
}

export function useTwinPodNoteCreate({ typeUri = DEFAULT_TYPE_URI } = {}) {
  const pendingUri = ref(null)
  const noteUri = ref(null)
  const creating = ref(false)
  const loading = ref(false)
  const error = ref(null)

  // --- Background PUT (runs after synchronous mint + state updates) ---

  async function runCreatePut(resourceUrl) {
    try {
      // Use the resource URI as the RDF subject — not a blank node. TwinPod's
      // search index associates rdf:type with the resource URI; a blank node
      // subject leaves the resource URI untyped and the note absent from search.
      const noteNode = ur.$rdf.sym(resourceUrl)

      const tempStore = ur.$rdf.graph()
      const add = (s, p, o) => tempStore.add(s, p, o, ur.$rdf.defaultGraph())

      add(noteNode, ur.NS.RDF('type'), ur.$rdf.sym(typeUri))
      add(noteNode, ur.NS.SCHEMA('text'), ur.$rdf.literal(INITIAL_TEXT))

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
      creating.value = false
      loading.value = false
    }
  }

  // --- Public entry point ---

  function createNote(podBaseUrl) {
    if (!podBaseUrl) {
      error.value = { type: 'invalid-input', message: 'podBaseUrl is required' }
      // Resolved synchronously so await-style callers see null immediately.
      return Promise.resolve(null)
    }

    // Reset state at the start of each call so stale values from a previous
    // failed create don't leak into this one.
    noteUri.value = null
    error.value = null

    const root = podBaseUrl.endsWith('/') ? podBaseUrl.slice(0, -1) : podBaseUrl
    const resourceId = mintResourceId()
    const resourceUrl = `${root}/t/${resourceId}`

    // Synchronous URI exposure: flipped BEFORE the first `await` so a caller
    // reading `pendingUri.value` immediately after `createNote(...)` (without
    // awaiting) sees the minted URI and can navigate optimistically.
    pendingUri.value = resourceUrl
    creating.value = true
    loading.value = true

    return runCreatePut(resourceUrl)
  }

  return { pendingUri, noteUri, creating, loading, error, createNote }
}
