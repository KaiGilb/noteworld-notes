// UNIT_TYPE=Hook
//
// Tests for useTwinPodNoteRead. The composable reads a note's current text
// from TwinPod by calling `ur.fetchResourceTurtle` (NOT window.solid.session.fetch
// directly) — ur.fetchResourceTurtle wraps session.fetch without the hypergraph
// header so TwinPod returns the actual resource Turtle rather than the full
// pod knowledge graph. Header correctness is tested in twinpod-client's
// util-rdf.test.js; this suite focuses on the composable's own logic.
//
// The parsed Turtle is loaded into a temp rdflib graph, then queried for all
// statements with the configured text predicate. TwinPod preserves state
// history, so the CURRENT value is the last statement in serialisation order.
// Whitespace-only values fall back to a localStorage cache keyed by URI — that
// cache is how an optimistic-create new note still shows content after an
// immediate reload before the server has observed the first save.

import { describe, test, expect, vi, beforeEach } from 'vitest'

// Hoisted mocks so `vi.mock` can reference them (factory runs before imports).
const { mockFetchResourceTurtle, mockGraph, mockParse, mockSym, mockStore } = vi.hoisted(() => {
  // Each call to `ur.$rdf.graph()` returns a fresh object that carries its own
  // `statementsMatching` spy — lets tests decide what a query returns per-run.
  const makeStore = () => ({
    statementsMatching: vi.fn().mockReturnValue([])
  })
  const store = { current: makeStore() }
  return {
    mockFetchResourceTurtle: vi.fn(),
    mockGraph: vi.fn(() => store.current),
    mockParse: vi.fn(),
    mockSym: vi.fn((val) => ({ value: val, termType: 'NamedNode' })),
    mockStore: store
  }
})

vi.mock('@kaigilb/twinpod-client', () => ({
  ur: {
    fetchResourceTurtle: (...args) => mockFetchResourceTurtle(...args),
    $rdf: {
      graph: (...args) => mockGraph(...args),
      parse: (...args) => mockParse(...args),
      sym: (...args) => mockSym(...args)
    }
  }
}))

import { useTwinPodNoteRead } from './useTwinPodNoteRead.js'

const POD = 'https://tst-first.demo.systemtwin.com'
const NOTE_URL = `${POD}/t/t_note_123_abcd`
const DEFAULT_PRED = 'http://schema.org/text'
const GMX_PRED = 'http://graphmetrix.com/node#m_text'

function makeStatement(value) {
  return { object: { value } }
}

// Minimal response shim: ur.fetchResourceTurtle resolves to { ok, status, turtle }.
function makeResponse({ ok = true, status = 200, turtle = '' } = {}) {
  return { ok, status, turtle }
}

// Default: happy-path — ur.fetchResourceTurtle resolves with empty Turtle;
// tempGraph returns one statement with the configured text predicate.
function installDefaultHappyPath() {
  mockFetchResourceTurtle.mockReset()
  mockFetchResourceTurtle.mockResolvedValue(makeResponse({ turtle: '<>.' }))

  mockStore.current = {
    statementsMatching: vi.fn((_s, predObj) => {
      if (predObj?.value === DEFAULT_PRED) return [makeStatement('loaded text')]
      return []
    })
  }
}

beforeEach(() => {
  // localStorage is available via jsdom; clear between tests so cache hits are
  // intentional per test.
  try { localStorage.clear() } catch { /* ignore */ }

  mockGraph.mockClear()
  mockParse.mockClear()
  mockSym.mockClear()
  installDefaultHappyPath()
})

describe('useTwinPodNoteRead — initial state', () => {
  test('text starts null', () => {
    const { text } = useTwinPodNoteRead()
    expect(text.value).toBeNull()
  })
  test('loading starts false', () => {
    const { loading } = useTwinPodNoteRead()
    expect(loading.value).toBe(false)
  })
  test('error starts null', () => {
    const { error } = useTwinPodNoteRead()
    expect(error.value).toBeNull()
  })
})

