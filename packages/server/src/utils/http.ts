import fetch, { type RequestInit, type Response } from 'node-fetch'

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number
}

/**
 * Fetch wrapper with an abort timeout so upstream latency does not block request handlers indefinitely.
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeoutMs = 8_000, signal, ...init } = options

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
