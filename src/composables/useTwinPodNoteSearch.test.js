import { describe, test, expect, vi, beforeEach } from 'vitest'

const { mockSearchAndGetURIs, mockMatch } = vi.hoisted(() => ({
  mockSearchAndGetURIs: vi.fn(),
  mockMatch: vi.fn(),
}))

vi.mock('@kaigilb/twinpod-client', () => ({
  ur: {
    searchAndGetURIs: (...args) => mockSearchAndGetURIs(...args),
    rdfStore: { match: (...args) => mockMatch(...args) },
    NS: {
      RDF: (name) => `http://www.w3.org/1999/02/22-rdf-syntax-ns#${name}`,
      NEO: (name) => `https://neo.graphmetrix.net/node/${name}`
    }
  }
}))

import { useTwinPodNoteSearch } from './useTwinPodNoteSearch.js'

const POD = 'https://tst-first.demo.systemtwin.com'

beforeEach(() => {
  mockSearchAndGetURIs.mockReset()
  mockMatch.mockReset()
  mockSearchAndGetURIs.mockResolvedValue({ response: '<turtle>', headers: [] })
  mockMatch.mockReturnValue([])
})

describe('useTwinPodNoteSearch — initial state', () => {
  test('notes starts empty', () => {
    const { notes } = useTwinPodNoteSearch()
    expect(notes.value).toEqual([])
  })
  test('loading starts false', () => {
    const { loading } = useTwinPodNoteSearch()
    expect(loading.value).toBe(false)
  })
  test('error starts null', () => {
    const { error } = useTwinPodNoteSearch()
    expect(error.value).toBeNull()
  })
})

describe('useTwinPodNoteSearch — success', () => {
  // Spec: F.Find_Note — calls search API with podRoot, conceptName, and options object
  test('calls ur.searchAndGetURIs with podRoot, conceptName, and options', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(mockSearchAndGetURIs).toHaveBeenCalledTimes(1)
    expect(mockSearchAndGetURIs.mock.calls[0][0]).toBe(POD)
    expect(mockSearchAndGetURIs.mock.calls[0][1]).toBe('note')
    expect(mockSearchAndGetURIs.mock.calls[0][2]).toEqual({ force: false, lang: 'en', rows: 50, start: 0 })
  })

  // Spec: F.Find_Note — conceptName and lang options accepted and forwarded to search API
  test('accepts custom conceptName and lang', async () => {
    const { searchNotes } = useTwinPodNoteSearch({ conceptName: 'text', lang: 'de' })
    await searchNotes(POD)
    expect(mockSearchAndGetURIs.mock.calls[0][1]).toBe('text')
    expect(mockSearchAndGetURIs.mock.calls[0][2].lang).toBe('de')
  })

  // Spec: F.Find_Note — returns array of { uri } objects from rdfStore after search
  test('extracts note URIs from ur.rdfStore after search', async () => {
    mockMatch.mockReturnValue([
      { subject: { value: `${POD}/t/t_note_1` } },
      { subject: { value: `${POD}/t/t_note_2` } }
    ])
    const { searchNotes, notes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result).toEqual([
      { uri: `${POD}/t/t_note_1` },
      { uri: `${POD}/t/t_note_2` }
    ])
    expect(notes.value).toEqual(result)
  })

  test('passes force and rows through', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD, { force: true, rows: 10 })
    expect(mockSearchAndGetURIs.mock.calls[0][2]).toEqual({ force: true, lang: 'en', rows: 10, start: 0 })
  })

  // Spec: F.Find_Note — returns empty array when no notes match the search
  test('returns empty array when no notes match', async () => {
    mockMatch.mockReturnValue([])
    const { searchNotes, notes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result).toEqual([])
    expect(notes.value).toEqual([])
  })
})

