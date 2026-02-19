import fetch, { type RequestInit, type Response } from 'node-fetch'
import { Agent as HttpAgent } from 'http'
import { Agent as HttpsAgent } from 'https'

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number
}

const httpAgent = new HttpAgent({
  keepAlive: true,
  maxSockets: 128,
  maxFreeSockets: 16,
  timeout: 30_000
})

const httpsAgent = new HttpsAgent({
  keepAlive: true,
  maxSockets: 128,
  maxFreeSockets: 16,
  timeout: 30_000
})

/**
 * Fetch wrapper with an abort timeout so upstream latency does not block request handlers indefinitely.
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeoutMs = 8_000, signal, agent, ...init } = options

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let detachAbortListener: (() => void) | undefined

  if (signal) {
    if (signal.aborted) {
      controller.abort()
    } else {
      const onAbort = () => controller.abort()
      signal.addEventListener('abort', onAbort)
      detachAbortListener = () => signal.removeEventListener('abort', onAbort)
    }
  }

  try {
    return await fetch(url, {
      ...init,
      agent: agent ?? (url.startsWith('https:') ? httpsAgent : httpAgent),
      signal: controller.signal
    })
  } catch (err) {
    if (controller.signal.aborted && !(signal?.aborted)) {
      throw new Error(`Request timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
    detachAbortListener?.()
  }
}
