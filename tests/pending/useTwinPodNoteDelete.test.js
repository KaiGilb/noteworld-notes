// PENDING: F.Delete_Note — waiting for implementation in a future increment

import { describe, test, expect, vi } from 'vitest'
import * as packageExports from '../../src/index.js'

// Spec: F.Delete_Note — Remove a note from the system.
// Success-Criteria: The note no longer exists in the system and is not accessible through any function.
//
// All tests in this file will FAIL until useTwinPodNoteDelete is implemented and exported.

const NOTE_URI = 'https://tst-first.demo.systemtwin.com/node/t_abc1'

describe('useTwinPodNoteDelete', () => {

  // Spec: F.Delete_Note — the composable must exist and be exported from the package
  test('useTwinPodNoteDelete is exported from the package', () => {
    expect(typeof packageExports.useTwinPodNoteDelete).toBe('function')
  })

  // Spec: F.Delete_Note — composable must expose a deleteNote function
  test('exposes a deleteNote function', () => {
    const { useTwinPodNoteDelete } = packageExports
    expect(typeof useTwinPodNoteDelete).toBe('function')
    const hyperFetch = vi.fn()
    const { deleteNote } = useTwinPodNoteDelete(hyperFetch)
    expect(typeof deleteNote).toBe('function')
  })

  // Spec: F.Delete_Note — composable must expose reactive loading and error state
  test('exposes reactive loading (false) and error (null) state', () => {
    const { useTwinPodNoteDelete } = packageExports
    expect(typeof useTwinPodNoteDelete).toBe('function')
    const hyperFetch = vi.fn()
    const { loading, error } = useTwinPodNoteDelete(hyperFetch)
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  // Spec: F.Delete_Note — must send a DELETE request to the note URI (LWS standard)
  test('sends a DELETE request to the note URI', async () => {
    const { useTwinPodNoteDelete } = packageExports
    expect(typeof useTwinPodNoteDelete).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const { deleteNote } = useTwinPodNoteDelete(hyperFetch)
    await deleteNote(NOTE_URI)
    expect(hyperFetch).toHaveBeenCalledWith(NOTE_URI, expect.objectContaining({ method: 'DELETE' }))
  })

  // Spec: F.Delete_Note — Success-Criteria: note no longer exists; confirm deletion
  test('returns true on successful delete', async () => {
    const { useTwinPodNoteDelete } = packageExports
    expect(typeof useTwinPodNoteDelete).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const { deleteNote } = useTwinPodNoteDelete(hyperFetch)
    const result = await deleteNote(NOTE_URI)
    expect(result).toBe(true)
  })

  // Spec: ERROR_HANDLING_01 — must handle 403 Forbidden
  test('sets error when TwinPod returns 403', async () => {
    const { useTwinPodNoteDelete } = packageExports
    expect(typeof useTwinPodNoteDelete).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({ ok: false, status: 403 })
    const { deleteNote, error } = useTwinPodNoteDelete(hyperFetch)
    await deleteNote(NOTE_URI)
    expect(error.value).toMatchObject({ type: 'http', status: 403 })
  })

  // Spec: ERROR_HANDLING_01 — network failures must be exposed
  test('sets error on network failure', async () => {
    const { useTwinPodNoteDelete } = packageExports
    expect(typeof useTwinPodNoteDelete).toBe('function')
    const hyperFetch = vi.fn().mockRejectedValue(new Error('Network failure'))
    const { deleteNote, error } = useTwinPodNoteDelete(hyperFetch)
    await deleteNote(NOTE_URI)
    expect(error.value).toMatchObject({ type: 'network' })
  })

  // Spec: F.Delete_Note — must set invalid-input error when noteUri is missing
  test('sets invalid-input error when noteUri is null', async () => {
    const { useTwinPodNoteDelete } = packageExports
    expect(typeof useTwinPodNoteDelete).toBe('function')
    const hyperFetch = vi.fn()
    const { deleteNote, error } = useTwinPodNoteDelete(hyperFetch)
    await deleteNote(null)
    expect(error.value).toMatchObject({ type: 'invalid-input' })
    expect(hyperFetch).not.toHaveBeenCalled()
  })

})
