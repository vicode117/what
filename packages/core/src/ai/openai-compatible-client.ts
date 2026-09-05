import { randomUUID } from 'node:crypto'
import { AppError } from '@tt/contracts'
import type { ErrorCode } from '@tt/contracts'
import type { GenerationChunk, GenerationRequest, GenerationResult, GenerationUsage, LlmClient } from './llm-client'
import { RETRYABLE_ERROR_CODES, withRetry } from './retry'

export type OpenAiCompatibleClientOptions = {
  baseUrl: string
  /** Never logged. When null, requests are sent without an Authorization header. */
  apiKey: string | null
  model: string
  temperature?: number
  timeoutMs?: number
  maxRetries?: number
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Injectable for tests. */
  sleepImpl?: (ms: number) => Promise<void>
  /** Injectable for tests. */
  jitterImpl?: () => number
}

const DEFAULT_TIMEOUT_MS = 60_000
const RETRY_BASE_DELAY_MS = 500
const RETRY_MAX_JITTER_MS = 250
const MAX_ERROR_BODY_CHARS = 300

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function mapHttpErrorToCode(status: number): ErrorCode {
  if (status === 401 || status === 403) return 'AUTH_ERROR'
  if (status === 429) return 'RATE_LIMIT'
  return 'PROVIDER_ERROR'
}

/**
 * OpenAI-compatible chat-completions adapter.
 *
 * Bounded retry with backoff for transient failures, per-attempt timeout
 * via AbortController, cooperative cancellation, and typed errors only —
 * callers never see raw provider exceptions.
 */
export class OpenAiCompatibleClient implements LlmClient {
  readonly provider = 'openai-compatible'

  private readonly fetchImpl: typeof fetch
  private readonly sleepImpl: (ms: number) => Promise<void>
  private readonly jitterImpl: () => number

  constructor(private readonly options: OpenAiCompatibleClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.sleepImpl = options.sleepImpl ?? defaultSleep
    this.jitterImpl = options.jitterImpl ?? Math.random
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const requestId = request.requestId ?? randomUUID()
    return withRetry(() => this.attemptOnce(request, requestId), {
      maxRetries: this.options.maxRetries ?? 2,
      delayForAttempt: (attempt) =>
        RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + this.jitterImpl() * RETRY_MAX_JITTER_MS,
      sleep: this.sleepImpl,
      shouldRetry: (error) => RETRYABLE_ERROR_CODES.has(error.code),
    })
  }

