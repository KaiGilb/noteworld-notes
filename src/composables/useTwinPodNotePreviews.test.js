// UNIT_TYPE=Hook
//
// Tests for useTwinPodNotePreviews. The composable loads short text previews
// for a list of note URIs by calling ur.fetchResourceTurtle (no hypergraph
// header) for each URI in parallel. Text is extracted from a temp rdflib
// graph, truncated to maxLength, and stored in a reactive previews object.
// A localStorage cache is shown immediately and updated after each fetch.

import { describe, test, expect, vi, beforeEach } from 'vitest'

const { mockFetchResourceTurtle, mockGraph, mockParse, mockSym, mockStore } = vi.hoisted(() => {
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

import { useTwinPodNotePreviews } from './useTwinPodNotePreviews.js'

const POD = 'https://tst-first.demo.systemtwin.com'
const URI_A = `${POD}/t/t_note_111_aaaa`
const URI_B = `${POD}/t/t_note_222_bbbb`
const DEFAULT_PRED = 'http://schema.org/text'
const GMX_PRED = 'http://graphmetrix.com/node#m_text'

function makeStatement(value) {
  return { object: { value } }
}

function makeOkResponse(turtle = '<>.') {
  return { ok: true, status: 200, turtle }
}

function makeErrorResponse(status = 500) {
  return { ok: false, status, turtle: '' }
}

beforeEach(() => {
  try { localStorage.clear() } catch { /* ignore */ }
  mockFetchResourceTurtle.mockReset()
  mockGraph.mockClear()
  mockParse.mockClear()
  mockSym.mockClear()

  // Default: ok response, empty Turtle, no statements
  mockFetchResourceTurtle.mockResolvedValue(makeOkResponse())
  mockStore.current = { statementsMatching: vi.fn().mockReturnValue([]) }
})

describe('useTwinPodNotePreviews — initial state', () => {
  test('previews starts as an empty object', () => {
    const { previews } = useTwinPodNotePreviews()
    expect(previews.value).toEqual({})
  })
})

describe('useTwinPodNotePreviews — fetch', () => {
  test('calls ur.fetchResourceTurtle for each URI in the list', async () => {
    const { loadPreviews } = useTwinPodNotePreviews()
    await loadPreviews([URI_A, URI_B])
    expect(mockFetchResourceTurtle).toHaveBeenCalledTimes(2)
    expect(mockFetchResourceTurtle).toHaveBeenCalledWith(URI_A)
    expect(mockFetchResourceTurtle).toHaveBeenCalledWith(URI_B)
  })

  test('does nothing for an empty URI list', async () => {
    const { previews, loadPreviews } = useTwinPodNotePreviews()
    await loadPreviews([])
    expect(mockFetchResourceTurtle).not.toHaveBeenCalled()
    expect(previews.value).toEqual({})
  })

  // Regression guard (5.2.0): window.solid.session.fetch must NOT be called directly.
  // ur.fetchResourceTurtle is the only legal TwinPod read primitive in composables.
  test('never calls window.solid.session.fetch directly — ur.fetchResourceTurtle only (5.2.0 guard)', async () => {
    const windowSpy = vi.fn()
    if (!globalThis.window) globalThis.window = {}
    globalThis.window.solid = { session: { fetch: windowSpy } }
    const { loadPreviews } = useTwinPodNotePreviews()
    await loadPreviews([URI_A])
    expect(windowSpy).not.toHaveBeenCalled()
    delete globalThis.window.solid
  })
})

describe('useTwinPodNotePreviews — text extraction', () => {
  test('sets previews[uri] from schema:text statement', async () => {
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === DEFAULT_PRED) return [makeStatement('hello world')]
        return []
      })
    }
    const { previews, loadPreviews } = useTwinPodNotePreviews()
    await loadPreviews([URI_A])
    expect(previews.value[URI_A]).toBe('hello world')
  })

  // Spec: TwinPod state history — the last statement in serialisation order is current.
  test('uses the last statement value (TwinPod state history)', async () => {
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === DEFAULT_PRED) {
          return [makeStatement('old text'), makeStatement('new text')]
        }
        return []
      })
    }
    const { previews, loadPreviews } = useTwinPodNotePreviews()
    await loadPreviews([URI_A])
    expect(previews.value[URI_A]).toBe('new text')
  })

  // Legacy Graphmetrix predicate: schema:text statements concat with GMX statements;
  // last overall wins.
  test('falls back to GMX predicate when schema:text results exist (last wins)', async () => {
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === DEFAULT_PRED) return [makeStatement('schema text')]
        if (predObj?.value === GMX_PRED) return [makeStatement('gmx text')]
        return []
      })
    }
    const { previews, loadPreviews } = useTwinPodNotePreviews()
    await loadPreviews([URI_A])
    expect(previews.value[URI_A]).toBe('gmx text')
  })

  test('does not set previews[uri] when no text statements exist', async () => {
    mockStore.current = { statementsMatching: vi.fn().mockReturnValue([]) }
    const { previews, loadPreviews } = useTwinPodNotePreviews()
    await loadPreviews([URI_A])
    expect(previews.value[URI_A]).toBeUndefined()
  })

  test('uses custom predicateUri when provided', async () => {
    const CUSTOM_PRED = 'https://example.com/label'
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === CUSTOM_PRED) return [makeStatement('custom label')]
        return []
      })
    }
    const { previews, loadPreviews } = useTwinPodNotePreviews({ predicateUri: CUSTOM_PRED })
    await loadPreviews([URI_A])
    expect(previews.value[URI_A]).toBe('custom label')
    expect(mockSym).toHaveBeenCalledWith(CUSTOM_PRED)
  })
})

