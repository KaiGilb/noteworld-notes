// UNIT_TYPE=Hook
//
// Tests for useTwinPodNoteSearch (5.1.4 — two-phase type-driven discovery).
//
// Design under test:
//   Phase 1 — enumerate candidate URIs from each `containerPaths` entry
//     via ur.hyperFetch; parse Turtle into a TEMPORARY rdflib graph;
//     collect ldp:contains objects. LDP metadata must not leak into
//     ur.rdfStore.
//   Phase 2 — load each candidate via ur.fetchAndSaveTurtle (parses into
//     shared ur.rdfStore). After all GETs settle, one match on
//     rdf:type ∈ typeUris (default schema:Note ∪ neo:a_note) filtered
//     to the candidate set.
//
//   Errors: 'discovery-error' only when every container listing fails.
//   Individual note GET failures are tolerated (missing from result).
//   URI prefix / path is NEVER a filter — a resource is a note iff its
//   RDF type matches, no matter where it lives.
//
// Why the previous approach failed:
//   5.1.3's /search-based discovery relied on the pod's per-pod concept
//   index. tst-ia2 does not index the notes under 'note' or 'notes' at
//   all — /search/note is 200 empty-body, /search/notes returns an
//   unrelated resource. Container listing is the only primitive that
//   works on every pod we've tested (/t/ returns 200 with all 15 notes
//   as ldp:contains relations).

import { describe, test, expect, vi, beforeEach } from 'vitest'

const {
  mockHyperFetch,
  mockFetchAndSaveTurtle,
  mockStoreMatch,
  mockTempGraphFactory,
  mockRdfParse
} = vi.hoisted(() => ({
  mockHyperFetch: vi.fn(),
  mockFetchAndSaveTurtle: vi.fn(),
  mockStoreMatch: vi.fn(),
  // A factory so every listContainer call gets a FRESH temp graph —
  // we can then assert the shared store is never passed to rdf.parse.
  mockTempGraphFactory: vi.fn(),
  mockRdfParse: vi.fn()
}))

vi.mock('@kaigilb/twinpod-client', () => ({
  ur: {
    hyperFetch: (...args) => mockHyperFetch(...args),
    fetchAndSaveTurtle: (...args) => mockFetchAndSaveTurtle(...args),
    rdfStore: { match: (...args) => mockStoreMatch(...args) },
    $rdf: {
      graph: (...args) => mockTempGraphFactory(...args),
      parse: (...args) => mockRdfParse(...args),
      sym: (value) => ({ value, termType: 'NamedNode' })
    },
    NS: {
      RDF:    (name) => ({ value: `http://www.w3.org/1999/02/22-rdf-syntax-ns#${name}`, termType: 'NamedNode' }),
      NEO:    (name) => ({ value: `https://neo.graphmetrix.net/node/${name}`, termType: 'NamedNode' }),
      SCHEMA: (name) => ({ value: `http://schema.org/${name}`, termType: 'NamedNode' }),
      LDP:    (name) => ({ value: `http://www.w3.org/ns/ldp#${name}`, termType: 'NamedNode' })
    }
  }
}))

// Helper: mock a successful container listing at the given URL returning
// the given child URIs as ldp:contains objects. Each call to $rdf.graph()
// produces a fresh mini-graph whose .match() returns the injected URIs.
function setContainerListing(containerUrl, uris) {
  mockHyperFetch.mockImplementation(async (url) => {
    if (url === containerUrl) {
      return { ok: true, status: 200, text: async () => '<turtle>' }
    }
    return { ok: false, status: 404, text: async () => '' }
  })
  mockRdfParse.mockImplementation(() => {})
  mockTempGraphFactory.mockImplementation(() => ({
    match: () => uris.map(u => ({ object: { value: u } }))
  }))
}

// Helper: the shared store match is type-aware — returns subjects by type.
function setStoreTypeHits({ schemaNote = [], neoANote = [], other = {} } = {}) {
  mockStoreMatch.mockImplementation((_s, _p, object) => {
    if (object?.value === 'http://schema.org/Note') {
      return schemaNote.map(uri => ({ subject: { value: uri } }))
    }
    if (object?.value === 'https://neo.graphmetrix.net/node/a_note') {
      return neoANote.map(uri => ({ subject: { value: uri } }))
    }
    if (other[object?.value]) {
      return other[object.value].map(uri => ({ subject: { value: uri } }))
    }
    return []
  })
}

