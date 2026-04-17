// PENDING: F.NoteWorld.LinkNote — waiting for implementation in a future increment

import { describe, test, expect, vi } from 'vitest'
import * as packageExports from '../../src/index.js'

// Spec: F.NoteWorld.LinkNote — The user selects a subject note, chooses a predicate,
// and searches for an object in the TwinPod, creating an RDF triple: (Note, Predicate, Object).
// Success-Criteria: An RDF triple (Note, Predicate, Object) is committed to the TwinPod
// and the link is visible in the note's linked objects view.
//
// Spec: F.NoteWorld.LinkNote.SelectPredicate — user selects from favorites or searches TwinPod predicates
// Spec: F.NoteWorld.LinkNote.SearchObject — user searches all TwinPod objects (min 1 char)
// Spec: F.NoteWorld.LinkNote.CommitTriple — writes RDF triple atomically to TwinPod
//
// All tests in this file will FAIL until useTwinPodLinkNote is implemented and exported.

const NOTE_URI = 'https://tst-first.demo.systemtwin.com/node/t_subject'
const PREDICATE_URI = 'https://neo.graphmetrix.net/node/p_relatedTo'
const OBJECT_URI = 'https://tst-first.demo.systemtwin.com/node/t_object1'

const MOCK_PREDICATE_TURTLE = `
@prefix neo: <https://neo.graphmetrix.net/node/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<${PREDICATE_URI}> rdfs:label "related to" .
`

const MOCK_OBJECT_TURTLE = `
@prefix neo: <https://neo.graphmetrix.net/node/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<${OBJECT_URI}> rdfs:label "Object One" .
`

