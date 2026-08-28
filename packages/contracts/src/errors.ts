/**
 * Application-wide error taxonomy.
 *
 * These codes cross the IPC boundary, so the renderer can react to
 * provider failures without ever inspecting provider-specific
 * exception strings or stack traces.
 */
import { ZodError } from 'zod'

export const ERROR_CODES = [
  'TIMEOUT',
  'RATE_LIMIT',
  'AUTH_ERROR',
  'NETWORK_ERROR',
  'INVALID_RESPONSE',
  'PROVIDER_ERROR',
  'CANCELLED',
  'VALIDATION_ERROR',
  'STORAGE_ERROR',
  'CONFIG_ERROR',
  'PROMPT_ERROR',
  'INTERNAL_ERROR',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** Serializable error shape used over IPC. */
export type ErrorPayload = {
  code: ErrorCode
  message: string
  details?: unknown
}

/** Error class used inside Main / Core. Never sent raw over IPC. */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }

  toPayload(): ErrorPayload {
    return { code: this.code, message: this.message, details: this.details }
  }

  static fromPayload(payload: ErrorPayload): AppError {
    return new AppError(payload.code, payload.message, payload.details)
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

/**
 * Normalizes any thrown value into a serializable ErrorPayload.
 * Zod validation failures become VALIDATION_ERROR with issue details.
 */
export function errorToPayload(error: unknown): ErrorPayload {
  if (error instanceof AppError) return error.toPayload()
  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'Invalid input',
      details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    }
  }
  return { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unexpected error' }
}
