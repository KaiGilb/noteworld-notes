// UNIT_TYPE=Hook
//
// Tests for useTwinPodNoteSearch (5.1.8 — two-step SIO class resolution).
//
// Design under test:
//   For each typeUri, derive the Neo concept name (last path segment)
//   and call ur.searchAndGetURIs(podRoot, conceptName, { force: true }).
//   After all searches settle, a two-step lookup finds notes:
//     1. ur.rdfStore.match(null, neo:m_cid, null) — wildcard on object —
//        then filter by st.object.value === conceptName.
//        This yields the SIO class URI (e.g. sio:SIO_000110) that the pod
//        uses as the rdf:type for notes of this concept.
//     2. ur.rdfStore.match(null, rdf:type, classNode) — subjects are notes.
//
// Why SIO class URIs, not neo:a_paragraph directly:
//   The real pod (tst-ia2.demo.systemtwin.com) search endpoint returns
//   Turtle where notes carry rdf:type sio:SIO_000110, and the class node
//   carries neo:m_cid "a_paragraph". Direct rdf:type neo:a_paragraph is
//   absent. Verified 2026-04-19 via live debug panel in HomeView.

import { describe, test, expect, vi, beforeEach } from 'vitest'

// --- SIO class URI constants used as stand-ins in tests ---
const SIO_PARAGRAPH = 'http://semanticscience.org/resource/SIO_000110' // real pod value
const SIO_NOTE      = 'http://semanticscience.org/resource/SIO_000020' // hypothetical for a_note tests

const {
  mockSearchAndGetURIs,
  mockStoreMatch
} = vi.hoisted(() => ({
  mockSearchAndGetURIs: vi.fn(),
  mockStoreMatch: vi.fn()
}))

vi.mock('@kaigilb/twinpod-client', () => ({
  ur: {
    searchAndGetURIs: (...args) => mockSearchAndGetURIs(...args),
    rdfStore: { match: (...args) => mockStoreMatch(...args) },
    $rdf: {
      sym: (value) => ({ value, termType: 'NamedNode' })
    },
    NS: {
      RDF: (name) => ({ value: `http://www.w3.org/1999/02/22-rdf-syntax-ns#${name}`, termType: 'NamedNode' }),
      NEO: (name) => ({ value: `https://neo.graphmetrix.net/node/${name}`, termType: 'NamedNode' })
    }
  }
}))

// ---------------------------------------------------------------------------
// Helper — configure what rdfStore.match returns for the two-step SIO lookup.
//
// mcidResults: array of { conceptName, classUri } — returned by the
//   neo:m_cid wildcard match (step 1).
// typeResults: { classUri: [noteUri, ...] } — returned by the rdf:type
//   match for each class node (step 2).
// ---------------------------------------------------------------------------
function setStoreMatches({ mcidResults = [], typeResults = {} } = {}) {
  mockStoreMatch.mockImplementation((subject, predicate, object) => {
    const pred = predicate?.value

    // Step 1 call: match(null, neo:m_cid, null)
    if (pred === 'https://neo.graphmetrix.net/node/m_cid') {
      return mcidResults.map(({ conceptName, classUri }) => ({
        subject: { value: classUri },
        object:  { value: conceptName }
      }))
    }

    // Step 2 call: match(null, rdf:type, classNode)
    if (pred === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
      const classUri = object?.value
      return (typeResults[classUri] ?? []).map(uri => ({ subject: { value: uri } }))
    }

    return []
  })
}

import { useTwinPodNoteSearch } from './useTwinPodNoteSearch.js'

const POD = 'https://tst-ia2.demo.systemtwin.com'

