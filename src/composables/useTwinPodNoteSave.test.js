import { describe, test, expect, vi, beforeEach } from 'vitest'

const { mockUploadTurtleToResource } = vi.hoisted(() => ({
  mockUploadTurtleToResource: vi.fn(),
}))

vi.mock('@kaigilb/twinpod-client', () => ({
  ur: {
    uploadTurtleToResource: (...args) => mockUploadTurtleToResource(...args),
  }
}))

const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((k) => store[k] ?? null),
    setItem: vi.fn((k, v) => { store[k] = v }),
    clear: () => { store = {} },
  }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

import { useTwinPodNoteSave } from './useTwinPodNoteSave.js'

const NOTE_URL = 'https://tst-first.demo.systemtwin.com/t/t_note_123_abcd'

beforeEach(() => {
  mockUploadTurtleToResource.mockReset()
  mockUploadTurtleToResource.mockResolvedValue({ ok: true, status: 200, headers: null, locationUri: null, response: null })
  localStorageMock.getItem.mockClear()
  localStorageMock.setItem.mockClear()
  localStorageMock.clear()
})

describe('useTwinPodNoteSave — initial state', () => {
  test('saving starts false', () => {
    expect(useTwinPodNoteSave().saving.value).toBe(false)
  })
  test('saved starts false', () => {
    expect(useTwinPodNoteSave().saved.value).toBe(false)
  })
  test('error starts null', () => {
    expect(useTwinPodNoteSave().error.value).toBeNull()
  })
})

describe('useTwinPodNoteSave — Turtle building', () => {
  test('calls ur.uploadTurtleToResource with the note URL', async () => {
    const { saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'hello')
    expect(mockUploadTurtleToResource).toHaveBeenCalledTimes(1)
    expect(mockUploadTurtleToResource.mock.calls[0][0]).toBe(NOTE_URL)
  })

  test('Turtle body contains schema prefix and Note type', async () => {
    const { saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'hello')
    const turtle = mockUploadTurtleToResource.mock.calls[0][1]
    expect(turtle).toContain('@prefix schema:')
    expect(turtle).toContain('schema:Note')
  })

  test('Turtle body contains the text value', async () => {
    const { saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'hello world')
    const turtle = mockUploadTurtleToResource.mock.calls[0][1]
    expect(turtle).toContain('"hello world"')
  })

  test('escapes double-quotes in text', async () => {
    const { saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'say "hi"')
    const turtle = mockUploadTurtleToResource.mock.calls[0][1]
    expect(turtle).toContain('\\"hi\\"')
  })

  test('escapes newlines in text', async () => {
    const { saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'line1\nline2')
    const turtle = mockUploadTurtleToResource.mock.calls[0][1]
    expect(turtle).toContain('\\n')
    expect(turtle).not.toMatch(/line1\nline2/)
  })

  test('escapes backslashes in text', async () => {
    const { saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'path\\file')
    const turtle = mockUploadTurtleToResource.mock.calls[0][1]
    expect(turtle).toContain('\\\\')
  })

  test('escapes non-ASCII characters as \\uXXXX', async () => {
    const { saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'æøå')
    const turtle = mockUploadTurtleToResource.mock.calls[0][1]
    expect(turtle).toContain('\\u00E6')
    expect(turtle).toContain('\\u00F8')
    expect(turtle).toContain('\\u00E5')
    expect(turtle).not.toContain('æ')
  })

  test('escapes em dash and other BMP Unicode as \\uXXXX', async () => {
    const { saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'a — b')
    const turtle = mockUploadTurtleToResource.mock.calls[0][1]
    expect(turtle).toContain('\\u2014')
    expect(turtle).not.toContain('—')
  })

  test('uses custom predicateUri when provided', async () => {
    const { saveNote } = useTwinPodNoteSave({ predicateUri: 'https://example.com/body' })
    await saveNote(NOTE_URL, 'hello')
    const turtle = mockUploadTurtleToResource.mock.calls[0][1]
    expect(turtle).toContain('<https://example.com/body>')
  })

  // 5.1.1 — PUT (full-replace) instead of the library default PATCH.
  // PATCH + Content-Type: text/turtle is not a valid Solid operation; the
  // real pod responds 401 on that combo. PUT matches Create.
  test('passes method: PUT and returnResponse: true to uploadTurtleToResource', async () => {
    const { saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'hello')
    expect(mockUploadTurtleToResource.mock.calls[0][2]).toEqual({ method: 'PUT', returnResponse: true })
  })

  // 5.1.1 regression guard — the real pod treats PATCH text/turtle as a
  // malformed Solid operation and returns 401 "session expired", silently
  // breaking every save. If someone ever drops or rewrites the method option
  // and accidentally reverts to the library default (PATCH), this test fails.
  // Spec: V.Speed_Save_Note — a save must actually persist; a 401 defeats that.
  test('never passes method: PATCH (regression guard for the 5.1.0 defect)', async () => {
    const { saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'hi')
    const opts = mockUploadTurtleToResource.mock.calls[0][2]
    expect(opts?.method).not.toBe('PATCH')
    expect(opts?.method).toBe('PUT')
  })
})

