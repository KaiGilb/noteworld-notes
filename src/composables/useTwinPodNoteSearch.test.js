// UNIT_TYPE=Hook
//
// Tests for useTwinPodNoteSearch (5.1.1 — type-driven single-source).
//
// Design: notes are discovered by RDF type (`neo:a_note`) via
// `ur.searchAndGetURIs`. There is no container listing — /t/ is an interim
// storage location, not a query dimension. See the source docblock.

import { describe, test, expect, vi, beforeEach } from 'vitest'

const { mockSearchAndGetURIs, mockMatch } = vi.hoisted(() => ({
  mockSearchAndGetURIs: vi.fn(),
  mockMatch: vi.fn(),
}))

// Regression-guard surface: expose mocks for the primitives that the OLD
// container-listing path would have called, so if the source ever reverts we
// get a loud, explicit failure rather than an indirect throw.
const mockListContainer = vi.fn()
const mockFetchAndSaveTurtle = vi.fn()

vi.mock('@kaigilb/twinpod-client', () => ({
  ur: {
    searchAndGetURIs: (...args) => mockSearchAndGetURIs(...args),
    rdfStore: { match: (...args) => mockMatch(...args) },
    listContainer: (...args) => mockListContainer(...args),
    fetchAndSaveTurtle: (...args) => mockFetchAndSaveTurtle(...args),
    NS: {
      RDF: (name) => ({ value: `http://www.w3.org/1999/02/22-rdf-syntax-ns#${name}`, termType: 'NamedNode' }),
      NEO: (name) => ({ value: `https://neo.graphmetrix.net/node/${name}`, termType: 'NamedNode' })
    }
  }
}))

import { useTwinPodNoteSearch } from './useTwinPodNoteSearch.js'

const POD = 'https://tst-first.demo.systemtwin.com'

beforeEach(() => {
  mockSearchAndGetURIs.mockReset()
  mockMatch.mockReset()
  mockListContainer.mockReset()
  mockFetchAndSaveTurtle.mockReset()
  // Defaults: successful search, no matches.
  mockSearchAndGetURIs.mockResolvedValue({ response: '<turtle>', headers: [] })
  mockMatch.mockReturnValue([])
})

describe('useTwinPodNoteSearch — initial state', () => {
  test('notes starts empty', () => {
    expect(useTwinPodNoteSearch().notes.value).toEqual([])
  })
  test('loading starts false', () => {
    expect(useTwinPodNoteSearch().loading.value).toBe(false)
  })
  test('error starts null', () => {
    expect(useTwinPodNoteSearch().error.value).toBeNull()
  })
})

describe('useTwinPodNoteSearch — search call', () => {
  // Spec: F.Find_Note — notes are listed via the TwinPod concept search for 'note'.
  test('calls ur.searchAndGetURIs with podRoot (no trailing slash), "note", and options', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(mockSearchAndGetURIs).toHaveBeenCalledTimes(1)
    expect(mockSearchAndGetURIs.mock.calls[0][0]).toBe(POD)
    expect(mockSearchAndGetURIs.mock.calls[0][1]).toBe('note')
    expect(mockSearchAndGetURIs.mock.calls[0][2]).toMatchObject({
      force: true, lang: 'en', rows: 100, start: 0
    })
  })

  test('strips trailing slash from podRoot', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(`${POD}/`)
    expect(mockSearchAndGetURIs.mock.calls[0][0]).toBe(POD)
  })
})

describe('useTwinPodNoteSearch — result extraction (neo:a_note type)', () => {
  // Spec: F.Find_Note — matches are neo:a_note-typed subjects.
  // Design: type-driven, not container-driven; the `/t/` prefix is incidental.
  test('returns URIs of subjects typed neo:a_note from the store', async () => {
    mockMatch.mockReturnValue([
      { subject: { value: `${POD}/t/t_note_a` } },
      { subject: { value: `${POD}/t/t_note_b` } }
    ])
    const { searchNotes, notes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri)).toEqual([
      `${POD}/t/t_note_a`, `${POD}/t/t_note_b`
    ])
    expect(notes.value).toEqual(result)
  })

  test('queries the store using neo:a_note type predicate', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(mockMatch).toHaveBeenCalledTimes(1)
    const [, predicate, object] = mockMatch.mock.calls[0]
    expect(predicate.value).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
    expect(object.value).toBe('https://neo.graphmetrix.net/node/a_note')
  })

  // The search result may carry the same type assertion more than once
  // (TwinPod state history accumulates; the store is shared across searches).
  test('deduplicates repeated subject URIs from the match result', async () => {
    const duplicate = `${POD}/t/t_note_shared`
    mockMatch.mockReturnValue([
      { subject: { value: duplicate } },
      { subject: { value: duplicate } }
    ])
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.filter(r => r.uri === duplicate).length).toBe(1)
  })

  test('returns empty array when no a_note subjects are in the store', async () => {
    mockMatch.mockReturnValue([])
    const { searchNotes } = useTwinPodNoteSearch()
    expect(await searchNotes(POD)).toEqual([])
  })
})