import { useTwinPodNoteSearch } from './useTwinPodNoteSearch.js'

const POD = 'https://tst-first.demo.systemtwin.com'

beforeEach(() => {
  mockHyperFetch.mockReset()
  mockFetchAndSaveTurtle.mockReset()
  mockStoreMatch.mockReset()
  mockTempGraphFactory.mockReset()
  mockRdfParse.mockReset()
  // Defaults: container listing succeeds with zero contents; store is empty.
  setContainerListing(`${POD}/t/`, [])
  mockFetchAndSaveTurtle.mockResolvedValue({ success: true })
  mockStoreMatch.mockReturnValue([])
})

// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — Phase 1: container enumeration', () => {
  // Spec: F.Find_Note — Phase 1 lists every path in containerPaths.
  test('lists the default /t/ container on the pod', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(mockHyperFetch).toHaveBeenCalledTimes(1)
    expect(mockHyperFetch.mock.calls[0][0]).toBe(`${POD}/t/`)
    expect(mockHyperFetch.mock.calls[0][1].method).toBe('GET')
    expect(mockHyperFetch.mock.calls[0][1].headers.Accept).toBe('text/turtle')
  })

  test('strips trailing slash from podRoot before composing the container URL', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(`${POD}/`)
    expect(mockHyperFetch.mock.calls[0][0]).toBe(`${POD}/t/`)
  })

  test('supports custom containerPaths (multiple containers in parallel)', async () => {
    mockHyperFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '<turtle>' })
    mockTempGraphFactory.mockReturnValue({ match: () => [] })
    const { searchNotes } = useTwinPodNoteSearch({ containerPaths: ['/notes/', '/archive/'] })
    await searchNotes(POD)
    const urls = mockHyperFetch.mock.calls.map(c => c[0]).sort()
    expect(urls).toEqual([`${POD}/archive/`, `${POD}/notes/`])
  })

  test('falls back to default containerPaths when opts.containerPaths is empty', async () => {
    const { searchNotes } = useTwinPodNoteSearch({ containerPaths: [] })
    await searchNotes(POD)
    expect(mockHyperFetch.mock.calls[0][0]).toBe(`${POD}/t/`)
  })

  test('falls back to default containerPaths when opts.containerPaths is non-array', async () => {
    const { searchNotes } = useTwinPodNoteSearch({ containerPaths: '/t/' })
    await searchNotes(POD)
    expect(mockHyperFetch.mock.calls[0][0]).toBe(`${POD}/t/`)
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — Phase 2: per-candidate GET', () => {
  // Spec: F.Find_Note — Phase 2 fires one fetchAndSaveTurtle per candidate
  // to populate the shared rdfStore with their rdf:type triples.
  test('fires one fetchAndSaveTurtle per enumerated candidate', async () => {
    const candidates = [
      `${POD}/t/t_note_aaa`,
      `${POD}/t/t_note_bbb`,
      `${POD}/t/t_note_ccc`
    ]
    setContainerListing(`${POD}/t/`, candidates)
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(mockFetchAndSaveTurtle).toHaveBeenCalledTimes(3)
    const fetched = mockFetchAndSaveTurtle.mock.calls.map(c => c[0]).sort()
    expect(fetched).toEqual([...candidates].sort())
  })

  test('does NOT fire any fetchAndSaveTurtle when the container is empty', async () => {
    setContainerListing(`${POD}/t/`, [])
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(mockFetchAndSaveTurtle).not.toHaveBeenCalled()
  })

  // Spec: F.Find_Note — per-candidate failures are isolated; a 404 on one
  // note must not poison the whole result. That note simply won't appear.
  test('a rejected per-candidate GET does not abort the others', async () => {
    const candidates = [
      `${POD}/t/t_note_ok1`,
      `${POD}/t/t_note_broken`,
      `${POD}/t/t_note_ok2`
    ]
    setContainerListing(`${POD}/t/`, candidates)
    mockFetchAndSaveTurtle.mockImplementation(async (uri) => {
      if (uri.includes('broken')) throw new Error('404')
      return { success: true }
    })
    setStoreTypeHits({
      schemaNote: [`${POD}/t/t_note_ok1`, `${POD}/t/t_note_ok2`]
    })
    const { searchNotes, error } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri).sort()).toEqual([
      `${POD}/t/t_note_ok1`, `${POD}/t/t_note_ok2`
    ])
    expect(error.value).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — type filter (schema:Note ∪ neo:a_note)', () => {
  // Spec: F.Find_Note — the filter runs against ur.rdfStore (populated by
  // Phase 2), matching subjects typed either schema:Note or neo:a_note.

  test('returns candidates typed schema:Note', async () => {
    const candidates = [`${POD}/t/t_note_a`, `${POD}/t/t_note_b`]
    setContainerListing(`${POD}/t/`, candidates)
    setStoreTypeHits({ schemaNote: candidates })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri).sort()).toEqual([...candidates].sort())
  })

  test('returns candidates typed neo:a_note', async () => {
    const candidates = [`${POD}/t/t_note_x`]
    setContainerListing(`${POD}/t/`, candidates)
    setStoreTypeHits({ neoANote: candidates })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri)).toEqual(candidates)
  })

  test('queries the store with BOTH schema:Note and neo:a_note type objects', async () => {
    setContainerListing(`${POD}/t/`, [`${POD}/t/t_note_a`])
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    const objectValues = mockStoreMatch.mock.calls.map(call => call[2].value)
    expect(objectValues).toContain('http://schema.org/Note')
    expect(objectValues).toContain('https://neo.graphmetrix.net/node/a_note')
  })

  // Spec: F.Find_Note — the default typeUris list is configurable. A
  // caller can narrow or broaden it (e.g. for a future Note subtype).
  test('accepts a custom typeUris list and queries each type', async () => {
    setContainerListing(`${POD}/t/`, [`${POD}/t/t_note_a`])
    const { searchNotes } = useTwinPodNoteSearch({
      typeUris: ['http://example.org/TypeOne', 'http://example.org/TypeTwo']
    })
    await searchNotes(POD)
    const objectValues = mockStoreMatch.mock.calls.map(call => call[2].value)
    expect(objectValues).toContain('http://example.org/TypeOne')
    expect(objectValues).toContain('http://example.org/TypeTwo')
  })

  test('custom typeUris filters out candidates typed only schema:Note', async () => {
    const candidates = [`${POD}/t/t_only_schema`, `${POD}/t/t_only_custom`]
    setContainerListing(`${POD}/t/`, candidates)
    setStoreTypeHits({
      schemaNote: [`${POD}/t/t_only_schema`],
      other: { 'http://example.org/CustomType': [`${POD}/t/t_only_custom`] }
    })
    const { searchNotes } = useTwinPodNoteSearch({
      typeUris: ['http://example.org/CustomType']
    })
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri)).toEqual([`${POD}/t/t_only_custom`])
  })

  // Spec: F.Find_Note — the type match must exclude subjects not in the
  // enumerated candidate set. Otherwise unrelated triples already in the
  // store (from other composables on the same page) could leak in.
  test('only returns candidate subjects, never leaks non-candidate store hits', async () => {
    const candidates = [`${POD}/t/t_note_real`]
    setContainerListing(`${POD}/t/`, candidates)
    setStoreTypeHits({
      schemaNote: [
        `${POD}/t/t_note_real`,
        `${POD}/somewhere/else/leak_note`  // present in store, NOT a candidate
      ]
    })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri)).toEqual([`${POD}/t/t_note_real`])
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — union and dedup', () => {
  // Spec: F.Find_Note — a candidate typed both schema:Note and neo:a_note
  // must appear exactly once.
  test('dedupes a candidate typed both schema:Note and neo:a_note', async () => {
    const shared = `${POD}/t/t_note_both`
    setContainerListing(`${POD}/t/`, [shared])
    setStoreTypeHits({ schemaNote: [shared], neoANote: [shared] })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.filter(r => r.uri === shared).length).toBe(1)
  })

  test('unions candidates from multiple containers', async () => {
    mockHyperFetch.mockImplementation(async (url) => {
      if (url === `${POD}/t/` || url === `${POD}/archive/`) {
        return { ok: true, status: 200, text: async () => '<turtle>' }
      }
      return { ok: false, status: 404, text: async () => '' }
    })
    mockTempGraphFactory
      .mockReturnValueOnce({
        match: () => [{ object: { value: `${POD}/t/t_note_live` } }]
      })
      .mockReturnValueOnce({
        match: () => [{ object: { value: `${POD}/archive/t_note_old` } }]
      })
    setStoreTypeHits({
      schemaNote: [`${POD}/t/t_note_live`, `${POD}/archive/t_note_old`]
    })
    const { searchNotes } = useTwinPodNoteSearch({
      containerPaths: ['/t/', '/archive/']
    })
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri).sort()).toEqual([
      `${POD}/archive/t_note_old`, `${POD}/t/t_note_live`
    ])
  })

  test('dedupes a candidate that appears in multiple container listings', async () => {
    const shared = `${POD}/t/t_note_dup`
    mockHyperFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '<turtle>' })
    mockTempGraphFactory.mockReturnValue({
      match: () => [{ object: { value: shared } }]
    })
    setStoreTypeHits({ schemaNote: [shared] })
    const { searchNotes } = useTwinPodNoteSearch({
      containerPaths: ['/a/', '/b/']
    })
    const result = await searchNotes(POD)
    expect(result.filter(r => r.uri === shared).length).toBe(1)
    // Phase 2 should also dedup the GET — one candidate, one fetch.
    expect(mockFetchAndSaveTurtle).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — error handling', () => {
  // Spec: F.Find_Note — only when EVERY container listing fails do we
  // set discovery-error. A single-container failure in a multi-container
  // config is tolerated.

  test('sets discovery-error when the only container listing fails (non-ok HTTP)', async () => {
    mockHyperFetch.mockResolvedValue({ ok: false, status: 403, text: async () => '' })
    const { searchNotes, error } = useTwinPodNoteSearch()
    expect(await searchNotes(POD)).toEqual([])
    expect(error.value?.type).toBe('discovery-error')
  })

  test('sets discovery-error when the only container listing throws', async () => {
    mockHyperFetch.mockRejectedValue(new Error('offline'))
    const { searchNotes, error } = useTwinPodNoteSearch()
    expect(await searchNotes(POD)).toEqual([])
    expect(error.value?.type).toBe('discovery-error')
  })

  test('does NOT set error when one of multiple containers fails but another succeeds', async () => {
    mockHyperFetch.mockImplementation(async (url) => {
      if (url === `${POD}/t/`) {
        return { ok: true, status: 200, text: async () => '<turtle>' }
      }
      return { ok: false, status: 403, text: async () => '' }
    })
    mockTempGraphFactory.mockReturnValue({
      match: () => [{ object: { value: `${POD}/t/t_note_a` } }]
    })
    setStoreTypeHits({ schemaNote: [`${POD}/t/t_note_a`] })
    const { searchNotes, error } = useTwinPodNoteSearch({
      containerPaths: ['/t/', '/forbidden/']
    })
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri)).toEqual([`${POD}/t/t_note_a`])
    expect(error.value).toBeNull()
  })

  test('returns [] with no error when container is empty (legitimate empty state)', async () => {
    setContainerListing(`${POD}/t/`, [])
    const { searchNotes, error } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result).toEqual([])
    expect(error.value).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — input validation', () => {
  test('sets invalid-input error and returns [] when podRoot is empty', async () => {
    const { error, searchNotes } = useTwinPodNoteSearch()
    expect(await searchNotes('')).toEqual([])
    expect(error.value?.type).toBe('invalid-input')
    expect(mockHyperFetch).not.toHaveBeenCalled()
    expect(mockFetchAndSaveTurtle).not.toHaveBeenCalled()
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

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — loading transition', () => {
  test('loading is true while discovery is in progress', async () => {
    // Hold Phase 1 open — the hyperFetch promise stays pending, so
    // loading.value is locked to true until we release it.
    let releaseListing
    mockHyperFetch.mockImplementationOnce(() => new Promise(r => { releaseListing = r }))
    const { loading, searchNotes } = useTwinPodNoteSearch()
    const promise = searchNotes(POD)
    expect(loading.value).toBe(true)
    releaseListing({ ok: true, status: 200, text: async () => '<turtle>' })
    mockTempGraphFactory.mockReturnValue({ match: () => [] })
    await promise
    expect(loading.value).toBe(false)
  })

  test('loading is false after discovery completes successfully', async () => {
    const { loading, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(loading.value).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — regression guards', () => {
  // Spec: F.Find_Note — discovery is about TYPES, not URI NAMING. A
  // resource whose URI does not match any prefix convention must still
  // be returned if its RDF type matches. This guard locks the v5.1.3
  // draft's `/t/t_note_` URI-prefix filter OUT.
  test('returns notes regardless of URI path / naming (no t_note_ prefix filter)', async () => {
    const candidates = [
      `${POD}/t/t_note_classic`,
      `${POD}/t/weird_name_no_prefix`,
      `${POD}/t/t_annotation_42`
    ]
    setContainerListing(`${POD}/t/`, candidates)
    setStoreTypeHits({ schemaNote: candidates })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri).sort()).toEqual([...candidates].sort())
  })

  // Spec: F.Find_Note — the 5.0.0 regression matched on
  // neo:a_fragmented-document so "list my notes" returned zero. Lock it
  // out across ALL queried type objects.
  test('never matches on neo:a_fragmented-document (5.0.0 regression type)', async () => {
    setContainerListing(`${POD}/t/`, [`${POD}/t/t_note_a`])
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    for (const call of mockStoreMatch.mock.calls) {
      expect(call[2].value).not.toContain('a_fragmented-document')
    }
  })

  // Spec: F.Find_Note — 5.1.2 required schema:Note in the queried types.
  // NoteWorld writes schema:Note; dropping it vanishes every
  // NoteWorld-authored note.
  test('includes schema:Note in the queried types (5.1.2 guard)', async () => {
    setContainerListing(`${POD}/t/`, [`${POD}/t/t_note_a`])
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    const objectValues = mockStoreMatch.mock.calls.map(call => call[2].value)
    expect(objectValues).toContain('http://schema.org/Note')
  })

  // Spec: F.Find_Note — 5.1.3 tried /search/{concept}; that path does
  // not exist on this pod's indexer on tst-ia2 (returns empty). The
  // composable must NOT rely on ur.searchAndGetURIs for enumeration.
  // (We don't import or mock it; the source file should not reference
  // it either. This guard is a semantic lock — if a refactor adds it
  // back, hyperFetch call shape or the test expectations would shift
  // visibly.)
  test('uses ur.fetchAndSaveTurtle for per-candidate classification, not ur.searchAndGetURIs', async () => {
    const candidates = [`${POD}/t/t_note_a`]
    setContainerListing(`${POD}/t/`, candidates)
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(mockFetchAndSaveTurtle).toHaveBeenCalledWith(candidates[0], true)
  })

  // Spec: F.Find_Note — isolate LDP parse from the shared store. The
  // container listing is parsed into a TEMPORARY graph created by
  // $rdf.graph(), never into ur.rdfStore. If a future change parses LDP
  // metadata into the shared store, cross-source leakage could shadow
  // real type triples.
  test('parses the container Turtle into a temporary graph, not ur.rdfStore', async () => {
    setContainerListing(`${POD}/t/`, [`${POD}/t/t_note_a`])
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    const tempGraphInstance = mockTempGraphFactory.mock.results[0]?.value
    expect(tempGraphInstance).toBeDefined()
    const parseTarget = mockRdfParse.mock.calls[0]?.[1]
    expect(parseTarget).toBe(tempGraphInstance)
    // The shared store's match is our mockStoreMatch; the temp graph's
    // is a function on the ad-hoc object we returned from the factory.
    expect(parseTarget.match).not.toBe(mockStoreMatch)
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — error clearing', () => {
  test('clears previous error when a new search starts', async () => {
    const { error, searchNotes } = useTwinPodNoteSearch()
    await searchNotes('')
    expect(error.value?.type).toBe('invalid-input')
    await searchNotes(POD)
    expect(error.value).toBeNull()
  })
})