describe('useTwinPodNoteSave — success state', () => {
  test('returns true on success', async () => {
    expect(await useTwinPodNoteSave().saveNote(NOTE_URL, 'hi')).toBe(true)
  })

  test('sets saved to true after success', async () => {
    const { saved, saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'hi')
    expect(saved.value).toBe(true)
  })

  test('leaves saving false after completion', async () => {
    const { saving, saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'hi')
    expect(saving.value).toBe(false)
  })

  test('caches text in localStorage on success', async () => {
    const { saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'my note text')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('notetext:' + NOTE_URL, 'my note text')
  })

  test('saves empty string (substitutes a space to avoid empty Turtle literal)', async () => {
    const { saveNote } = useTwinPodNoteSave()
    const ok = await saveNote(NOTE_URL, '')
    expect(ok).toBe(true)
  })
})

describe('useTwinPodNoteSave — input validation', () => {
  test('returns false and sets invalid-input error when noteResourceUrl is empty', async () => {
    const { error, saveNote } = useTwinPodNoteSave()
    expect(await saveNote('', 'hi')).toBe(false)
    expect(error.value?.type).toBe('invalid-input')
    expect(mockUploadTurtleToResource).not.toHaveBeenCalled()
  })

  test('returns false when noteResourceUrl is null', async () => {
    const { error, saveNote } = useTwinPodNoteSave()
    expect(await saveNote(null, 'hi')).toBe(false)
    expect(error.value?.type).toBe('invalid-input')
  })

  test('returns false when text is not a string', async () => {
    const { error, saveNote } = useTwinPodNoteSave()
    expect(await saveNote(NOTE_URL, 123)).toBe(false)
    expect(error.value?.type).toBe('invalid-input')
  })
})

describe('useTwinPodNoteSave — saved flag resets between calls', () => {
  test('saved flips back to false when a subsequent save fails', async () => {
    const { saved, saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'first')
    expect(saved.value).toBe(true)
    mockUploadTurtleToResource.mockResolvedValueOnce({ ok: false, status: 500 })
    await saveNote(NOTE_URL, 'second')
    expect(saved.value).toBe(false)
  })
})

describe('useTwinPodNoteSave — HTTP error', () => {
  test('returns false and sets error.type to http on failure', async () => {
    mockUploadTurtleToResource.mockResolvedValueOnce({ ok: false, status: 403 })
    const { error, saveNote } = useTwinPodNoteSave()
    expect(await saveNote(NOTE_URL, 'hi')).toBe(false)
    expect(error.value?.type).toBe('http')
    expect(error.value?.status).toBe(403)
  })

  test('sets error.type to network when uploadTurtleToResource throws', async () => {
    mockUploadTurtleToResource.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { error, saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'hi')
    expect(error.value?.type).toBe('network')
  })
})

// S.OptimisticSave / Increment 1 — non-blocking save + last-write-wins coalescing.
// Spec: 5 - Project/NoteWorld/NoteWorld.md (V.Speed_Save_Note)
// VDT:  5 - Project/NoteWorld/vdts/NoteWorld-VDT-2026-04-18.md (S.OptimisticSave)

describe('useTwinPodNoteSave — background mode (S.OptimisticSave)', () => {
  test('flips saving=true synchronously, before the PUT resolves', () => {
    // Hold the PUT open so we can observe the synchronous state.
    mockUploadTurtleToResource.mockImplementationOnce(() => new Promise(() => {}))
    const { saving, saveNote } = useTwinPodNoteSave()
    saveNote(NOTE_URL, 'hello')
    expect(saving.value).toBe(true)
  })

  test('returned promise still resolves to PUT outcome (await-style back-compat)', async () => {
    const { saveNote } = useTwinPodNoteSave()
    await expect(saveNote(NOTE_URL, 'hi')).resolves.toBe(true)
  })

  test('a second call while the first PUT is in flight does not start a new PUT immediately', () => {
    mockUploadTurtleToResource.mockImplementationOnce(() => new Promise(() => {}))
    const { saveNote } = useTwinPodNoteSave()
    saveNote(NOTE_URL, 'first')
    saveNote(NOTE_URL, 'second')
    expect(mockUploadTurtleToResource).toHaveBeenCalledTimes(1)
  })
})