describe('useTwinPodLinkNote', () => {

  // Spec: F.NoteWorld.LinkNote — composable must exist and be exported from the package
  test('useTwinPodLinkNote is exported from the package', () => {
    expect(typeof packageExports.useTwinPodLinkNote).toBe('function')
  })

  // Spec: F.NoteWorld.LinkNote — must expose searchPredicates, searchObjects, commitTriple
  test('exposes searchPredicates, searchObjects, and commitTriple functions', () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn()
    const { searchPredicates, searchObjects, commitTriple } = useTwinPodLinkNote(hyperFetch)
    expect(typeof searchPredicates).toBe('function')
    expect(typeof searchObjects).toBe('function')
    expect(typeof commitTriple).toBe('function')
  })

  // Spec: F.NoteWorld.LinkNote — must expose reactive predicateResults, objectResults, loading, error
  test('exposes reactive predicateResults, objectResults, loading, and error state', () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn()
    const { predicateResults, objectResults, loading, error } = useTwinPodLinkNote(hyperFetch)
    expect(Array.isArray(predicateResults.value)).toBe(true)
    expect(Array.isArray(objectResults.value)).toBe(true)
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  // --- F.NoteWorld.LinkNote.SelectPredicate ---

  // Spec: F.NoteWorld.LinkNote.SelectPredicate — must search TwinPod predicates
  test('searchPredicates calls the TwinPod search API', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => MOCK_PREDICATE_TURTLE
    })
    const { searchPredicates } = useTwinPodLinkNote(hyperFetch)
    await searchPredicates('related')
    expect(hyperFetch).toHaveBeenCalledOnce()
  })

  // Spec: F.NoteWorld.LinkNote.SelectPredicate — results must include valid RDF predicate URIs
  test('searchPredicates returns predicate URIs in results', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => MOCK_PREDICATE_TURTLE
    })
    const { searchPredicates, predicateResults } = useTwinPodLinkNote(hyperFetch)
    await searchPredicates('related')
    expect(predicateResults.value.length).toBeGreaterThan(0)
    expect(predicateResults.value[0].uri).toBeTruthy()
  })

  // Spec: F.NoteWorld.LinkNote.SelectPredicate Constraint — free-text predicates not accepted
  test('all predicate results have a valid HTTP URI (no free-text predicates)', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => MOCK_PREDICATE_TURTLE
    })
    const { searchPredicates, predicateResults } = useTwinPodLinkNote(hyperFetch)
    await searchPredicates('related')
    predicateResults.value.forEach(p => {
      expect(p.uri).toMatch(/^https?:\/\//)
    })
  })

  // Spec: V.NoteWorld.LinkNote.PredicateSearchSpeed — Tolerable: 1.0s, Goal: 0.3s
  // Tests composable overhead only — TwinPod network latency is excluded (mock fetch).
  test('searchPredicates composable overhead is under 50ms (mock fetch)', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => MOCK_PREDICATE_TURTLE
    })
    const { searchPredicates } = useTwinPodLinkNote(hyperFetch)
    const start = Date.now()
    await searchPredicates('related')
    expect(Date.now() - start).toBeLessThan(50)
  })

  // --- F.NoteWorld.LinkNote.SearchObject ---

  // Spec: F.NoteWorld.LinkNote.SearchObject — must search across all objects in TwinPod
  test('searchObjects calls the TwinPod search API', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => MOCK_OBJECT_TURTLE
    })
    const { searchObjects } = useTwinPodLinkNote(hyperFetch)
    await searchObjects('Object')
    expect(hyperFetch).toHaveBeenCalledOnce()
  })

  // Spec: F.NoteWorld.LinkNote.SearchObject Input — minimum 1 character required
  test('searchObjects sets invalid-input error when query is empty string', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn()
    const { searchObjects, error } = useTwinPodLinkNote(hyperFetch)
    await searchObjects('')
    expect(error.value).toMatchObject({ type: 'invalid-input' })
    expect(hyperFetch).not.toHaveBeenCalled()
  })

  // Spec: F.NoteWorld.LinkNote.SearchObject — results must include both label and URI
  test('searchObjects returns results with uri and label', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => MOCK_OBJECT_TURTLE
    })
    const { searchObjects, objectResults } = useTwinPodLinkNote(hyperFetch)
    await searchObjects('Object')
    expect(objectResults.value.length).toBeGreaterThan(0)
    expect(objectResults.value[0].uri).toBeTruthy()
    expect(objectResults.value[0].label).toBeTruthy()
  })

  // Spec: F.NoteWorld.LinkNote.SearchObject Constraint — free-text objects not accepted
  test('all object results have a valid HTTP URI (no free-text objects)', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => MOCK_OBJECT_TURTLE
    })
    const { searchObjects, objectResults } = useTwinPodLinkNote(hyperFetch)
    await searchObjects('Object')
    objectResults.value.forEach(o => {
      expect(o.uri).toMatch(/^https?:\/\//)
    })
  })

  // Spec: V.NoteWorld.LinkNote.ObjectSearchSpeed — Tolerable: 2.0s, Goal: 0.5s
  // Tests composable overhead only — TwinPod network latency is excluded (mock fetch).
  test('searchObjects composable overhead is under 50ms (mock fetch)', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => MOCK_OBJECT_TURTLE
    })
    const { searchObjects } = useTwinPodLinkNote(hyperFetch)
    const start = Date.now()
    await searchObjects('Object')
    expect(Date.now() - start).toBeLessThan(50)
  })

  // --- F.NoteWorld.LinkNote.CommitTriple ---

  // Spec: F.NoteWorld.LinkNote.CommitTriple — must write the triple to TwinPod
  test('commitTriple sends a write request (POST/PUT/PATCH) to TwinPod', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const { commitTriple } = useTwinPodLinkNote(hyperFetch)
    await commitTriple(NOTE_URI, PREDICATE_URI, OBJECT_URI)
    expect(hyperFetch).toHaveBeenCalledOnce()
    const [, init] = hyperFetch.mock.calls[0]
    expect(['POST', 'PUT', 'PATCH']).toContain(init.method?.toUpperCase())
  })

  // Spec: F.NoteWorld.LinkNote.CommitTriple — must send Content-Type: text/turtle
  test('commitTriple sends Content-Type: text/turtle', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const { commitTriple } = useTwinPodLinkNote(hyperFetch)
    await commitTriple(NOTE_URI, PREDICATE_URI, OBJECT_URI)
    const [, init] = hyperFetch.mock.calls[0]
    expect(init.headers['Content-Type']).toBe('text/turtle')
  })

  // Spec: F.NoteWorld.LinkNote.CommitTriple — Turtle body must encode all three triple components
  test('commitTriple body contains subject, predicate, and object URIs', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const { commitTriple } = useTwinPodLinkNote(hyperFetch)
    await commitTriple(NOTE_URI, PREDICATE_URI, OBJECT_URI)
    const [, init] = hyperFetch.mock.calls[0]
    expect(init.body).toContain(NOTE_URI)
    expect(init.body).toContain(PREDICATE_URI)
    expect(init.body).toContain(OBJECT_URI)
  })

  // Spec: F.NoteWorld.LinkNote.CommitTriple Constraint — commit disabled until all inputs resolved
  test('commitTriple sets invalid-input error when subject is null', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn()
    const { commitTriple, error } = useTwinPodLinkNote(hyperFetch)
    await commitTriple(null, PREDICATE_URI, OBJECT_URI)
    expect(error.value).toMatchObject({ type: 'invalid-input' })
    expect(hyperFetch).not.toHaveBeenCalled()
  })

  // Spec: F.NoteWorld.LinkNote.CommitTriple Constraint — predicate must be confirmed first
  test('commitTriple sets invalid-input error when predicate is null', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn()
    const { commitTriple, error } = useTwinPodLinkNote(hyperFetch)
    await commitTriple(NOTE_URI, null, OBJECT_URI)
    expect(error.value).toMatchObject({ type: 'invalid-input' })
    expect(hyperFetch).not.toHaveBeenCalled()
  })

  // Spec: F.NoteWorld.LinkNote.CommitTriple Constraint — object must be confirmed first
  test('commitTriple sets invalid-input error when object is null', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn()
    const { commitTriple, error } = useTwinPodLinkNote(hyperFetch)
    await commitTriple(NOTE_URI, PREDICATE_URI, null)
    expect(error.value).toMatchObject({ type: 'invalid-input' })
    expect(hyperFetch).not.toHaveBeenCalled()
  })

  // Spec: F.NoteWorld.LinkNote.CommitTriple Behavior — on success, returns true
  test('commitTriple returns true on success', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const { commitTriple } = useTwinPodLinkNote(hyperFetch)
    const result = await commitTriple(NOTE_URI, PREDICATE_URI, OBJECT_URI)
    expect(result).toBe(true)
  })

  // Spec: F.NoteWorld.LinkNote.CommitTriple Behavior — on failure: user shown reason; no partial write
  test('commitTriple sets error on TwinPod HTTP failure', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({ ok: false, status: 403 })
    const { commitTriple, error } = useTwinPodLinkNote(hyperFetch)
    await commitTriple(NOTE_URI, PREDICATE_URI, OBJECT_URI)
    expect(error.value).toMatchObject({ type: 'http', status: 403 })
  })

  // Spec: F.NoteWorld.LinkNote.CommitTriple — returns falsy on failure (atomic — no partial write)
  test('commitTriple returns null or false on failure', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const { commitTriple } = useTwinPodLinkNote(hyperFetch)
    const result = await commitTriple(NOTE_URI, PREDICATE_URI, OBJECT_URI)
    expect(result).toBeFalsy()
  })

  // Spec: F.NoteWorld.LinkNote.CommitTriple — network failure must be exposed, not swallowed
  test('commitTriple sets error on network failure', async () => {
    const { useTwinPodLinkNote } = packageExports
    expect(typeof useTwinPodLinkNote).toBe('function')
    const hyperFetch = vi.fn().mockRejectedValue(new Error('Network failure'))
    const { commitTriple, error } = useTwinPodLinkNote(hyperFetch)
    await commitTriple(NOTE_URI, PREDICATE_URI, OBJECT_URI)
    expect(error.value).toMatchObject({ type: 'network' })
  })

})
