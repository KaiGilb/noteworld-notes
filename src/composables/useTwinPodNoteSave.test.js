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

  test('passes returnResponse: true to uploadTurtleToResource', async () => {
    const { saveNote } = useTwinPodNoteSave()
    await saveNote(NOTE_URL, 'hello')
    expect(mockUploadTurtleToResource.mock.calls[0][2]).toEqual({ returnResponse: true })
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
