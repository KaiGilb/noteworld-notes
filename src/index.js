// UNIT_TYPE=Feature

/**
 * @package @kaigilb/noteworld-notes
 * @description Vue composables for creating, saving, reading, and searching notes in a TwinPod pod.
 *
 * Public API (5.x — single ur namespace):
 * - useTwinPodNoteCreate   — creates a resource under {podRoot}/t/ with schema:Note (Stack B)
 * - useTwinPodNoteSave     — persists note text (schema:text) to an existing note resource (Stack B)
 * - useTwinPodNoteRead     — reads note text via direct session.fetch (no hypergraph header)
 * - useTwinPodNoteSearch   — searches for notes via ur.searchAndGetURIs
 * - useTwinPodNotePreviews — loads short text previews for a list of note URIs
 *
 * All composables use { ur } from @kaigilb/twinpod-client internally; no solidFetch param.
 *
 * @see Spec: /Users/kaigilb/Vault_Ideas/5 - Project/NoteWorld/NoteWorld.md
 */

export { useTwinPodNoteCreate } from './composables/useTwinPodNoteCreate.js'
export { useTwinPodNoteSave } from './composables/useTwinPodNoteSave.js'
export { useTwinPodNoteRead } from './composables/useTwinPodNoteRead.js'
export { useTwinPodNoteSearch } from './composables/useTwinPodNoteSearch.js'
export { useTwinPodNotePreviews } from './composables/useTwinPodNotePreviews.js'