  /**
   * Streaming generation (SSE, OpenAI-compatible `stream: true`).
   * Not retried — partial output cannot be replayed safely; callers get
   * the same typed errors, and the overall timeout covers the whole stream.
   */
  async *stream(request: GenerationRequest): AsyncIterable<GenerationChunk> {
    const requestId = request.requestId ?? randomUUID()
    const timeoutMs = request.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onCallerAbort = () => controller.abort()
    request.signal?.addEventListener('abort', onCallerAbort, { once: true })

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (this.options.apiKey) headers['Authorization'] = `Bearer ${this.options.apiKey}`

      const response = await this.fetchImpl(this.chatUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: request.model ?? this.options.model,
          messages: request.messages,
          temperature: request.temperature ?? this.options.temperature ?? 0.3,
          max_tokens: request.maxTokens,
          stream: true,
        }),
        signal: controller.signal,
      }).catch((error: unknown) =>
        Promise.reject(
          toRequestError(error, {
            requestId,
            timedOut,
            callerAborted: request.signal?.aborted === true,
            timeoutMs,
          }),
        ),
      )

      if (!response.ok) {
        const errorBody = (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY_CHARS)
        throw new AppError(mapHttpErrorToCode(response.status), `LLM provider returned HTTP ${response.status}`, {
          requestId,
          status: response.status,
          body: errorBody,
        })
      }
      if (!response.body) {
        throw new AppError('INVALID_RESPONSE', 'LLM provider returned an empty stream', { requestId })
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let rawSse = ''
      let rawBody = ''
      let receivedDelta = false

      // Parses one SSE line; returns the chunk to yield and whether the
      // provider signalled [DONE].
      const parseDataLine = (line: string): { done: boolean; chunk: GenerationChunk | null } => {
        const trimmed = line.trim()
        if (trimmed.length === 0 || trimmed.startsWith(':')) {
          return { done: false, chunk: null }
        }
        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') return { done: true, chunk: null }
          if (!receivedDelta) rawSse += `${data}\n`
          let parsed: unknown
          try {
            parsed = JSON.parse(data)
          } catch {
            return { done: false, chunk: null } // keep-alives or malformed fragments — skip
          }
          const delta = extractDelta(parsed)
          if (delta !== null) receivedDelta = true
          const model = readString(parsed, 'model') ?? undefined
          const chunk =
            delta !== null || model ? { textDelta: delta ?? '', ...(model ? { model } : {}) } : null
          return { done: false, chunk }
        }
        // A non-data line — typically a whole JSON body from a server
        // that ignored `stream: true`.
        if (!receivedDelta) rawBody += trimmed
        return { done: false, chunk: null }
      }

      for (;;) {
        let readResult: { done: boolean; value?: Uint8Array }
        try {
          readResult = await reader.read()
        } catch (error) {
          throw toRequestError(error, {
            requestId,
            timedOut,
            callerAborted: request.signal?.aborted === true,
            timeoutMs,
          })
        }
        if (readResult.done) break
        buffer += decoder.decode(readResult.value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        let finished = false
        for (const line of lines) {
          const { done, chunk } = parseDataLine(line)
          if (chunk) yield chunk
          if (done) {
            finished = true
            break
          }
        }
        if (finished) break
      }
      // Flush a trailing line that had no newline before the stream ended.
      if (buffer.trim().length > 0) {
        const { chunk } = parseDataLine(buffer)
        if (chunk) yield chunk
      }

      // Some OpenAI-compatible servers ignore `stream: true` and answer
      // with one plain JSON body — fall back to it instead of failing.
      if (!receivedDelta) {
        const fallback =
          extractContent(safeJsonParse(rawSse)) ?? extractContent(safeJsonParse(rawBody))
        if (fallback !== null) yield { textDelta: fallback }
      }
    } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', onCallerAbort)
    }
  }

  private chatUrl(): string {
    return `${this.options.baseUrl.replace(/\/+$/, '')}/chat/completions`
  }

  private async attemptOnce(request: GenerationRequest, requestId: string): Promise<GenerationResult> {
    const timeoutMs = request.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onCallerAbort = () => controller.abort()
    request.signal?.addEventListener('abort', onCallerAbort, { once: true })

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (this.options.apiKey) headers['Authorization'] = `Bearer ${this.options.apiKey}`

      const body = JSON.stringify({
        model: request.model ?? this.options.model,
        messages: request.messages,
        temperature: request.temperature ?? this.options.temperature ?? 0.3,
        max_tokens: request.maxTokens,
        stream: false,
      })

      let response: Response
      try {
        response = await this.fetchImpl(this.chatUrl(), {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        })
      } catch (error) {
        throw toRequestError(error, { requestId, timedOut, callerAborted: request.signal?.aborted === true, timeoutMs })
      }

      if (!response.ok) {
        const errorBody = (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY_CHARS)
        throw new AppError(mapHttpErrorToCode(response.status), `LLM provider returned HTTP ${response.status}`, {
          requestId,
          status: response.status,
          body: errorBody,
        })
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch (error) {
        if (request.signal?.aborted && !timedOut) {
          throw new AppError('CANCELLED', 'LLM request was cancelled', { requestId })
        }
        throw new AppError('INVALID_RESPONSE', 'LLM provider returned invalid JSON', {
          requestId,
          cause: error instanceof Error ? error.message : String(error),
        })
      }

      const text = extractContent(payload)
      if (text === null) {
        throw new AppError('INVALID_RESPONSE', 'LLM provider response did not contain message content', { requestId })
      }

      const model = readString(payload, 'model') ?? request.model ?? this.options.model
      return {
        text,
        provider: this.provider,
        model,
        usage: extractUsage(payload),
      }
    } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', onCallerAbort)
    }
  }
}

function toRequestError(
  error: unknown,
  context: { requestId: string; timedOut: boolean; callerAborted: boolean; timeoutMs: number },
): AppError {
  if (context.timedOut) {
    return new AppError('TIMEOUT', `LLM request timed out after ${context.timeoutMs}ms`, {
      requestId: context.requestId,
      timeoutMs: context.timeoutMs,
    })
  }
  if (context.callerAborted) {
    return new AppError('CANCELLED', 'LLM request was cancelled', { requestId: context.requestId })
  }
  return new AppError('NETWORK_ERROR', 'Failed to reach the LLM provider', {
    requestId: context.requestId,
    cause: error instanceof Error ? error.message : String(error),
  })
}

function extractContent(payload: unknown): string | null {
  const choices = (payload as { choices?: unknown } | null)?.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as { message?: unknown } | null)?.message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  if (typeof content !== 'string' || content.trim().length === 0) return null
  return content
}

function extractDelta(payload: unknown): string | null {
  const choices = (payload as { choices?: unknown } | null)?.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const delta = (choices[0] as { delta?: unknown } | null)?.delta
  if (typeof delta !== 'object' || delta === null) return null
  const content = (delta as { content?: unknown }).content
  return typeof content === 'string' && content.length > 0 ? content : null
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function extractUsage(payload: unknown): GenerationUsage | undefined {
  const usage = (payload as { usage?: unknown } | null)?.usage
  if (typeof usage !== 'object' || usage === null) return undefined
  const raw = usage as Record<string, unknown>
  const { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens } = raw
  if (typeof promptTokens !== 'number' || typeof completionTokens !== 'number' || typeof totalTokens !== 'number') {
    return undefined
  }
  return { promptTokens, completionTokens, totalTokens }
}

function readString(payload: unknown, key: string): string | null {
  const value = (payload as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}
