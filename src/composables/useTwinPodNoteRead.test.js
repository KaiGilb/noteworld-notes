import { describe, test, expect, vi, beforeEach } from 'vitest'

const { mockFetchAndSaveTurtle, mockStatementsMatching, mockRdfStoreSym, mock$rfSym } = vi.hoisted(() => ({
  mockFetchAndSaveTurtle: vi.fn(),
  mockStatementsMatching: vi.fn(),
  mockRdfStoreSym: vi.fn((val) => ({ value: val, termType: 'NamedNode' })),
  mock$rfSym: vi.fn((val) => ({ value: val, termType: 'NamedNode' })),
}))

vi.mock('@kaigilb/twinpod-client', () => ({
  ur: {
    fetchAndSaveTurtle: (...args) => mockFetchAndSaveTurtle(...args),
    rdfStore: {
      sym: (...args) => mockRdfStoreSym(...args),
      statementsMatching: (...args) => mockStatementsMatching(...args),
    },
    $rdf: {
      sym: (...args) => mock$rfSym(...args),
    },
  }
}))

import { useTwinPodNoteRead } from './useTwinPodNoteRead.js'

const POD = 'https://tst-first.demo.systemtwin.com'
const NOTE_URL = `${POD}/t/t_note_123_abcd`
const DEFAULT_PRED = 'http://schema.org/text'

function makeStatement(value) {
  return { object: { value } }
}

