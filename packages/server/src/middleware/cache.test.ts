import assert from 'node:assert/strict'
import { normalizeCacheUrl } from './cache.js'

function normalizesQueryOrder() {
  const a = normalizeCacheUrl('/api/trips?to=B01&from=A01&walkTime=3')
  const b = normalizeCacheUrl('/api/trips?from=A01&walkTime=3&to=B01')
  assert.equal(a, b)
  assert.equal(a, '/api/trips?from=A01&to=B01&walkTime=3')
  console.log('✓ normalizes query parameter ordering for stable cache keys')
}

function preservesDuplicateKeysDeterministically() {
  const normalized = normalizeCacheUrl('/api/example?line=RD&line=BL&line=RD')
  assert.equal(normalized, '/api/example?line=BL&line=RD&line=RD')
  console.log('✓ preserves duplicate params while normalizing cache key order')
}

function leavesPathOnlyUrlsUntouched() {
  const normalized = normalizeCacheUrl('/api/stations')
  assert.equal(normalized, '/api/stations')
  console.log('✓ leaves path-only URLs unchanged')
}

normalizesQueryOrder()
preservesDuplicateKeysDeterministically()
leavesPathOnlyUrlsUntouched()

console.log('cache middleware tests passed')