describe('useTwinPodNoteRead — success', () => {
  // Spec: F.Edit_Note — loads resource via ur.fetchResourceTurtle (no hypergraph header).
  // Regression guard (5.2.0): header correctness (Accept, Cache-Control, no hypergraph)
  // is tested in twinpod-client/src/util-rdf.test.js for ur.fetchResourceTurtle.
  test('calls ur.fetchResourceTurtle with the resource URL', async () => {
    const { loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    expect(mockFetchResourceTurtle).toHaveBeenCalledTimes(1)
    expect(mockFetchResourceTurtle).toHaveBeenCalledWith(NOTE_URL)
  })

  // Spec: F.Edit_Note — current text is the last statement in temporal serialisation order.
  test('returns the last statement value from the temp graph query', async () => {
    const { loadNote } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe('loaded text')
  })

  // Spec: F.Edit_Note — predicateUri option overrides the default schema:text
  test('queries with a custom predicateUri when provided', async () => {
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === 'https://example.com/p') return [makeStatement('custom')]
        return []
      })
    }
    const { loadNote } = useTwinPodNoteRead({ predicateUri: 'https://example.com/p' })
    const value = await loadNote(NOTE_URL)
    expect(value).toBe('custom')
    expect(mockSym).toHaveBeenCalledWith('https://example.com/p')
  })

  // Spec: F.Edit_Note — text ref reflects the loaded note content
  test('updates the text ref after success', async () => {
    const { text, loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    expect(text.value).toBe('loaded text')
  })

  // Spec: F.Edit_Note — returns empty string when no text predicate exists on the resource
  test('returns empty string when no statements are found', async () => {
    mockStore.current = { statementsMatching: vi.fn().mockReturnValue([]) }
    const { loadNote, text } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe('')
    expect(text.value).toBe('')
  })

  // Spec: F.Edit_Note — TwinPod state history: multiple values present, current is the last one
  test('returns the last value when multiple statements exist (TwinPod state history)', async () => {
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === DEFAULT_PRED) {
          return [makeStatement(' '), makeStatement('first edit'), makeStatement('latest edit')]
        }
        return []
      })
    }
    const { loadNote } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe('latest edit')
  })

  // Legacy Graphmetrix predicate co-existence: statements for the GMX predicate
  // concat after the schema:text results; last overall wins.
  test('includes statements from the legacy GMX predicate when present', async () => {
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === DEFAULT_PRED) return [makeStatement('schema text')]
        if (predObj?.value === GMX_PRED) return [makeStatement('gmx text')]
        return []
      })
    }
    const { loadNote } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe('gmx text')
  })

  // Regression guard (5.2.0): the composable must delegate to ur.fetchResourceTurtle —
  // never call window.solid.session.fetch directly. Any revert to direct session.fetch
  // would bypass ur's header management and fail this guard.
  test('never calls window.solid.session.fetch directly — ur.fetchResourceTurtle only (5.2.0 guard)', async () => {
    const windowSpy = vi.fn()
    if (!globalThis.window) globalThis.window = {}
    globalThis.window.solid = { session: { fetch: windowSpy } }
    const { loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    expect(windowSpy).not.toHaveBeenCalled()
    delete globalThis.window.solid
  })
})

describe('useTwinPodNoteRead — state history edge cases', () => {
  // TwinPod never overwrites: after many edits a note carries N historical values
  // in document order. The read path must always pick the LAST value.
  test('ignores the single-space placeholder when later edits exist', async () => {
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === DEFAULT_PRED) return [makeStatement(' '), makeStatement('real content')]
        return []
      })
    }
    const { loadNote } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe('real content')
  })

  // Spec: F.Edit_Note — fresh note carries a ' ' placeholder. When the localStorage
  // cache is unavailable (opaque-origin jsdom throws SecurityError; the source's
  // try/catch swallows it) the placeholder is surfaced as-is so the editor gets
  // the raw value from TwinPod rather than silently losing it.
  test('returns the whitespace placeholder when localStorage fallback is unavailable', async () => {
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === DEFAULT_PRED) return [makeStatement(' ')]
        return []
      })
    }
    const { loadNote, text } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe(' ')
    expect(text.value).toBe(' ')
  })

  test('handles a long history without throwing (10 historical values)', async () => {
    const history = Array.from({ length: 10 }, (_, i) => makeStatement(`edit ${i}`))
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === DEFAULT_PRED) return history
        return []
      })
    }
    const { loadNote } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe('edit 9')
  })

  // The source includes a localStorage fallback: when TwinPod returns only
  // whitespace (e.g. a brand-new note whose create PUT has not yet been
  // saved-over), the cached text written by useTwinPodNoteSave would be
  // served. This cannot be exercised in the package's jsdom test environment
  // (opaque origin → localStorage access throws SecurityError) so the cache
  // hit is verified end-to-end in the app's E2E suite instead.
})