describe('useTwinPodNoteSearch — input validation', () => {
  // Spec: F.Find_Note — searchNotes rejects falsy podRoot with invalid-input error
  test('returns empty array and sets error when podRoot is empty', async () => {
    const { error, searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes('')
    expect(result).toEqual([])
    expect(error.value?.type).toBe('invalid-input')
    expect(mockSearchAndGetURIs).not.toHaveBeenCalled()
  })

  // Spec: F.Find_Note — invalid-input must cover null/undefined podRoot
  test('returns empty array and sets error when podRoot is null', async () => {
    const { error, searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(null)
    expect(result).toEqual([])
    expect(error.value?.type).toBe('invalid-input')
    expect(mockSearchAndGetURIs).not.toHaveBeenCalled()
  })

  // Spec: F.Find_Note — invalid-input must cover null/undefined podRoot
  test('returns empty array and sets error when podRoot is undefined', async () => {
    const { error, searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(undefined)
    expect(result).toEqual([])
    expect(error.value?.type).toBe('invalid-input')
    expect(mockSearchAndGetURIs).not.toHaveBeenCalled()
  })
})

describe('useTwinPodNoteSearch — error handling', () => {
  test('sets error on search API error response', async () => {
    mockSearchAndGetURIs.mockResolvedValue({ error: 'true' })
    const { error, searchNotes, notes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(error.value?.type).toBe('search-error')
    expect(notes.value).toEqual([])
  })

  test('sets error on network failure', async () => {
    mockSearchAndGetURIs.mockRejectedValue(new Error('Failed to fetch'))
    const { error, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(error.value?.type).toBe('network')
  })

  test('loading is false after error', async () => {
    mockSearchAndGetURIs.mockRejectedValue(new Error('boom'))
    const { loading, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(loading.value).toBe(false)
  })

  test('sets error when search endpoint returns HTTP 500', async () => {
    mockSearchAndGetURIs.mockResolvedValue({ response: 'Internal Server Error', headers: [], status: 500 })
    const { error, searchNotes, notes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(error.value?.type).toBe('search-error')
    expect(error.value?.message).toContain('500')
    expect(notes.value).toEqual([])
  })

  test('sets error when search endpoint returns HTTP 401', async () => {
    mockSearchAndGetURIs.mockResolvedValue({ response: 'Unauthorized', headers: [], status: 401 })
    const { error, searchNotes, notes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(error.value?.type).toBe('search-error')
    expect(error.value?.message).toContain('401')
    expect(notes.value).toEqual([])
  })

  test('sets error when search endpoint returns HTTP 403', async () => {
    mockSearchAndGetURIs.mockResolvedValue({ response: 'Forbidden', headers: [], status: 403 })
    const { error, searchNotes, notes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(error.value?.type).toBe('search-error')
    expect(error.value?.message).toContain('403')
    expect(notes.value).toEqual([])
  })

  test('sets error when search endpoint returns HTTP 404', async () => {
    mockSearchAndGetURIs.mockResolvedValue({ response: 'Not Found', headers: [], status: 404 })
    const { error, searchNotes, notes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(error.value?.type).toBe('search-error')
    expect(error.value?.message).toContain('404')
    expect(notes.value).toEqual([])
  })
})

describe('useTwinPodNoteSearch — loading transition', () => {
  // Spec: F.Find_Note — loading ref is true during in-flight search, false after completion
  test('loading is true while search is in progress', async () => {
    let resolveSearch
    mockSearchAndGetURIs.mockImplementation(() => new Promise(r => { resolveSearch = r }))
    const { loading, searchNotes } = useTwinPodNoteSearch()
    const promise = searchNotes(POD)
    expect(loading.value).toBe(true)
    resolveSearch({ response: '<turtle>', headers: [] })
    await promise
    expect(loading.value).toBe(false)
  })
})

describe('useTwinPodNoteSearch — error clearing', () => {
  // Spec: F.Find_Note — error state clears when a new search begins
  test('clears previous error when a new search starts', async () => {
    mockSearchAndGetURIs.mockRejectedValueOnce(new Error('first fail'))
    const { error, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(error.value).not.toBeNull()

    mockSearchAndGetURIs.mockResolvedValueOnce({ response: '<turtle>', headers: [] })
    mockMatch.mockReturnValue([])
    await searchNotes(POD)
    expect(error.value).toBeNull()
  })
})

describe('useTwinPodNoteSearch — ur namespace migration (no solidFetch)', () => {
  // Spec: single ur namespace — composable must accept zero required parameters (no solidFetch param)
  test('searchNotes works without any solidFetch parameter', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(Array.isArray(result)).toBe(true)
    expect(mockSearchAndGetURIs).toHaveBeenCalledTimes(1)
  })

  // Spec: ur namespace — ur.searchAndGetURIs receives podRoot as first arg
  test('passes podRoot as first argument to ur.searchAndGetURIs', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(mockSearchAndGetURIs.mock.calls[0][0]).toBe(POD)
  })

  // Spec: ur namespace — ur.searchAndGetURIs receives conceptName as second arg
  test('passes conceptName as second argument to ur.searchAndGetURIs', async () => {
    const { searchNotes } = useTwinPodNoteSearch({ conceptName: 'mynote' })
    await searchNotes(POD)
    expect(mockSearchAndGetURIs.mock.calls[0][1]).toBe('mynote')
  })
})
