import { createHmac, timingSafeEqual } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { parseSharedTripPayload, type SharedTripPayload } from '@transferhero/shared'

const TOKEN_PATTERN = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/u
const MAX_TOKEN_LENGTH = 8_192
const MAX_COMPRESSED_BYTES = 6_144
const MAX_DECOMPRESSED_BYTES = 16_384
const DEVELOPMENT_SECRET = 'transferhero-development-share-secret-change-before-production'

export function getShareTokenSecret(): string {
  const configured = process.env.SHARE_TOKEN_SECRET?.trim()
  if (configured && configured.length >= 32) return configured
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SHARE_TOKEN_SECRET must be at least 32 characters in production')
  }
  return DEVELOPMENT_SECRET
}

function signatureFor(compressed: Buffer, secret: string): Buffer {
  return createHmac('sha256', secret).update(compressed).digest()
}

export function createShareToken(
  trip: SharedTripPayload,
  secret = getShareTokenSecret()
): string {
  const normalized = parseSharedTripPayload(trip)
  if (!normalized) throw new Error('Cannot create a token from an invalid shared trip')
  const source = Buffer.from(JSON.stringify(normalized), 'utf8')
  if (source.byteLength > MAX_DECOMPRESSED_BYTES) throw new Error('Shared trip is too large')
  const compressed = deflateRawSync(source, { level: 9 })
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) throw new Error('Compressed shared trip is too large')
  const signature = signatureFor(compressed, secret)
  return `${compressed.toString('base64url')}.${signature.toString('base64url')}`
}

export function decodeShareToken(
  token: string,
  secret = getShareTokenSecret()
): SharedTripPayload | null {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null
  const match = TOKEN_PATTERN.exec(token)
  if (!match) return null

  try {
    const compressed = Buffer.from(match[1], 'base64url')
    const suppliedSignature = Buffer.from(match[2], 'base64url')
    if (compressed.byteLength === 0 || compressed.byteLength > MAX_COMPRESSED_BYTES) return null
    if (suppliedSignature.byteLength !== 32) return null
    if (compressed.toString('base64url') !== match[1]) return null
    if (suppliedSignature.toString('base64url') !== match[2]) return null

    const expectedSignature = signatureFor(compressed, secret)
    if (!timingSafeEqual(suppliedSignature, expectedSignature)) return null

    const inflated = inflateRawSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_BYTES })
    if (inflated.byteLength > MAX_DECOMPRESSED_BYTES) return null
    const parsed: unknown = JSON.parse(inflated.toString('utf8'))
    return parseSharedTripPayload(parsed)
  } catch {
    return null
  }
}