beforeEach(() => {
  mockSearchAndGetURIs.mockReset()
  mockStoreMatch.mockReset()
  // Default: searches resolve OK, store returns no hits.
  mockSearchAndGetURIs.mockResolvedValue({ response: '', status: 200 })
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

describe('useTwinPodNoteSearch — search calls', () => {
  test('calls ur.searchAndGetURIs once per default typeUri', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(mockSearchAndGetURIs).toHaveBeenCalledTimes(2)
  })

  test('passes the pod root as first argument', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    for (const call of mockSearchAndGetURIs.mock.calls) {
      expect(call[0]).toBe(POD)
    }
  })

  // Spec: F.Find_Note — concept name is the Neo identifier, not a label.
  test('derives concept name a_paragraph from the neo:a_paragraph URI', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    const concepts = mockSearchAndGetURIs.mock.calls.map(c => c[1])
    expect(concepts).toContain('a_paragraph')
  })

  test('derives concept name a_note from the neo:a_note URI', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    const concepts = mockSearchAndGetURIs.mock.calls.map(c => c[1])
    expect(concepts).toContain('a_note')
  })

  // Spec: force: true bypasses the ur.searchAndGetURIs session cache.
  test('passes force: true to bypass the search cache', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    for (const call of mockSearchAndGetURIs.mock.calls) {
      expect(call[2]).toMatchObject({ force: true })
    }
  })

  test('accepts a custom typeUris list and searches each derived concept', async () => {
    const { searchNotes } = useTwinPodNoteSearch({
      typeUris: [
        'https://neo.graphmetrix.net/node/a_task',
        'https://neo.graphmetrix.net/node/a_event'
      ]
    })
    await searchNotes(POD)
    const concepts = mockSearchAndGetURIs.mock.calls.map(c => c[1]).sort()
    expect(concepts).toEqual(['a_event', 'a_task'])
  })

  test('falls back to default typeUris when opts.typeUris is empty', async () => {
    const { searchNotes } = useTwinPodNoteSearch({ typeUris: [] })
    await searchNotes(POD)
    const concepts = mockSearchAndGetURIs.mock.calls.map(c => c[1])
    expect(concepts).toContain('a_paragraph')
    expect(concepts).toContain('a_note')
  })

  test('falls back to default typeUris when opts.typeUris is non-array', async () => {
    const { searchNotes } = useTwinPodNoteSearch({ typeUris: 'a_paragraph' })
    await searchNotes(POD)
    const concepts = mockSearchAndGetURIs.mock.calls.map(c => c[1])
    expect(concepts).toContain('a_paragraph')
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — SIO type filter', () => {
  // The search response maps neo:m_cid → SIO class → rdf:type → note URIs.

  test('returns notes resolved via neo:m_cid → SIO class → rdf:type for a_paragraph', async () => {
    setStoreMatches({
      mcidResults: [{ conceptName: 'a_paragraph', classUri: SIO_PARAGRAPH }],
      typeResults:  { [SIO_PARAGRAPH]: [`${POD}/node/t_note_a`, `${POD}/node/t_note_b`] }
    })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri).sort()).toEqual([
      `${POD}/node/t_note_a`, `${POD}/node/t_note_b`
    ])
  })

  test('returns notes resolved via neo:m_cid → SIO class → rdf:type for a_note', async () => {
    setStoreMatches({
      mcidResults: [{ conceptName: 'a_note', classUri: SIO_NOTE }],
      typeResults:  { [SIO_NOTE]: [`${POD}/node/t_note_x`] }
    })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri)).toEqual([`${POD}/node/t_note_x`])
  })

  test('calls store.match with neo:m_cid predicate (not rdf:type directly on the typeUri)', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    const predicates = mockStoreMatch.mock.calls.map(c => c[1]?.value)
    expect(predicates).toContain('https://neo.graphmetrix.net/node/m_cid')
    // Must NOT query rdf:type neo:a_paragraph directly — types come via SIO class.
    const typeObjects = mockStoreMatch.mock.calls
      .filter(c => c[1]?.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
      .map(c => c[2]?.value)
    expect(typeObjects).not.toContain('https://neo.graphmetrix.net/node/a_paragraph')
  })

  test('returns [] when no neo:m_cid class node is found in store for any typeUri', async () => {
    // Default mock returns [] for all store.match calls.
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result).toEqual([])
  })

  test('custom typeUris drives the m_cid lookup to only those concept names', async () => {
    setStoreMatches({
      mcidResults: [
        { conceptName: 'a_paragraph', classUri: SIO_PARAGRAPH },
        { conceptName: 'a_custom',    classUri: 'http://example.org/CustomClass' }
      ],
      typeResults: {
        [SIO_PARAGRAPH]:             [`${POD}/node/t_para`],
        'http://example.org/CustomClass': [`${POD}/node/t_custom`]
      }
    })
    const { searchNotes } = useTwinPodNoteSearch({
      typeUris: ['http://example.org/vocab/a_custom']
    })
    const result = await searchNotes(POD)
    // Only a_custom notes returned — a_paragraph was not in typeUris.
    expect(result.map(r => r.uri)).toEqual([`${POD}/node/t_custom`])
  })

  test('excludes the SIO class node itself from note results', async () => {
    // Defensive guard: if the class node somehow appears in the rdf:type match,
    // the uri !== classNode.value filter must exclude it.
    setStoreMatches({
      mcidResults: [{ conceptName: 'a_paragraph', classUri: SIO_PARAGRAPH }],
      typeResults:  { [SIO_PARAGRAPH]: [`${POD}/node/t_note_a`, SIO_PARAGRAPH] }
    })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri)).toContain(`${POD}/node/t_note_a`)
    expect(result.map(r => r.uri)).not.toContain(SIO_PARAGRAPH)
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — union and dedup', () => {
  test('dedupes a note found under both a_paragraph and a_note SIO classes', async () => {
    const shared = `${POD}/node/t_note_both`
    setStoreMatches({
      mcidResults: [
        { conceptName: 'a_paragraph', classUri: SIO_PARAGRAPH },
        { conceptName: 'a_note',      classUri: SIO_NOTE }
      ],
      typeResults: {
        [SIO_PARAGRAPH]: [shared],
        [SIO_NOTE]:      [shared]
      }
    })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.filter(r => r.uri === shared).length).toBe(1)
  })

  test('unions results from both type searches', async () => {
    setStoreMatches({
      mcidResults: [
        { conceptName: 'a_paragraph', classUri: SIO_PARAGRAPH },
        { conceptName: 'a_note',      classUri: SIO_NOTE }
      ],
      typeResults: {
        [SIO_PARAGRAPH]: [`${POD}/node/t_para`],
        [SIO_NOTE]:      [`${POD}/node/t_legacy`]
      }
    })
    const { searchNotes } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri).sort()).toEqual([
      `${POD}/node/t_legacy`,
      `${POD}/node/t_para`
    ])
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — error handling', () => {
  test('sets search-error when all searches resolve with error flag', async () => {
    mockSearchAndGetURIs.mockResolvedValue({ error: 'true' })
    const { searchNotes, error } = useTwinPodNoteSearch()
    expect(await searchNotes(POD)).toEqual([])
    expect(error.value?.type).toBe('search-error')
  })

  test('sets search-error when all searches return HTTP 500', async () => {
    mockSearchAndGetURIs.mockResolvedValue({ response: 'Server Error', status: 500 })
    const { searchNotes, error } = useTwinPodNoteSearch()
    expect(await searchNotes(POD)).toEqual([])
    expect(error.value?.type).toBe('search-error')
  })

  test('sets search-error when all searches reject', async () => {
    mockSearchAndGetURIs.mockRejectedValue(new Error('network'))
    const { searchNotes, error } = useTwinPodNoteSearch()
    expect(await searchNotes(POD)).toEqual([])
    expect(error.value?.type).toBe('search-error')
  })

  test('does NOT set error when searches succeed but return no notes (empty pod)', async () => {
    const { searchNotes, error } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result).toEqual([])
    expect(error.value).toBeNull()
  })

  test('does NOT set error when one search fails but another succeeds with notes', async () => {
    mockSearchAndGetURIs
      .mockResolvedValueOnce({ response: '', status: 200 })  // a_paragraph ok
      .mockRejectedValueOnce(new Error('network'))            // a_note fails
    setStoreMatches({
      mcidResults: [{ conceptName: 'a_paragraph', classUri: SIO_PARAGRAPH }],
      typeResults:  { [SIO_PARAGRAPH]: [`${POD}/node/t_note_a`] }
    })
    const { searchNotes, error } = useTwinPodNoteSearch()
    const result = await searchNotes(POD)
    expect(result.map(r => r.uri)).toEqual([`${POD}/node/t_note_a`])
    expect(error.value).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — input validation', () => {
  test('sets invalid-input and returns [] when podRoot is empty string', async () => {
    const { error, searchNotes } = useTwinPodNoteSearch()
    expect(await searchNotes('')).toEqual([])
    expect(error.value?.type).toBe('invalid-input')
    expect(mockSearchAndGetURIs).not.toHaveBeenCalled()
  })

  test('sets invalid-input when podRoot is null', async () => {
    const { error, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(null)
    expect(error.value?.type).toBe('invalid-input')
  })

  test('sets invalid-input when podRoot is undefined', async () => {
    const { error, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(undefined)
    expect(error.value?.type).toBe('invalid-input')
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — loading transition', () => {
  test('loading is true while searches are in flight', async () => {
    let releaseSearch
    mockSearchAndGetURIs.mockImplementationOnce(
      () => new Promise(r => { releaseSearch = r })
    )
    const { loading, searchNotes } = useTwinPodNoteSearch()
    const promise = searchNotes(POD)
    expect(loading.value).toBe(true)
    releaseSearch({ response: '', status: 200 })
    await promise
    expect(loading.value).toBe(false)
  })

  test('loading is false after searches complete', async () => {
    const { loading, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(loading.value).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — regression guards', () => {
  // Spec: F.Find_Note — 5.1.8 discovered that the real pod returns SIO-typed
  // Turtle from the search endpoint. The two-step m_cid lookup is now the
  // only correct discovery primitive. This guard locks in that pattern.
  test('queries rdfStore with neo:m_cid predicate to resolve SIO class (5.1.8 guard)', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    const predicates = mockStoreMatch.mock.calls.map(c => c[1]?.value)
    expect(predicates).toContain('https://neo.graphmetrix.net/node/m_cid')
  })

  // Spec: F.Find_Note — 5.0.0 regression matched neo:a_fragmented-document.
  // With the m_cid approach, concept names come from typeUris only — guard
  // that searchAndGetURIs is never called with 'a_fragmented-document'.
  test('never calls searchAndGetURIs with concept a_fragmented-document (5.0.0 regression guard)', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    const concepts = mockSearchAndGetURIs.mock.calls.map(c => c[1])
    for (const c of concepts) {
      expect(c).not.toContain('fragmented')
    }
  })

  // Spec: F.Find_Note — 5.1.4–5.1.6 used LDP container listing, which
  // is wrong for TwinPod. Discovery MUST be via ur.searchAndGetURIs.
  test('uses ur.searchAndGetURIs for discovery; never uses container listing (5.1.7 guard)', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(mockSearchAndGetURIs).toHaveBeenCalled()
    // ur.hyperFetch is not on the mock — calling it throws TypeError,
    // failing loudly. This is intentional.
  })

  // Spec: F.Find_Note — 5.1.2–5.1.3 passed 'note'/'notes' as concept names.
  // The search index key is the Neo identifier; human labels return empty.
  test('never searches for concept "note" or "notes" (5.1.3 regression guard)', async () => {
    const { searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    const concepts = mockSearchAndGetURIs.mock.calls.map(c => c[1])
    expect(concepts).not.toContain('note')
    expect(concepts).not.toContain('notes')
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

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — reactive notes ref', () => {
  // Spec: F.Find_Note — the reactive `notes` ref must be updated after searchNotes
  // so that HomeView's v-for binding reflects the found notes.
  test('notes.value is updated with found notes after successful searchNotes', async () => {
    setStoreMatches({
      mcidResults: [{ conceptName: 'a_paragraph', classUri: SIO_PARAGRAPH }],
      typeResults:  { [SIO_PARAGRAPH]: [`${POD}/node/t_note_a`] }
    })
    const { notes, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(notes.value.map(r => r.uri)).toEqual([`${POD}/node/t_note_a`])
  })

  // Spec: F.Find_Note — notes.value must reset to [] when a new search returns empty
  // (guards against a stale-list bug where notes from a prior search persist after
  // switching to a pod with no notes).
  test('notes.value resets to [] on a subsequent search that returns empty', async () => {
    setStoreMatches({
      mcidResults: [{ conceptName: 'a_paragraph', classUri: SIO_PARAGRAPH }],
      typeResults:  { [SIO_PARAGRAPH]: [`${POD}/node/t_note_a`] }
    })
    const { notes, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(notes.value.length).toBe(1)
    // Reset store to return no hits on the next call
    mockStoreMatch.mockReturnValue([])
    await searchNotes(POD)
    expect(notes.value).toEqual([])
  })
})

// ---------------------------------------------------------------------------

describe('useTwinPodNoteSearch — loading resets on error paths', () => {
  // Spec: F.Find_Note — loading must return to false after an error, not stay
  // stuck. HomeView relies on searchLoading to hide the "Loading notes…" spinner.
  test('loading.value is false after all searches reject (network error path)', async () => {
    mockSearchAndGetURIs.mockRejectedValue(new Error('network'))
    const { loading, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(loading.value).toBe(false)
  })

  test('loading.value is false after all searches return error flag (search-error path)', async () => {
    mockSearchAndGetURIs.mockResolvedValue({ error: 'true' })
    const { loading, searchNotes } = useTwinPodNoteSearch()
    await searchNotes(POD)
    expect(loading.value).toBe(false)
  })
})
