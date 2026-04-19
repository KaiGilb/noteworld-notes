// UNIT_TYPE=Hook

/**
 * Persists a note's text to its existing TwinPod resource.
 *
 * Builds the Turtle string directly (bypassing rdflib serialize + modifyTurtle)
 * to avoid modifyTurtle corrupting multi-line text — rdflib serialises long strings
 * as triple-quoted literals ("""…"""), and modifyTurtle's replaceAll('"""', '"')
 * breaks them. The text is manually escaped for Turtle single-line string syntax.
 *
 * Background PUT (S.OptimisticSave / Increment 1):
 * `saveNote` returns to its caller without awaiting the PUT. The PUT runs in
 * the background; UI state is exposed via `saving` / `saved` / `error` refs.
 * The returned Promise still resolves to the eventual PUT outcome so existing
 * await-style callers keep working.
 *
 * HTTP method — 5.1.1 fix:
 * Uses `method: 'PUT'` (full-replace). PATCH text/turtle is not a valid Solid
 * operation — the real pod responds 401 "session expired" when PATCH is used
 * with Content-Type: text/turtle. PUT matches Create's behaviour and the
 * "build whole Turtle document on every save" model this composable already
 * follows.
 *
 * Coalescing — last-write-wins: at most one PUT is in flight per composable
 * instance plus at most one queued. Rapid saves drop their text into the
 * queued slot, replacing whatever was waiting; only the most recent text is
 * actually sent in the next PUT.
 *
 * @param {object} [options]
 * @param {string} [options.predicateUri='http://schema.org/text'] - Predicate for the note body.
 * @param {string} [options.typeUri='https://neo.graphmetrix.net/node/a_paragraph'] - RDF type for the Note.
 *
 * @returns {{
 *   saving: import('vue').Ref<boolean>,
 *   saved:  import('vue').Ref<boolean>,
 *   error:  import('vue').Ref<{type: string, message: string, status?: number}|null>,
 *   saveNote: (noteResourceUrl: string, text: string) => Promise<boolean>
 * }}
 *
 * `saving` is true from the moment a save is requested until the queue fully
 * drains (current PUT settled and no queued PUT remains).
 *
 * Error types: 'invalid-input', 'http', 'network'.
 */

import { ref } from 'vue'
import { ur } from '@kaigilb/twinpod-client'

const DEFAULT_TEXT_PREDICATE = 'http://schema.org/text'
const DEFAULT_TYPE_URI = 'https://neo.graphmetrix.net/node/a_paragraph'

function escapeTurtleString(str) {
  // Escape only the characters that Turtle string syntax requires: backslash,
  // double-quote, and the three ASCII control characters that would break the
  // single-line string literal.
  //
  // Non-ASCII characters (æøå, emoji, …) are passed through as raw UTF-8 bytes.
  // Earlier versions escaped these as \uXXXX; that caused TwinPod's server-side
  // Turtle parser to truncate the stored string at the first escape sequence,
  // silently losing all text from that character onwards. Raw UTF-8 does not
  // trigger that bug and is valid per Turtle 1.1 §3.3.
  //
  // unescapeTurtleString in the read composables is retained so any notes saved
  // with the old \uXXXX encoding are still decoded correctly.
  let result = ''
  for (const char of str) {
    if (char === '\\') { result += '\\\\'; continue }
    if (char === '"')  { result += '\\"';  continue }
    if (char === '\n') { result += '\\n';  continue }
    if (char === '\r') { result += '\\r';  continue }
    if (char === '\t') { result += '\\t';  continue }
    result += char
  }
  return result
}

export function useTwinPodNoteSave({ predicateUri = DEFAULT_TEXT_PREDICATE, typeUri = DEFAULT_TYPE_URI } = {}) {
  const saving = ref(false)
  const saved = ref(false)
  const error = ref(null)

  // Coalescing queue (closure-scoped — one queue per composable instance).
  let inflight = false
  let pending = null              // { url, text, resolvers: [] } — most recent waiting save
  let currentResolvers = []       // resolvers attached to the in-flight PUT

  async function runPut(noteResourceUrl, text) {
    try {
      const safeText = text.trim() !== '' ? text : ' '
      // Use the resource URI as the Turtle subject — not a blank node.
      // TwinPod's search index associates rdf:type with the resource URI; a blank
      // node subject leaves the note URI untyped so it never appears in search results.
      const turtle = `@prefix neo: <https://neo.graphmetrix.net/node/> .\n<${noteResourceUrl}> a neo:a_paragraph ; <${predicateUri}> "${escapeTurtleString(safeText)}" .\n`

      // method: 'PUT' — full-replace semantics match our "build complete Turtle
      // document" pattern. Default PATCH with Content-Type: text/turtle is not
      // a valid Solid operation (PATCH needs application/sparql-update or n3),
      // and this pod misreports that as 401 "session expired". See Create.
      const result = await ur.uploadTurtleToResource(noteResourceUrl, turtle, { method: 'PUT', returnResponse: true })

      if (!result.ok) {
        error.value = { type: 'http', status: result.status, message: `Save failed with HTTP ${result.status}` }
        return false
      }

      saved.value = true
      try { localStorage.setItem('notetext:' + noteResourceUrl, text) } catch { /* ignore */ }
      return true
    } catch (e) {
      error.value = { type: 'network', message: e?.message || String(e) }
      return false
    }
  }

  async function drain(noteResourceUrl, text) {
    const ok = await runPut(noteResourceUrl, text)

    // Resolve everyone whose call rode this PUT (including any coalesced into it).
    const resolversToCall = currentResolvers
    currentResolvers = []
    resolversToCall.forEach(r => r(ok))

    if (pending) {
      // Drain the queued save without flipping `saving` false in between.
      const next = pending
      pending = null
      currentResolvers = next.resolvers
      drain(next.url, next.text)
    } else {
      inflight = false
      saving.value = false
    }
  }

  function saveNote(noteResourceUrl, text) {
    if (!noteResourceUrl) {
      error.value = { type: 'invalid-input', message: 'noteResourceUrl is required' }
      return Promise.resolve(false)
    }
    if (typeof text !== 'string') {
      error.value = { type: 'invalid-input', message: 'text must be a string' }
      return Promise.resolve(false)
    }

    saving.value = true
    saved.value = false
    error.value = null

    return new Promise((resolve) => {
      if (inflight) {
        // Last-write-wins: replace any queued save's payload, accumulate resolvers
        // so every coalesced caller learns the eventual outcome.
        const carriedResolvers = pending ? pending.resolvers : []
        pending = { url: noteResourceUrl, text, resolvers: [...carriedResolvers, resolve] }
        return
      }
      inflight = true
      currentResolvers = [resolve]
      drain(noteResourceUrl, text)
    })
  }

  return { saving, saved, error, saveNote }
}