describe('useTwinPodNoteRead — input validation', () => {
  test('returns null and sets error when noteResourceUrl is empty', async () => {
    const { error, loadNote } = useTwinPodNoteRead()
    const value = await loadNote('')
    expect(value).toBeNull()
    expect(error.value?.type).toBe('invalid-input')
    expect(mockFetchResourceTurtle).not.toHaveBeenCalled()
  })

  test('returns null and sets error when noteResourceUrl is null', async () => {
    const { error, loadNote } = useTwinPodNoteRead()
    const value = await loadNote(null)
    expect(value).toBeNull()
    expect(error.value?.type).toBe('invalid-input')
    expect(mockFetchResourceTurtle).not.toHaveBeenCalled()
  })
})

describe('useTwinPodNoteRead — not found', () => {
  test('sets error.type to not-found when ur.fetchResourceTurtle returns 404', async () => {
    mockFetchResourceTurtle.mockResolvedValueOnce(makeResponse({ ok: false, status: 404 }))
    const { error, loadNote } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBeNull()
    expect(error.value?.type).toBe('not-found')
  })
})

describe('useTwinPodNoteRead — HTTP error', () => {
  test('sets error.type to http on non-ok non-404 response', async () => {
    mockFetchResourceTurtle.mockResolvedValueOnce(makeResponse({ ok: false, status: 403 }))
    const { error, loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    expect(error.value?.type).toBe('http')
    expect(error.value?.status).toBe(403)
  })

  test('sets error.type to network when ur.fetchResourceTurtle rejects', async () => {
    mockFetchResourceTurtle.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { error, loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    expect(error.value?.type).toBe('network')
  })

  test('loading is false after error', async () => {
    mockFetchResourceTurtle.mockRejectedValueOnce(new Error('boom'))
    const { loading, loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    expect(loading.value).toBe(false)
  })
})

describe('useTwinPodNoteRead — loading transition', () => {
  test('loading is true while ur.fetchResourceTurtle is in progress', async () => {
    let resolveFetch
    mockFetchResourceTurtle.mockImplementationOnce(() => new Promise(r => {
      resolveFetch = () => r(makeResponse({ turtle: '<>.' }))
    }))
    const { loading, loadNote } = useTwinPodNoteRead()
    const promise = loadNote(NOTE_URL)
    expect(loading.value).toBe(true)
    resolveFetch()
    await promise
    expect(loading.value).toBe(false)
  })
})

describe('useTwinPodNoteRead — Turtle parsing', () => {
  // Spec: F.Edit_Note — the Turtle returned by ur.fetchResourceTurtle must be parsed
  // into a fresh temp graph (not ur.rdfStore) so the global store is not polluted
  // with per-note Turtle. ur.$rdf.parse must be called with:
  //   (turtleString, tempGraph, baseUri, 'text/turtle')
  test('parses the fetched Turtle into a temp graph with the note URL as base', async () => {
    const TURTLE_BODY = '<> a <https://neo.graphmetrix.net/node/a_paragraph> .'
    mockFetchResourceTurtle.mockResolvedValueOnce(makeResponse({ turtle: TURTLE_BODY }))
    const { loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    expect(mockParse).toHaveBeenCalledTimes(1)
    expect(mockParse).toHaveBeenCalledWith(TURTLE_BODY, expect.any(Object), NOTE_URL, 'text/turtle')
  })

  test('creates a fresh temp graph via ur.$rdf.graph() on each load call', async () => {
    const { loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    await loadNote(NOTE_URL)
    // Two calls to loadNote → two temp graphs
    expect(mockGraph).toHaveBeenCalledTimes(2)
  })

  // Regression guard (5.2.1 blank-node subject fix):
  // TwinPod may serialise notes where the text literal hangs off a blank-node
  // subject rather than a named URI. The query must use `null` as the first
  // argument to `statementsMatching` to match any subject (NamedNode or
  // BlankNode). A regression to `statementsMatching(ur.$rdf.sym(noteUri), ...)`
  // would miss blank-node subjects and return empty text.
  //
  // We guard this by verifying that `statementsMatching` is called with `null`
  // (not a non-null NamedNode) as its subject argument.
  test('calls statementsMatching with null as subject (5.2.1 blank-node subject fix)', async () => {
    const { loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    // statementsMatching must be called at least once with null as subject.
    const calls = mockStore.current.statementsMatching.mock.calls
    const anyNullSubject = calls.some(c => c[0] === null)
    expect(anyNullSubject).toBe(true)
  })
})
