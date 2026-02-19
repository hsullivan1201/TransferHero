import type { Request, Response, NextFunction } from 'express'

interface RateLimitOptions {
  windowMs: number
  max: number
  scope: string
}

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']

  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim()
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(',')[0].trim()
  }

  return req.ip || req.socket.remoteAddress || 'unknown'
}

function cleanupBuckets(): void {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key)
    }
  }
}

const cleanupTimer = setInterval(cleanupBuckets, 60_000)
cleanupTimer.unref?.()

function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, scope } = options

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now()
    const key = `${scope}:${getClientIp(req)}`

    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(key, bucket)
    }

    bucket.count += 1

    const remaining = Math.max(0, max - bucket.count)
    res.setHeader('X-RateLimit-Limit', String(max))
    res.setHeader('X-RateLimit-Remaining', String(remaining))
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)))

    if (bucket.count > max) {
      res.status(429).json({
        error: 'Too many requests. Please try again shortly.'
      })
      return
    }

    next()
  }
}

export const apiRateLimit = createRateLimiter({
  scope: 'api',
  windowMs: 60_000,
  max: 600
})

export const tripRateLimit = createRateLimiter({
  scope: 'trip',
  windowMs: 60_000,
  max: 120
})

export const destinationSearchRateLimit = createRateLimiter({
  scope: 'destination-search',
  windowMs: 60_000,
  max: 60
})

export const destinationResolveRateLimit = createRateLimiter({
  scope: 'destination-resolve',
  windowMs: 60_000,
  max: 120
})

export const busTripsRateLimit = createRateLimiter({
  scope: 'bus-trips',
  windowMs: 60_000,
  max: 120
})

export const busPredictionsRateLimit = createRateLimiter({
  scope: 'bus-predictions',
  windowMs: 60_000,
  max: 120
})

export const busWalkRateLimit = createRateLimiter({
  scope: 'bus-walk',
  windowMs: 60_000,
  max: 60
})