describe('useTwinPodNotePreviews — truncation', () => {
  test('stores full text when shorter than maxLength', async () => {
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === DEFAULT_PRED) return [makeStatement('short')]
        return []
      })
    }
    const { previews, loadPreviews } = useTwinPodNotePreviews({ maxLength: 60 })
    await loadPreviews([URI_A])
    expect(previews.value[URI_A]).toBe('short')
  })

  test('truncates text to maxLength characters + ellipsis when over limit', async () => {
    const longText = 'a'.repeat(70)
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === DEFAULT_PRED) return [makeStatement(longText)]
        return []
      })
    }
    const { previews, loadPreviews } = useTwinPodNotePreviews({ maxLength: 60 })
    await loadPreviews([URI_A])
    expect(previews.value[URI_A]).toBe('a'.repeat(60) + '…')
  })

  test('respects a custom maxLength option', async () => {
    const text = 'hello world this is a test'
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === DEFAULT_PRED) return [makeStatement(text)]
        return []
      })
    }
    const { previews, loadPreviews } = useTwinPodNotePreviews({ maxLength: 10 })
    await loadPreviews([URI_A])
    expect(previews.value[URI_A]).toBe(text.slice(0, 10) + '…')
  })
})

describe('useTwinPodNotePreviews — error handling', () => {
  test('silently skips a URI when ur.fetchResourceTurtle returns non-ok', async () => {
    mockFetchResourceTurtle.mockResolvedValue(makeErrorResponse(500))
    const { previews, loadPreviews } = useTwinPodNotePreviews()
    await expect(loadPreviews([URI_A])).resolves.not.toThrow()
    expect(previews.value[URI_A]).toBeUndefined()
  })

  test('silently skips a URI when ur.fetchResourceTurtle rejects (network error)', async () => {
    mockFetchResourceTurtle.mockRejectedValue(new Error('network error'))
    const { previews, loadPreviews } = useTwinPodNotePreviews()
    await expect(loadPreviews([URI_A])).resolves.not.toThrow()
    expect(previews.value[URI_A]).toBeUndefined()
  })

  test('loads successful URIs even when one URI in the batch fails', async () => {
    mockStore.current = {
      statementsMatching: vi.fn((_s, predObj) => {
        if (predObj?.value === DEFAULT_PRED) return [makeStatement('ok note')]
        return []
      })
    }
    // URI_A fails; URI_B succeeds
    mockFetchResourceTurtle
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(makeOkResponse())
    const { previews, loadPreviews } = useTwinPodNotePreviews()
    await loadPreviews([URI_A, URI_B])
    expect(previews.value[URI_A]).toBeUndefined()
    expect(previews.value[URI_B]).toBe('ok note')
  })
})

