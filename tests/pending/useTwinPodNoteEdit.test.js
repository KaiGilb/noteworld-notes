// PENDING: F.Edit_Note — waiting for implementation in a future increment

import { describe, test, expect, vi } from 'vitest'
import * as packageExports from '../../src/index.js'

// Spec: F.Edit_Note — Add, modify, or remove text in a note.
// Success-Criteria: The note content reflects the user's additions, modifications, or removals.
//
// All tests in this file will FAIL until useTwinPodNoteEdit is implemented and exported.

const POD_BASE = 'https://tst-first.demo.systemtwin.com'
const NOTE_URI = POD_BASE + '/node/t_abc1'

describe('useTwinPodNoteEdit', () => {

  // Spec: F.Edit_Note — the composable must exist and be exported from the package
  test('useTwinPodNoteEdit is exported from the package', () => {
    expect(typeof packageExports.useTwinPodNoteEdit).toBe('function')
  })

  // Spec: F.Edit_Note — composable must expose a saveContent function
  test('exposes a saveContent function', () => {
    const { useTwinPodNoteEdit } = packageExports
    expect(typeof useTwinPodNoteEdit).toBe('function')
    const hyperFetch = vi.fn()
    const { saveContent } = useTwinPodNoteEdit(hyperFetch)
    expect(typeof saveContent).toBe('function')
  })

  // Spec: F.Edit_Note — composable must expose reactive loading state
  test('exposes reactive loading state starting at false', () => {
    const { useTwinPodNoteEdit } = packageExports
    expect(typeof useTwinPodNoteEdit).toBe('function')
    const hyperFetch = vi.fn()
    const { loading } = useTwinPodNoteEdit(hyperFetch)
    expect(loading.value).toBe(false)
  })

  // Spec: F.Edit_Note — composable must expose reactive error state starting at null
  test('exposes reactive error state starting at null', () => {
    const { useTwinPodNoteEdit } = packageExports
    expect(typeof useTwinPodNoteEdit).toBe('function')
    const hyperFetch = vi.fn()
    const { error } = useTwinPodNoteEdit(hyperFetch)
    expect(error.value).toBeNull()
  })

  // Spec: F.Edit_Note — saving content must PUT updated Turtle to TwinPod (LWS write standard)
  test('calls hyperFetch with PUT method to update the note', async () => {
    const { useTwinPodNoteEdit } = packageExports
    expect(typeof useTwinPodNoteEdit).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const { saveContent } = useTwinPodNoteEdit(hyperFetch)
    await saveContent(NOTE_URI, 'My note content')
    expect(hyperFetch).toHaveBeenCalledWith(
      NOTE_URI,
      expect.objectContaining({ method: 'PUT' })
    )
  })

  // Spec: F.Edit_Note — saved content must be serialised as Turtle (TwinPod write standard)
  test('sets Content-Type: text/turtle when saving', async () => {
    const { useTwinPodNoteEdit } = packageExports
    expect(typeof useTwinPodNoteEdit).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const { saveContent } = useTwinPodNoteEdit(hyperFetch)
    await saveContent(NOTE_URI, 'My note content')
    expect(hyperFetch).toHaveBeenCalledWith(
      NOTE_URI,
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'text/turtle' }) })
    )
  })

  // Spec: F.Edit_Note — Success-Criteria: note content reflects user's modifications
  test('returns true on successful save', async () => {
    const { useTwinPodNoteEdit } = packageExports
    expect(typeof useTwinPodNoteEdit).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const { saveContent } = useTwinPodNoteEdit(hyperFetch)
    const result = await saveContent(NOTE_URI, 'My note content')
    expect(result).toBe(true)
  })

  // Spec: ERROR_HANDLING_01 — must explicitly handle 403 Forbidden
  test('sets error when TwinPod returns 403', async () => {
    const { useTwinPodNoteEdit } = packageExports
    expect(typeof useTwinPodNoteEdit).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({ ok: false, status: 403 })
    const { saveContent, error } = useTwinPodNoteEdit(hyperFetch)
    await saveContent(NOTE_URI, 'content')
    expect(error.value).toMatchObject({ type: 'http', status: 403 })
  })

  // Spec: ERROR_HANDLING_01 — network failures must be exposed, not swallowed
  test('sets error on network failure', async () => {
    const { useTwinPodNoteEdit } = packageExports
    expect(typeof useTwinPodNoteEdit).toBe('function')
    const hyperFetch = vi.fn().mockRejectedValue(new Error('Network failure'))
    const { saveContent, error } = useTwinPodNoteEdit(hyperFetch)
    await saveContent(NOTE_URI, 'content')
    expect(error.value).toMatchObject({ type: 'network' })
  })

})
