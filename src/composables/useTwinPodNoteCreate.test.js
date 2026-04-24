import { describe, test, expect, vi, beforeEach } from 'vitest'

const { mockGraph, mock$rdf, mockNS, mockStoreToTurtle, mockModifyTurtle, mockUploadTurtleToResource } = vi.hoisted(() => {
  const mockGraph = { add: vi.fn() }
  return {
    mockGraph,
    mock$rdf: {
      graph: vi.fn(() => mockGraph),
      defaultGraph: vi.fn(() => ({})),
      sym: vi.fn((uri) => ({ value: uri, termType: 'NamedNode' })),
      literal: vi.fn((val) => ({ value: val, termType: 'Literal' })),
    },
    mockNS: {
      RDF: vi.fn((name) => `http://www.w3.org/1999/02/22-rdf-syntax-ns#${name}`),
      SCHEMA: vi.fn((name) => `http://schema.org/${name}`),
    },
    // mockGetBlankNode intentionally absent — 5.2.1 fix replaced blank-node
    // subject with the resource URI. If the source ever reverts to getBlankNode,
    // the call will throw "ur.getBlankNode is not a function" and fail every test.
    mockStoreToTurtle: vi.fn(() => '<https://example.com/t/t_note_1_abcd> a <https://neo.graphmetrix.net/node/a_paragraph> .\n'),
    mockModifyTurtle: vi.fn((t) => t),
    mockUploadTurtleToResource: vi.fn(),
  }
})

vi.mock('@kaigilb/twinpod-client', () => ({
  ur: {
    $rdf: mock$rdf,
    NS: mockNS,
    // getBlankNode intentionally NOT mocked — resource URI is now the subject (5.2.1)
    storeToTurtle: (...args) => mockStoreToTurtle(...args),
    modifyTurtle: (...args) => mockModifyTurtle(...args),
    uploadTurtleToResource: (...args) => mockUploadTurtleToResource(...args),
  }
}))

import { useTwinPodNoteCreate } from './useTwinPodNoteCreate.js'

const POD = 'https://tst-first.demo.systemtwin.com'

beforeEach(() => {
  mockStoreToTurtle.mockReset()
  mockStoreToTurtle.mockReturnValue('<https://example.com/t/t_note_1_abcd> a <https://neo.graphmetrix.net/node/a_paragraph> .\n')
  mockModifyTurtle.mockReset()
  mockModifyTurtle.mockImplementation((t) => t)
  mockUploadTurtleToResource.mockReset()
  mockUploadTurtleToResource.mockResolvedValue({ ok: true, status: 201, headers: null, locationUri: null, response: null })
  mockGraph.add.mockReset()
  mock$rdf.graph.mockReset()
  mock$rdf.graph.mockReturnValue(mockGraph)
  mock$rdf.sym.mockReset()
  mock$rdf.sym.mockImplementation((uri) => ({ value: uri, termType: 'NamedNode' }))
  mock$rdf.literal.mockReset()
  mock$rdf.literal.mockImplementation((val) => ({ value: val, termType: 'Literal' }))
})

describe('useTwinPodNoteCreate — initial state', () => {
  test('noteUri starts as null', () => {
    const { noteUri } = useTwinPodNoteCreate()
    expect(noteUri.value).toBeNull()
  })
  test('pendingUri starts as null', () => {
    const { pendingUri } = useTwinPodNoteCreate()
    expect(pendingUri.value).toBeNull()
  })
  test('creating starts as false', () => {
    const { creating } = useTwinPodNoteCreate()
    expect(creating.value).toBe(false)
  })
  test('loading starts as false', () => {
    const { loading } = useTwinPodNoteCreate()
    expect(loading.value).toBe(false)
  })
  test('error starts as null', () => {
    const { error } = useTwinPodNoteCreate()
    expect(error.value).toBeNull()
  })
})

// S.OptimisticCreate / Increment 2 — URI + creating flag must be exposed
// synchronously so callers can navigate before the PUT resolves.
// Spec: 5 - Project/NoteWorld/NoteWorld.md (V.Speed_Create_Note)
// VDT:  5 - Project/NoteWorld/vdts/NoteWorld-VDT-2026-04-18.md (S.OptimisticCreate, notes 5 + 11)