describe('useTwinPodNoteSearch — search error handling', () => {
  // Spec: F.Find_Note — surface server error via error ref; do not throw.
  test('sets error.type = search-error when search returns { error }', async () => {
    mockSearchAndGetURIs.mockResolvedValue({ error: 'something broke' })
    const { searchNotes, error, notes } = useTwinPodNoteSearch()
    expect(await searchNotes(POD)).toEqual([])
    expect(error.value?.type).toBe('search-error')
    expect(notes.value).toEqual([])
  })

  test('sets error.type = search-error when status >= 400', async () => {
    mockSearchAndGetURIs.mockResolvedValue({ status: 500, response: 'boom' })
    const { searchNotes, error } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(error.value?.type).toBe('search-error')
  })

  test('sets error.type = network when searchAndGetURIs throws', async () => {
    mockSearchAndGetURIs.mockRejectedValue(new Error('offline'))
    const { searchNotes, error } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(error.value?.type).toBe('network')
  })
})

describe('useTwinPodNoteSearch — input validation', () => {
  test('sets invalid-input error and returns [] when podRoot is empty', async () => {
    const { error, searchNotes } = useTwinPodNoteSearch()
    expect(await searchNotes('')).toEqual([])
    expect(error.value?.type).toBe('invalid-input')
    expect(mockSearchAndGetURIs).not.toHaveBeenCalled()
  })

  test('sets invalid-input error when podRoot is null', async () => {
    const { error, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(null)
    expect(error.value?.type).toBe('invalid-input')
  })

  test('sets invalid-input error when podRoot is undefined', async () => {
    const { error, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(undefined)
    expect(error.value?.type).toBe('invalid-input')
  })
})

describe('useTwinPodNoteSearch — loading transition', () => {
  test('loading is true while search is in progress', async () => {
    let resolveSearch
    mockSearchAndGetURIs.mockImplementationOnce(() => new Promise(r => { resolveSearch = r }))
    const { loading, searchNotes } = useTwinPodNoteSearch()
    const promise = searchNotes(POD)
    expect(loading.value).toBe(true)
    resolveSearch({ response: '', headers: [] })
    await promise
    expect(loading.value).toBe(false)
  })

  test('loading is false after search completes successfully', async () => {
    const { loading, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(loading.value).toBe(false)
  })
})

describe('useTwinPodNoteSearch — 5.1.1 regression guards', () => {
  // Spec: F.Find_Note — discovery is a graph query, never a container listing.
  // The 5.0.0 implementation listed `{pod}/t/` via LDP (ur.listContainer) and
  // returned 403 against the real pod. 5.1.1 dropped the listing entirely.
  test('does not call ur.listContainer (no LDP container fallback)', async () => {
    mockMatch.mockReturnValue([
      { subject: { value: `${POD}/t/t_note_a` } }
    ])
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(mockListContainer).not.toHaveBeenCalled()
  })

  // Spec: F.Find_Note — discovery must not GET the `/t/` container directly.
  // If a future contributor reintroduces `ur.fetchAndSaveTurtle(pod + '/t/')`
  // as a fallback, this test fails immediately.
  test('does not call ur.fetchAndSaveTurtle (no per-resource or container pre-fetch)', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(mockFetchAndSaveTurtle).not.toHaveBeenCalled()
  })

  // Spec: F.Find_Note — the 5.0.0 regression matched on neo:a_fragmented-document
  // instead of neo:a_note, so "list my notes" returned zero notes against real
  // pod content. Lock the type filter to a_note.
  test('type filter is neo:a_note, never the 5.0.0 regression type a_fragmented-document', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    const typeObject = mockMatch.mock.calls[0][2]
    expect(typeObject.value).toBe('https://neo.graphmetrix.net/node/a_note')
    expect(typeObject.value).not.toContain('a_fragmented-document')
  })
})

describe('useTwinPodNoteSearch — error clearing', () => {
  // Spec: F.Find_Note — a new search clears previous error state.
  test('clears previous error when a new search starts', async () => {
    const { error, searchNotes } = useTwinPodNoteSearch()
    // First call with invalid input.
    await searchNotes('')
    expect(error.value?.type).toBe('invalid-input')
    // Second call with valid input clears the error.
    await searchNotes(POD)
    expect(error.value).toBeNull()
  })
})
