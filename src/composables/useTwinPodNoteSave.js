// UNIT_TYPE=Hook

/**
 * Persists a note's text to its existing TwinPod resource.
 *
 * Builds the Turtle string directly (bypassing rdflib serialize + modifyTurtle)
 * to avoid modifyTurtle corrupting multi-line text — rdflib serialises long strings
 * as triple-quoted literals ("""…"""), and modifyTurtle's replaceAll('"""', '"')
 * breaks them. The text is manually escaped for Turtle single-line string syntax.
 *
 * @param {object} [options]
 * @param {string} [options.predicateUri='http://schema.org/text'] - Predicate for the note body.
 * @param {string} [options.typeUri='http://schema.org/Note'] - RDF type for the Note.
 *
 * @returns {{
 *   saving: import('vue').Ref<boolean>,
 *   saved:  import('vue').Ref<boolean>,
 *   error:  import('vue').Ref<{type: string, message: string, status?: number}|null>,
 *   saveNote: (noteResourceUrl: string, text: string) => Promise<boolean>
 * }}
 *
 * Error types: 'invalid-input', 'http', 'network'.
 */

import { ref } from 'vue'
import { ur } from '@kaigilb/twinpod-client'

const DEFAULT_TEXT_PREDICATE = 'http://schema.org/text'
const DEFAULT_TYPE_URI = 'http://schema.org/Note'

function escapeTurtleString(str) {
  let result = ''
  for (const char of str) {
    const code = char.codePointAt(0)
    if (char === '\\') { result += '\\\\'; continue }
    if (char === '"') { result += '\\"'; continue }
    if (char === '\n') { result += '\\n'; continue }
    if (char === '\r') { result += '\\r'; continue }
    if (char === '\t') { result += '\\t'; continue }
    if (code > 0xFFFF) { result += `\\U${code.toString(16).padStart(8, '0').toUpperCase()}`; continue }
    if (code > 0x7E) { result += `\\u${code.toString(16).padStart(4, '0').toUpperCase()}`; continue }
    result += char
  }
  return result
}

export function useTwinPodNoteSave({ predicateUri = DEFAULT_TEXT_PREDICATE, typeUri = DEFAULT_TYPE_URI } = {}) {
  const saving = ref(false)
  const saved = ref(false)
  const error = ref(null)

  async function saveNote(noteResourceUrl, text) {
    if (!noteResourceUrl) {
      error.value = { type: 'invalid-input', message: 'noteResourceUrl is required' }
      return false
    }
    if (typeof text !== 'string') {
      error.value = { type: 'invalid-input', message: 'text must be a string' }
      return false
    }

    saving.value = true
    saved.value = false
    error.value = null

    try {
      const safeText = text.trim() !== '' ? text : ' '
      const turtle = `@prefix schema: <http://schema.org/> .\n_:t1 a schema:Note ; <${predicateUri}> "${escapeTurtleString(safeText)}" .\n`

      const result = await ur.uploadTurtleToResource(noteResourceUrl, turtle, { returnResponse: true })

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
    } finally {
      saving.value = false
    }
  }

  return { saving, saved, error, saveNote }
}