describe('useTwinPodNoteCreate — optimistic synchronous exposure (S.OptimisticCreate)', () => {
  test('pendingUri is set synchronously before the PUT resolves', () => {
    // Hold the PUT open so we can observe the state between call-site and resolution.
    mockUploadTurtleToResource.mockImplementationOnce(() => new Promise(() => {}))
    const { pendingUri, createNote } = useTwinPodNoteCreate()
    createNote(POD)
    expect(pendingUri.value).toMatch(new RegExp(`^${POD}/t/t_note_\\d+_[a-z0-9]{4}$`))
  })

  test('creating flips to true synchronously', () => {
    mockUploadTurtleToResource.mockImplementationOnce(() => new Promise(() => {}))
    const { creating, createNote } = useTwinPodNoteCreate()
    createNote(POD)
    expect(creating.value).toBe(true)
  })

  test('noteUri stays null until the PUT resolves', () => {
    mockUploadTurtleToResource.mockImplementationOnce(() => new Promise(() => {}))
    const { noteUri, createNote } = useTwinPodNoteCreate()
    createNote(POD)
    expect(noteUri.value).toBeNull()
  })

  test('creating flips to false after the PUT resolves', async () => {
    const { creating, createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(creating.value).toBe(false)
  })

  test('creating flips to false after an HTTP failure too', async () => {
    mockUploadTurtleToResource.mockResolvedValueOnce({ ok: false, status: 403 })
    const { creating, createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(creating.value).toBe(false)
  })

  test('pendingUri equals the eventually-confirmed noteUri on success', async () => {
    const { pendingUri, noteUri, createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(pendingUri.value).toBe(noteUri.value)
  })

  test('pendingUri keeps the minted URI even after an HTTP failure (no rollback)', async () => {
    // HomeView navigates on pendingUri synchronously — rolling it back on failure
    // would pull the rug out from under a view the user is already on. The editor
    // surfaces the error via saveError instead.
    mockUploadTurtleToResource.mockResolvedValueOnce({ ok: false, status: 500 })
    const { pendingUri, noteUri, createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(pendingUri.value).not.toBeNull()
    expect(noteUri.value).toBeNull()
  })

  test('invalid input resolves null without flipping pendingUri/creating', async () => {
    const { pendingUri, creating, createNote } = useTwinPodNoteCreate()
    const result = await createNote('')
    expect(result).toBeNull()
    expect(pendingUri.value).toBeNull()
    expect(creating.value).toBe(false)
    expect(mockUploadTurtleToResource).not.toHaveBeenCalled()
  })
})

describe('useTwinPodNoteCreate — success', () => {
  // Spec: F.Create_Note — creates resource at {podRoot}/t/ with t_note prefix
  test('returns a resource URL under {podRoot}/t/', async () => {
    const { createNote } = useTwinPodNoteCreate()
    const url = await createNote(POD)
    expect(url).toMatch(new RegExp(`^${POD}/t/t_note_\\d+_[a-z0-9]{4}$`))
  })

  // Spec: F.Create_Note — noteUri ref reflects the created resource URL
  test('sets noteUri to the resource URL', async () => {
    const { noteUri, createNote } = useTwinPodNoteCreate()
    const url = await createNote(POD)
    expect(noteUri.value).toBe(url)
  })

  test('loading is false after success', async () => {
    const { loading, createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(loading.value).toBe(false)
  })

  test('error stays null after success', async () => {
    const { error, createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(error.value).toBeNull()
  })
})

describe('useTwinPodNoteCreate — Stack B pipeline contract', () => {
  // 5.2.1 regression guard — blank-node subject prevented TwinPod from indexing
  // new notes in search results. The resource URI must be the RDF subject.
  test('uses the resource URI as the RDF subject, not a blank node (5.2.1 regression guard)', async () => {
    const { createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    // ur.$rdf.sym is called once for the subject (resourceUrl) and once for typeUri.
    // Verify the resource URL pattern appears among the sym calls.
    const symCalls = mock$rdf.sym.mock.calls.map(c => c[0])
    expect(symCalls.some(uri => /^https:\/\/tst-first\.demo\.systemtwin\.com\/t\/t_note_\d+_[a-z0-9]{4}$/.test(uri))).toBe(true)
  })

  test('builds two triples in a temp store (rdf:type + schema:text)', async () => {
    const { createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(mock$rdf.graph).toHaveBeenCalledTimes(1)
    expect(mockGraph.add).toHaveBeenCalledTimes(2)
  })

  test('calls ur.storeToTurtle with the temp store and empty base URL', async () => {
    const { createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(mockStoreToTurtle).toHaveBeenCalledTimes(1)
    expect(mockStoreToTurtle.mock.calls[0][0]).toBe(mockGraph)
    expect(mockStoreToTurtle.mock.calls[0][1]).toBe('')
  })

  test('calls ur.modifyTurtle on the serialized output', async () => {
    const { createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(mockModifyTurtle).toHaveBeenCalledTimes(1)
    expect(mockModifyTurtle.mock.calls[0][0]).toBe(mockStoreToTurtle.mock.results[0].value)
  })

  test('PUTs via ur.uploadTurtleToResource with resource URL and method: PUT', async () => {
    const { createNote } = useTwinPodNoteCreate()
    const url = await createNote(POD)
    expect(mockUploadTurtleToResource).toHaveBeenCalledTimes(1)
    expect(mockUploadTurtleToResource.mock.calls[0][0]).toBe(url)
    expect(mockUploadTurtleToResource.mock.calls[0][2]).toEqual({ method: 'PUT', returnResponse: true })
  })

  // Spec: F.Create_Note — normalises podBaseUrl with or without trailing slash
  test('handles a pod base URL with a trailing slash', async () => {
    const { createNote } = useTwinPodNoteCreate()
    const url = await createNote(POD + '/')
    expect(url).toMatch(new RegExp(`^${POD}/t/t_note_`))
  })
})

describe('useTwinPodNoteCreate — custom typeUri', () => {
  // Spec: F.Create_Note — typeUri option overrides the default RDF type
  test('uses a custom typeUri when provided', async () => {
    const { createNote } = useTwinPodNoteCreate({ typeUri: 'https://example.com/my/Note' })
    await createNote(POD)
    expect(mock$rdf.sym).toHaveBeenCalledWith('https://example.com/my/Note')
  })

  // Spec: F.Create_Note — default RDF type is neo:a_paragraph (5.1.5 correction — schema:Note was never a valid URI)
  test('defaults typeUri to neo:a_paragraph when options are omitted', async () => {
    const { createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(mock$rdf.sym).toHaveBeenCalledWith('https://neo.graphmetrix.net/node/a_paragraph')
  })
})

describe('useTwinPodNoteCreate — input validation', () => {
  // Spec: F.Create_Note — createNote rejects falsy podBaseUrl with invalid-input error
  test('returns null when podBaseUrl is empty', async () => {
    const { createNote } = useTwinPodNoteCreate()
    const url = await createNote('')
    expect(url).toBeNull()
    expect(mockUploadTurtleToResource).not.toHaveBeenCalled()
  })

  test('sets error.type to invalid-input when podBaseUrl is empty', async () => {
    const { error, createNote } = useTwinPodNoteCreate()
    await createNote('')
    expect(error.value?.type).toBe('invalid-input')
  })

  // Spec: F.Create_Note — invalid-input must cover null/undefined podBaseUrl
  test('returns null when podBaseUrl is null', async () => {
    const { createNote } = useTwinPodNoteCreate()
    const url = await createNote(null)
    expect(url).toBeNull()
    expect(mockUploadTurtleToResource).not.toHaveBeenCalled()
  })

  // Spec: F.Create_Note — invalid-input must cover null/undefined podBaseUrl
  test('returns null when podBaseUrl is undefined', async () => {
    const { createNote } = useTwinPodNoteCreate()
    const url = await createNote(undefined)
    expect(url).toBeNull()
    expect(mockUploadTurtleToResource).not.toHaveBeenCalled()
  })
})

describe('useTwinPodNoteCreate — HTTP error', () => {
  test('returns null when ur.uploadTurtleToResource returns ok: false', async () => {
    mockUploadTurtleToResource.mockResolvedValueOnce({ ok: false, status: 403 })
    const { createNote } = useTwinPodNoteCreate()
    const url = await createNote(POD)
    expect(url).toBeNull()
  })

  test('sets error.type to http with status on failure', async () => {
    mockUploadTurtleToResource.mockResolvedValueOnce({ ok: false, status: 403 })
    const { error, createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(error.value?.type).toBe('http')
    expect(error.value?.status).toBe(403)
  })

  test('noteUri stays null after HTTP failure', async () => {
    mockUploadTurtleToResource.mockResolvedValueOnce({ ok: false, status: 500 })
    const { noteUri, createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(noteUri.value).toBeNull()
  })
})

describe('useTwinPodNoteCreate — network error', () => {
  test('sets error.type to network when ur.uploadTurtleToResource throws', async () => {
    mockUploadTurtleToResource.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { error, createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(error.value?.type).toBe('network')
    expect(error.value?.message).toBe('Failed to fetch')
  })
})

describe('useTwinPodNoteCreate — initial placeholder text', () => {
  // Neo 422s on empty literals — initial text must be ' ' (single space)
  test('schema:text is set to a non-empty placeholder (single space)', async () => {
    const { createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(mock$rdf.literal).toHaveBeenCalledWith(' ')
  })
})

describe('useTwinPodNoteCreate — stale value after failure', () => {
  // Spec: F.Create_Note — noteUri resets to null at the start of each createNote call
  test('noteUri is null after a failed create following a success', async () => {
    const { noteUri, createNote } = useTwinPodNoteCreate()
    const first = await createNote(POD)
    expect(noteUri.value).toBe(first)
    mockUploadTurtleToResource.mockResolvedValueOnce({ ok: false, status: 500 })
    await createNote(POD)
    expect(noteUri.value).toBeNull()
  })
})

describe('useTwinPodNoteCreate — ur namespace migration (no solidFetch)', () => {
  // Spec: single ur namespace — composable must accept zero required parameters (no solidFetch param)
  test('createNote works without any solidFetch parameter', async () => {
    const { createNote } = useTwinPodNoteCreate()
    const url = await createNote(POD)
    expect(url).not.toBeNull()
    expect(mockUploadTurtleToResource).toHaveBeenCalledTimes(1)
  })

  // Spec: single ur namespace — schema:text predicate must be used for the initial text triple
  test('uses ur.NS.SCHEMA("text") as the predicate for the initial text triple', async () => {
    const { createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    // The second triple uses NS.SCHEMA('text') as predicate — verify it was called
    expect(mockNS.SCHEMA).toHaveBeenCalledWith('text')
  })
})
