import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  closeShareLinkStoreForTests,
  findStoredShareToken,
  SHORT_SHARE_CODE_PATTERN,
  storeShareToken,
} from './shareLinkStore.js'

const originalDatabasePath = process.env.SHARE_LINK_DB_PATH
const originalVolumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH
const originalNodeEnv = process.env.NODE_ENV
const originalLocalShareSmoke = process.env.LOCAL_SHARE_SMOKE
const testDirectory = mkdtempSync(path.join(tmpdir(), 'transferhero-share-links-'))
const databasePath = path.join(testDirectory, 'nested', 'share-links.sqlite')
const signedToken = `payload.${'a'.repeat(43)}`

try {
  process.env.SHARE_LINK_DB_PATH = databasePath
  delete process.env.RAILWAY_VOLUME_MOUNT_PATH
  process.env.NODE_ENV = 'test'

  const firstCode = storeShareToken(signedToken)
  assert.ok(firstCode)
  assert.match(firstCode, SHORT_SHARE_CODE_PATTERN)
  assert.equal(firstCode.length, 16)
  assert.equal(findStoredShareToken(firstCode), signedToken)
  assert.equal(findStoredShareToken('not-a-short-code'), null)

  const secondCode = storeShareToken(signedToken)
  assert.ok(secondCode)
  assert.notEqual(secondCode, firstCode)

  closeShareLinkStoreForTests()
  assert.equal(findStoredShareToken(firstCode), signedToken, 'stored links should survive a database reopen')

  closeShareLinkStoreForTests()
  process.env.SHARE_LINK_DB_PATH = ':memory:'
  process.env.NODE_ENV = 'production'
  delete process.env.LOCAL_SHARE_SMOKE
  assert.throws(
    () => storeShareToken(signedToken),
    /not durable in production/u,
    'production must not issue short links from an in-memory store'
  )

  closeShareLinkStoreForTests()
  delete process.env.SHARE_LINK_DB_PATH
  const railwayVolume = path.join(testDirectory, 'railway-volume')
  process.env.RAILWAY_VOLUME_MOUNT_PATH = railwayVolume
  const volumeCode = storeShareToken(signedToken)
  assert.ok(volumeCode)
  assert.equal(findStoredShareToken(volumeCode), signedToken)
  closeShareLinkStoreForTests()
  assert.ok(existsSync(path.join(railwayVolume, 'transferhero-share-links.sqlite')))

  delete process.env.RAILWAY_VOLUME_MOUNT_PATH
  process.env.NODE_ENV = 'production'
  assert.equal(storeShareToken(signedToken), null, 'production should fall back when no volume is configured')
  assert.throws(
    () => findStoredShareToken(firstCode),
    /Short share storage is not configured/u,
    'existing short links should report storage outages instead of appearing missing'
  )

  console.log('share link store tests passed')
} finally {
  closeShareLinkStoreForTests()
  if (originalDatabasePath == null) delete process.env.SHARE_LINK_DB_PATH
  else process.env.SHARE_LINK_DB_PATH = originalDatabasePath
  if (originalVolumeMount == null) delete process.env.RAILWAY_VOLUME_MOUNT_PATH
  else process.env.RAILWAY_VOLUME_MOUNT_PATH = originalVolumeMount
  if (originalNodeEnv == null) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  if (originalLocalShareSmoke == null) delete process.env.LOCAL_SHARE_SMOKE
  else process.env.LOCAL_SHARE_SMOKE = originalLocalShareSmoke
  rmSync(testDirectory, { recursive: true, force: true })
}