describe('useTwinPodNoteSave — last-write-wins coalescing', () => {
  test('three rapid calls fire only two PUTs (first + coalesced)', async () => {
    let resolveFirst
    mockUploadTurtleToResource
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r }))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: null, locationUri: null, response: null })

    const { saveNote } = useTwinPodNoteSave()
    const p1 = saveNote(NOTE_URL, 'first')
    const p2 = saveNote(NOTE_URL, 'second')
    const p3 = saveNote(NOTE_URL, 'third')

    expect(mockUploadTurtleToResource).toHaveBeenCalledTimes(1)

    resolveFirst({ ok: true, status: 200, headers: null, locationUri: null, response: null })
    await Promise.all([p1, p2, p3])

    expect(mockUploadTurtleToResource).toHaveBeenCalledTimes(2)
  })

  test('coalesced PUT carries the latest text — earlier queued text is dropped', async () => {
    let resolveFirst
    mockUploadTurtleToResource
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r }))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: null, locationUri: null, response: null })

    const { saveNote } = useTwinPodNoteSave()
    const p1 = saveNote(NOTE_URL, 'first')
    const p2 = saveNote(NOTE_URL, 'second')
    const p3 = saveNote(NOTE_URL, 'third')

    resolveFirst({ ok: true, status: 200, headers: null, locationUri: null, response: null })
    await Promise.all([p1, p2, p3])

    expect(mockUploadTurtleToResource.mock.calls[0][1]).toContain('"first"')
    expect(mockUploadTurtleToResource.mock.calls[1][1]).toContain('"third"')
    expect(mockUploadTurtleToResource.mock.calls[1][1]).not.toContain('"second"')
  })

  test('saving stays true between coalesced PUTs (no flicker)', async () => {
    let resolveFirst, resolveSecond
    mockUploadTurtleToResource
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r }))
      .mockImplementationOnce(() => new Promise(r => { resolveSecond = r }))

    const { saving, saveNote } = useTwinPodNoteSave()
    saveNote(NOTE_URL, 'first')
    saveNote(NOTE_URL, 'second')

    expect(saving.value).toBe(true)

    resolveFirst({ ok: true, status: 200, headers: null, locationUri: null, response: null })
    // Yield to a macrotask so every microtask in the drain chain settles.
    await new Promise(r => setTimeout(r, 0))

    expect(saving.value).toBe(true)
    expect(mockUploadTurtleToResource).toHaveBeenCalledTimes(2)

    resolveSecond({ ok: true, status: 200, headers: null, locationUri: null, response: null })
    await new Promise(r => setTimeout(r, 0))

    expect(saving.value).toBe(false)
  })

  test('all coalesced callers receive the final-drain outcome on their returned promise', async () => {
    let resolveFirst
    mockUploadTurtleToResource
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r }))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: null, locationUri: null, response: null })

    const { saveNote } = useTwinPodNoteSave()
    const p1 = saveNote(NOTE_URL, 'first')
    const p2 = saveNote(NOTE_URL, 'second')
    const p3 = saveNote(NOTE_URL, 'third')

    resolveFirst({ ok: true, status: 200, headers: null, locationUri: null, response: null })
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])

    expect(r1).toBe(true)   // first PUT succeeded
    expect(r2).toBe(true)   // coalesced PUT succeeded
    expect(r3).toBe(true)   // coalesced PUT succeeded
  })

  test('localStorage cache uses the latest text after coalescing', async () => {
    let resolveFirst
    mockUploadTurtleToResource
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r }))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: null, locationUri: null, response: null })

    const { saveNote } = useTwinPodNoteSave()
    const p1 = saveNote(NOTE_URL, 'first')
    const p2 = saveNote(NOTE_URL, 'second')
    const p3 = saveNote(NOTE_URL, 'third')

    resolveFirst({ ok: true, status: 200, headers: null, locationUri: null, response: null })
    await Promise.all([p1, p2, p3])

    // First PUT cached 'first'; coalesced PUT then cached 'third', overwriting it.
    expect(localStorageMock.setItem).toHaveBeenLastCalledWith('notetext:' + NOTE_URL, 'third')
  })

  test('input validation still resolves false synchronously without queuing a PUT', async () => {
    mockUploadTurtleToResource.mockImplementationOnce(() => new Promise(() => {}))
    const { saveNote } = useTwinPodNoteSave()
    saveNote(NOTE_URL, 'inflight')
    await expect(saveNote('', 'bad')).resolves.toBe(false)
    // Only the first (held-open) PUT was issued — invalid call did not queue.
    expect(mockUploadTurtleToResource).toHaveBeenCalledTimes(1)
  })
})