beforeEach(() => {
  mockFetchAndSaveTurtle.mockReset()
  mockFetchAndSaveTurtle.mockResolvedValue(undefined)
  mockStatementsMatching.mockReset()
  mockStatementsMatching.mockReturnValue([makeStatement('loaded text')])
  mockRdfStoreSym.mockReset()
  mockRdfStoreSym.mockImplementation((val) => ({ value: val, termType: 'NamedNode' }))
  mock$rfSym.mockReset()
  mock$rfSym.mockImplementation((val) => ({ value: val, termType: 'NamedNode' }))
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
  // Spec: F.Edit_Note — loads resource via ur.fetchAndSaveTurtle with force=true
  test('calls ur.fetchAndSaveTurtle with the resource URL and force=true', async () => {
    const { loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    expect(mockFetchAndSaveTurtle).toHaveBeenCalledTimes(1)
    expect(mockFetchAndSaveTurtle.mock.calls[0][0]).toBe(NOTE_URL)
    expect(mockFetchAndSaveTurtle.mock.calls[0][1]).toBe(true)
  })

  // Spec: F.Edit_Note — current text is the last statement in temporal serialisation order
  test('queries rdfStore with the predicateUri and returns the last value', async () => {
    const { loadNote } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe('loaded text')
    expect(mockStatementsMatching).toHaveBeenCalledTimes(1)
  })

  // Spec: F.Edit_Note — predicateUri option overrides the default schema:text
  test('queries rdfStore with a custom predicateUri when provided', async () => {
    const { loadNote } = useTwinPodNoteRead({ predicateUri: 'https://example.com/p' })
    await loadNote(NOTE_URL)
    expect(mock$rfSym).toHaveBeenCalledWith('https://example.com/p')
  })

  // Spec: F.Edit_Note — text ref reflects the loaded note content
  test('updates the text ref after success', async () => {
    const { text, loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    expect(text.value).toBe('loaded text')
  })

  // Spec: F.Edit_Note — returns empty string when no text predicate exists on the resource
  test('returns empty string when no statements are found', async () => {
    mockStatementsMatching.mockReturnValueOnce([])
    const { loadNote, text } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe('')
    expect(text.value).toBe('')
  })

  // Spec: F.Edit_Note — TwinPod state history: multiple values present, current is the last one
  test('returns the last value when multiple statements exist (TwinPod state history)', async () => {
    mockStatementsMatching.mockReturnValueOnce([
      makeStatement(' '),
      makeStatement('first edit'),
      makeStatement('latest edit'),
    ])
    const { loadNote } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe('latest edit')
  })
})

describe('useTwinPodNoteRead — state history edge cases', () => {
  // TwinPod never overwrites: after many edits a note carries N historical values
  // in document order. The read path must always pick the LAST value.
  // Spec: F.Edit_Note — state history: current value supersedes the creation placeholder
  test('ignores the single-space placeholder when later edits exist', async () => {
    mockStatementsMatching.mockReturnValueOnce([makeStatement(' '), makeStatement('real content')])
    const { loadNote } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe('real content')
  })

  // Spec: F.Edit_Note — fresh note returns ' ' placeholder so editor textarea shows a value
  test('returns the placeholder space when it is the only value on a fresh note', async () => {
    mockStatementsMatching.mockReturnValueOnce([makeStatement(' ')])
    const { loadNote, text } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe(' ')
    expect(text.value).toBe(' ')
  })

  test('handles a long history without throwing (10 historical values)', async () => {
    const history = Array.from({ length: 10 }, (_, i) => makeStatement(`edit ${i}`))
    mockStatementsMatching.mockReturnValueOnce(history)
    const { loadNote } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe('edit 9')
  })
})

describe('useTwinPodNoteRead — input validation', () => {
  // Spec: F.Edit_Note — loadNote rejects empty noteResourceUrl with invalid-input error
  test('returns null and sets error when noteResourceUrl is empty', async () => {
    const { error, loadNote } = useTwinPodNoteRead()
    const value = await loadNote('')
    expect(value).toBeNull()
    expect(error.value?.type).toBe('invalid-input')
    expect(mockFetchAndSaveTurtle).not.toHaveBeenCalled()
  })

  // Spec: F.Edit_Note — invalid-input must cover null noteResourceUrl
  test('returns null and sets error when noteResourceUrl is null', async () => {
    const { error, loadNote } = useTwinPodNoteRead()
    const value = await loadNote(null)
    expect(value).toBeNull()
    expect(error.value?.type).toBe('invalid-input')
    expect(mockFetchAndSaveTurtle).not.toHaveBeenCalled()
  })
})

describe('useTwinPodNoteRead — not found', () => {
  test('sets error.type to not-found on 404 from fetchAndSaveTurtle', async () => {
    const err = new Error('Not Found')
    err.statusCode = 404
    mockFetchAndSaveTurtle.mockRejectedValueOnce(err)
    const { error, loadNote } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBeNull()
    expect(error.value?.type).toBe('not-found')
  })
})

describe('useTwinPodNoteRead — HTTP error', () => {
  test('sets error.type to http on rejection with a non-404 statusCode', async () => {
    const err = new Error('Forbidden')
    err.statusCode = 403
    mockFetchAndSaveTurtle.mockRejectedValueOnce(err)
    const { error, loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    expect(error.value?.type).toBe('http')
    expect(error.value?.status).toBe(403)
  })

  test('sets error.type to network on rejection without statusCode', async () => {
    mockFetchAndSaveTurtle.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { error, loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    expect(error.value?.type).toBe('network')
  })

  test('loading is false after error', async () => {
    mockFetchAndSaveTurtle.mockRejectedValueOnce(new Error('boom'))
    const { loading, loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    expect(loading.value).toBe(false)
  })
})

describe('useTwinPodNoteRead — ur namespace migration (no solidFetch)', () => {
  // Spec: single ur namespace — composable must accept zero required parameters (no solidFetch param)
  test('loadNote works without any solidFetch parameter', async () => {
    const { loadNote } = useTwinPodNoteRead()
    const value = await loadNote(NOTE_URL)
    expect(value).toBe('loaded text')
    expect(mockFetchAndSaveTurtle).toHaveBeenCalledTimes(1)
  })

  // Spec: ur namespace migration — document graph scoped query via ur.rdfStore.sym
  test('calls ur.rdfStore.sym with the noteResourceUrl to scope the query to the document graph', async () => {
    const { loadNote } = useTwinPodNoteRead()
    await loadNote(NOTE_URL)
    expect(mockRdfStoreSym).toHaveBeenCalledWith(NOTE_URL)
  })

  // Spec: ur namespace migration — loading transition during fetch
  test('loading is true while ur.fetchAndSaveTurtle is in progress', async () => {
    let resolveFetch
    mockFetchAndSaveTurtle.mockImplementation(() => new Promise(r => { resolveFetch = r }))
    const { loading, loadNote } = useTwinPodNoteRead()
    const promise = loadNote(NOTE_URL)
    expect(loading.value).toBe(true)
    resolveFetch()
    await promise
    expect(loading.value).toBe(false)
  })
})