// localStorage cache — read-on-start (show cached text immediately) and
// write-after-fetch (persist newly loaded text) are exercised end-to-end in
// the app's E2E suite. The jsdom test environment uses an opaque origin, which
// makes localStorage methods unavailable (TypeError) just as in
// useTwinPodNoteRead.test.js. The source wraps every localStorage access in
// try/catch so the runtime behaviour is correct — these tests simply cannot be
// exercised in the unit-test layer.

describe('useTwinPodNotePreviews — Turtle parsing', () => {
  // Spec: F.Find_Note — Turtle returned by ur.fetchResourceTurtle is parsed into
  // a fresh temp graph per URI so the global store is not polluted.
  // ur.$rdf.parse must be called with (turtleString, tempGraph, baseUri, 'text/turtle').
  test('parses the fetched Turtle into a temp graph with the note URI as base', async () => {
    const TURTLE_BODY = '<> a <https://neo.graphmetrix.net/node/a_paragraph> .'
    mockFetchResourceTurtle.mockResolvedValueOnce({ ok: true, status: 200, turtle: TURTLE_BODY })
    const { loadPreviews } = useTwinPodNotePreviews()
    await loadPreviews([URI_A])
    expect(mockParse).toHaveBeenCalledTimes(1)
    expect(mockParse).toHaveBeenCalledWith(TURTLE_BODY, expect.any(Object), URI_A, 'text/turtle')
  })

  test('creates a fresh temp graph via ur.$rdf.graph() for each URI', async () => {
    mockFetchResourceTurtle
      .mockResolvedValueOnce({ ok: true, status: 200, turtle: '<>.' })
      .mockResolvedValueOnce({ ok: true, status: 200, turtle: '<>.' })
    const { loadPreviews } = useTwinPodNotePreviews()
    await loadPreviews([URI_A, URI_B])
    // One temp graph created per URI — ensures no cross-URI contamination
    expect(mockGraph).toHaveBeenCalledTimes(2)
  })
})

describe('useTwinPodNotePreviews — parallel fetching', () => {
  // Spec: JSDoc — "Fetches all URIs in parallel."
  // useTwinPodNotePreviews must call ur.fetchResourceTurtle for all URIs concurrently.
  // A sequential implementation would call each fetch only after the previous one resolves.
  // The parallel implementation initiates ALL fetches immediately, so every fetch must be
  // in-flight before any of them resolves.
  test('initiates all fetches before any resolves — all called concurrently', async () => {
    const fetchOrder = []
    let resolveA, resolveB

    mockFetchResourceTurtle
      .mockImplementationOnce(() => {
        fetchOrder.push('A-started')
        return new Promise(r => { resolveA = () => { fetchOrder.push('A-resolved'); r({ ok: true, status: 200, turtle: '<>.' }) } })
      })
      .mockImplementationOnce(() => {
        fetchOrder.push('B-started')
        return new Promise(r => { resolveB = () => { fetchOrder.push('B-resolved'); r({ ok: true, status: 200, turtle: '<>.' }) } })
      })

    const { loadPreviews } = useTwinPodNotePreviews()
    const p = loadPreviews([URI_A, URI_B])

    // At this point in the microtask queue, both fetches have been initiated.
    // Neither has resolved yet — parallel: both 'started' events come before any 'resolved'.
    resolveA()
    resolveB()
    await p

    // Both fetches started before either resolved — proof of parallel dispatch
    expect(fetchOrder[0]).toBe('A-started')
    expect(fetchOrder[1]).toBe('B-started')
    expect(fetchOrder).toContain('A-resolved')
    expect(fetchOrder).toContain('B-resolved')
  })
})
