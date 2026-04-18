// UNIT_TYPE=Hook
//
// Tests for useTwinPodNoteSearch (5.1.2 — dual-type filter).
//
// Design: notes are discovered by RDF type via `ur.searchAndGetURIs`. The
// store match now unions `schema:Note` (what NoteWorld writes) and
// `neo:a_note` (Neo-shaped notes from other tooling). There is no container
// listing — /t/ is an interim storage location, not a query dimension.
// See the source docblock.

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
      NEO: (name) => ({ value: `https://neo.graphmetrix.net/node/${name}`, termType: 'NamedNode' }),
      SCHEMA: (name) => ({ value: `http://schema.org/${name}`, termType: 'NamedNode' })
    }
  }
}))

// Type-aware mockMatch: route hits to the right bucket based on the type
// object passed as the 3rd arg, so tests can assert "schema:Note hits appear"
// independently of "neo:a_note hits appear".
function setTypeHits({ schemaNote = [], neoANote = [] } = {}) {
  mockMatch.mockImplementation((_s, _p, object) => {
    if (object?.value === 'http://schema.org/Note') {
      return schemaNote.map(uri => ({ subject: { value: uri } }))
    }
    if (object?.value === 'https://neo.graphmetrix.net/node/a_note') {
      return neoANote.map(uri => ({ subject: { value: uri } }))
    }
    return []
  })
}

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

describe('useTwinPodNoteSearch — result extraction (schema:Note ∪ neo:a_note)', () => {
  // Spec: F.Find_Note — matches are note-typed subjects.
  // Design: type-driven, not container-driven; the `/t/` prefix is incidental.
  // 5.1.2: the filter unions two types — schema:Note (what NoteWorld writes)
  // and neo:a_note (Neo-shaped notes from other tooling).

  test('returns URIs of subjects typed schema:Note (NoteWorld-authored notes)', async () => {
    setTypeHits({
      schemaNote: [`${POD}/t/t_note_a`, `${POD}/t/t_note_b`],
      neoANote: []
    })
    const { searchNotes, notes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri)).toEqual([
      `${POD}/t/t_note_a`, `${POD}/t/t_note_b`
    ])
    expect(notes.value).toEqual(result)
  })

  test('returns URIs of subjects typed neo:a_note (other-tooling notes)', async () => {
    setTypeHits({
      schemaNote: [],
      neoANote: [`${POD}/node/neoA`, `${POD}/node/neoB`]
    })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri)).toEqual([
      `${POD}/node/neoA`, `${POD}/node/neoB`
    ])
  })

  test('unions schema:Note and neo:a_note subjects in the result', async () => {
    setTypeHits({
      schemaNote: [`${POD}/t/t_note_a`],
      neoANote:   [`${POD}/node/neoA`]
    })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri).sort()).toEqual([
      `${POD}/node/neoA`, `${POD}/t/t_note_a`
    ])
  })

  test('queries the store with both schema:Note and neo:a_note type predicates', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    // Exactly two match calls — one per type — so no drift into extra queries.
    expect(mockMatch).toHaveBeenCalledTimes(2)
    const predicateValues = mockMatch.mock.calls.map(call => call[1].value)
    const objectValues    = mockMatch.mock.calls.map(call => call[2].value)
    expect(predicateValues.every(v => v === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toBe(true)
    expect(objectValues).toContain('http://schema.org/Note')
    expect(objectValues).toContain('https://neo.graphmetrix.net/node/a_note')
  })

  // The search result may carry the same type assertion more than once
  // (TwinPod state history accumulates; the store is shared across searches).
  test('deduplicates repeated subject URIs within a single type bucket', async () => {
    const duplicate = `${POD}/t/t_note_shared`
    setTypeHits({ schemaNote: [duplicate, duplicate], neoANote: [] })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.filter(r => r.uri === duplicate).length).toBe(1)
  })

  // 5.1.2: a subject typed both schema:Note AND neo:a_note (e.g. a note that
  // TwinPod reified into a Neo node, or a resource saved by multiple tools)
  // must appear exactly once in the unioned result.
  test('deduplicates subjects present in both schema:Note and neo:a_note buckets', async () => {
    const shared = `${POD}/t/t_note_shared`
    setTypeHits({ schemaNote: [shared], neoANote: [shared] })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.filter(r => r.uri === shared).length).toBe(1)
  })

  test('returns empty array when no note-typed subjects are in the store', async () => {
    setTypeHits({ schemaNote: [], neoANote: [] })
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

describe('useTwinPodNoteSearch — regression guards', () => {
  // Spec: F.Find_Note — discovery is a graph query, never a container listing.
  // The 5.0.0 implementation listed `{pod}/t/` via LDP (ur.listContainer) and
  // returned 403 against the real pod. 5.1.1 dropped the listing entirely.
  test('does not call ur.listContainer (no LDP container fallback)', async () => {
    setTypeHits({ schemaNote: [`${POD}/t/t_note_a`] })
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
  // so "list my notes" returned zero notes against real pod content. Lock the
  // type filter against that value across all queried type objects.
  test('never matches on neo:a_fragmented-document (5.0.0 regression type)', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    for (const call of mockMatch.mock.calls) {
      expect(call[2].value).not.toContain('a_fragmented-document')
    }
  })

  // Spec: F.Find_Note — 5.1.2 requires the filter to INCLUDE schema:Note.
  // If a future refactor drops the schema:Note branch and only queries
  // neo:a_note, NoteWorld-authored notes vanish from F.Find_Note again —
  // exactly the 5.1.1 defect this version fixes.
  test('includes schema:Note in the queried types (5.1.2 fix guard)', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    const objectValues = mockMatch.mock.calls.map(call => call[2].value)
    expect(objectValues).toContain('http://schema.org/Note')
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
