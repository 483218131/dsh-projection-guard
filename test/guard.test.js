import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeCheckpoint, hasUsableTitle } from '../lib/index.js'

test('sanitizeCheckpoint keeps healthy rows and drops Map rows', () => {
  const rows = {
    title: { ver: 1, seq: 10, val: '修复会话标题' },
    sessionListMetadata: { ver: 1, seq: 10, val: { blank: false, lastPromptAt: 123 } },
    liveTokenUsage: { ver: 1, seq: 10, val: { surface: new Map([[1, 42]]), surfaceTokens: 42, settled: {}, last: null, active: null } },
  }
  const { rows: safe, dropped } = sanitizeCheckpoint(rows)
  assert.deepEqual(dropped, ['liveTokenUsage'])
  assert.ok(safe.title)
  assert.ok(safe.sessionListMetadata)
  assert.equal(safe.liveTokenUsage, undefined)
})

test('sanitizeCheckpoint keeps a plain-object liveTokenUsage row', () => {
  const rows = {
    title: { ver: 1, seq: 10, val: 'x' },
    liveTokenUsage: { ver: 1, seq: 10, val: { surface: { 1: 42 }, surfaceTokens: 42, settled: {}, last: null, active: null } },
  }
  const { rows: safe, dropped } = sanitizeCheckpoint(rows)
  assert.deepEqual(dropped, [])
  assert.ok(safe.liveTokenUsage)
})

test('sanitizeCheckpoint throws when nothing survives', () => {
  const rows = {
    bad: { ver: 1, seq: 1, val: new Set([1]) },
  }
  assert.throws(() => sanitizeCheckpoint(rows), /not losslessly JSON-serializable/)
})

test('sanitizeCheckpoint rejects cyclic references', () => {
  const cyclic = {}
  cyclic.self = cyclic
  const rows = { title: { ver: 1, seq: 1, val: 'ok' }, cyc: { ver: 1, seq: 1, val: cyclic } }
  const { rows: safe, dropped } = sanitizeCheckpoint(rows)
  assert.deepEqual(dropped, ['cyc'])
  assert.ok(safe.title)
})

test('sanitizeCheckpoint rejects non-finite numbers', () => {
  const rows = { title: { ver: 1, seq: 1, val: 'ok' }, nan: { ver: 1, seq: 1, val: { n: NaN } } }
  const { rows: safe, dropped } = sanitizeCheckpoint(rows)
  assert.deepEqual(dropped, ['nan'])
  assert.ok(safe.title)
})

test('hasUsableTitle detects a real title and rejects blank/absent', () => {
  assert.equal(hasUsableTitle({ values: { title: 'abc' } }), true)
  assert.equal(hasUsableTitle({ values: { title: '' } }), false)
  assert.equal(hasUsableTitle({ values: { title: null } }), false)
  assert.equal(hasUsableTitle({ values: {} }), false)
  assert.equal(hasUsableTitle(undefined), false)
})
