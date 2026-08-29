/**
 * Application-defined LLM boundary.
 *
 * Deliberately small: only the capabilities the app actually needs.
 * Providers are adapters behind this interface; business logic never
 * talks to an SDK.
 */
export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export type GenerationRequest = {
  /** Overrides the client's configured model. */
  model?: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /** Per-request timeout; falls back to the client configuration. */
  timeoutMs?: number
  /** Cooperative cancellation from the caller. */
  signal?: AbortSignal
  requestId?: string
}

export type GenerationUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type GenerationResult = {
  text: string
  provider: string
  model: string
  usage?: GenerationUsage
}

export type GenerationChunk = {
  textDelta: string
  /** Model name as reported on the first stream chunk, when available. */
  model?: string
}

export interface LlmClient {
  readonly provider: string
  generate(request: GenerationRequest): Promise<GenerationResult>
  /** Optional; used only where streaming materially improves UX. */
  stream?(request: GenerationRequest): AsyncIterable<GenerationChunk>
}
