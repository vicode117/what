import { AppError } from '@tt/contracts'
import type { ErrorCode } from '@tt/contracts'

/** Error codes worth another attempt. AUTH_ERROR / INVALID_RESPONSE / TIMEOUT are not. */
export const RETRYABLE_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'NETWORK_ERROR',
  'RATE_LIMIT',
  'PROVIDER_ERROR',
])

export type RetryOptions = {
  /** Number of ADDITIONAL attempts after the first one. */
  maxRetries: number
  delayForAttempt: (attempt: number) => number
  sleep: (ms: number) => Promise<void>
  shouldRetry: (error: AppError) => boolean
  onRetry?: (error: AppError, attempt: number) => void
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (error) {
      if (!(error instanceof AppError)) throw error
      attempt += 1
      if (attempt > options.maxRetries || !options.shouldRetry(error)) throw error
      options.onRetry?.(error, attempt)
      await options.sleep(options.delayForAttempt(attempt))
    }
  }
}
