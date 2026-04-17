import { describe, test, expect, vi, beforeEach } from 'vitest'

const { mockGraph, mock$rdf, mockNS, mockGetBlankNode, mockStoreToTurtle, mockModifyTurtle, mockUploadTurtleToResource } = vi.hoisted(() => {
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
    mockGetBlankNode: vi.fn(() => ({ node: { value: '_:t1' }, existed: false })),
    mockStoreToTurtle: vi.fn(() => '_:t1 a <http://schema.org/Note> .\n'),
    mockModifyTurtle: vi.fn((t) => t),
    mockUploadTurtleToResource: vi.fn(),
  }
})

vi.mock('@kaigilb/twinpod-client', () => ({
  ur: {
    $rdf: mock$rdf,
    NS: mockNS,
    getBlankNode: (...args) => mockGetBlankNode(...args),
    storeToTurtle: (...args) => mockStoreToTurtle(...args),
    modifyTurtle: (...args) => mockModifyTurtle(...args),
    uploadTurtleToResource: (...args) => mockUploadTurtleToResource(...args),
  }
}))

import { useTwinPodNoteCreate } from './useTwinPodNoteCreate.js'

const POD = 'https://tst-first.demo.systemtwin.com'

beforeEach(() => {
  mockGetBlankNode.mockReset()
  mockGetBlankNode.mockReturnValue({ node: { value: '_:t1' }, existed: false })
  mockStoreToTurtle.mockReset()
  mockStoreToTurtle.mockReturnValue('_:t1 a <http://schema.org/Note> .\n')
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
  test('loading starts as false', () => {
    const { loading } = useTwinPodNoteCreate()
    expect(loading.value).toBe(false)
  })
  test('error starts as null', () => {
    const { error } = useTwinPodNoteCreate()
    expect(error.value).toBeNull()
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
  test('calls ur.getBlankNode with a label containing the resource ID', async () => {
    const { createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(mockGetBlankNode).toHaveBeenCalledTimes(1)
    expect(mockGetBlankNode.mock.calls[0][0]).toMatch(/^Note: t_note_\d+_[a-z0-9]{4}$/)
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

  // Spec: F.Create_Note — default RDF type is http://schema.org/Note
  test('defaults typeUri to schema:Note when options are omitted', async () => {
    const { createNote } = useTwinPodNoteCreate()
    await createNote(POD)
    expect(mock$rdf.sym).toHaveBeenCalledWith('http://schema.org/Note')
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
