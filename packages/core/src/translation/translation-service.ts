import { AppError } from '@tt/contracts'
import type { ErrorCode, TranslateRequest, TranslateResult } from '@tt/contracts'
import { AUTO_DETECT, languageLabel } from '@tt/contracts'
import type { GenerationResult, LlmClient } from '../ai/llm-client'
import type { PromptManager } from '../prompts/prompt-manager'
import type { ContextRetriever } from './context-retriever'

/** One configured provider, ready to use. Ordered by priority. */
export type ProviderRuntime = {
  id: string
  label: string
  /** Ordered models — attempts run provider-major, model-minor. */
  models: string[]
  client: LlmClient
}

/**
 * Errors worth falling through to the next provider/model for. Request-side
 * problems (validation, missing prompts) are not — they would fail on
 * every provider equally.
 */
export const FAILOVER_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'TIMEOUT',
  'RATE_LIMIT',
  'AUTH_ERROR',
  'NETWORK_ERROR',
  'INVALID_RESPONSE',
  'PROVIDER_ERROR',
])

type Attempt = { provider: ProviderRuntime; model: string }

function attemptOrder(providers: ProviderRuntime[]): Attempt[] {
  return providers.flatMap((provider) => provider.models.map((model) => ({ provider, model })))
}

function isFailoverable(error: unknown): boolean {
  return error instanceof AppError && FAILOVER_ERROR_CODES.has(error.code)
}

function wrapAllProvidersFailed(lastError: unknown, attempts: Attempt[]): AppError {
  const last = lastError instanceof AppError ? lastError : undefined
  const trail = attempts.map((attempt) => `${attempt.provider.label}/${attempt.model}`)
  if (last) {
    return new AppError(
      last.code,
      `All ${attempts.length} provider/model combo(s) failed — last error (${last.code}): ${last.message}`,
      { attempts: trail },
    )
  }
  return new AppError('CONFIG_ERROR', 'No AI provider/model was attempted', { attempts: trail })
}

/**
 * Builds the translation prompt from version-controlled Markdown
 * templates — enriched with translation-memory context when a
 * retriever is provided — and runs generation through the configured
 * provider×model combos in priority order: the first success wins;
 * retryable failures switch to the next combo immediately.
 */
export class TranslationService {
  constructor(
    private readonly prompts: PromptManager,
    private readonly retriever?: ContextRetriever,
  ) {}

  async translate(request: TranslateRequest, providers: ProviderRuntime[]): Promise<TranslateResult> {
    const startedAt = Date.now()
    const systemPrompt = await this.buildPrompt(request)
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: request.text },
    ]
    const attempts = attemptOrder(providers)
    if (attempts.length === 0) {
      throw new AppError('CONFIG_ERROR', 'No AI provider/model configured')
    }

    let lastError: unknown
    for (const { provider, model } of attempts) {
      try {
        const result: GenerationResult = await provider.client.generate({ messages, model })
        return {
          translatedText: result.text.trim(),
          provider: provider.label,
          providerId: provider.id,
          model: result.model,
          usage: result.usage,
          durationMs: Date.now() - startedAt,
        }
      } catch (error) {
        lastError = error
        if (!isFailoverable(error)) throw error
      }
    }
    throw wrapAllProvidersFailed(lastError, attempts)
  }

  /**
   * Streaming variant: forwards deltas while generating and resolves
   * with the final (trimmed) result.
   *
   * Failover only happens BEFORE the first delta has been shown — once
   * partial text is on screen, a provider switch would duplicate or
   * garble it, so later errors surface as-is.
   */
  async translateStream(
    request: TranslateRequest,
    providers: ProviderRuntime[],
    onDelta?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<TranslateResult> {
    const startedAt = Date.now()
    const systemPrompt = await this.buildPrompt(request)
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: request.text },
    ]
    const attempts = attemptOrder(providers)
    if (attempts.length === 0) {
      throw new AppError('CONFIG_ERROR', 'No AI provider/model configured')
    }

    let emitted = false
    let firstTokenMs: number | undefined
    let lastError: unknown
    for (const { provider, model } of attempts) {
      try {
        const textChunks: string[] = []
        let answeredModel: string | undefined
        let usage: TranslateResult['usage']

        if (provider.client.stream) {
          for await (const chunk of provider.client.stream({ messages, model, signal })) {
            textChunks.push(chunk.textDelta)
            if (!answeredModel && chunk.model) answeredModel = chunk.model
            if (chunk.textDelta.length > 0) {
              firstTokenMs ??= Date.now() - startedAt
              emitted = true
              onDelta?.(chunk.textDelta)
            }
          }
        } else {
          const result = await provider.client.generate({ messages, model, signal })
          textChunks.push(result.text)
          answeredModel = result.model
          usage = result.usage
          if (result.text.length > 0) {
            firstTokenMs ??= Date.now() - startedAt
            emitted = true
            onDelta?.(result.text)
          }
        }

        const text = textChunks.join('')
        const trimmed = text.trim()
        if (trimmed.length === 0) {
          throw new AppError('INVALID_RESPONSE', 'Provider returned an empty response', {
            provider: provider.label,
          })
        }
        return {
          translatedText: trimmed,
          provider: provider.label,
          providerId: provider.id,
          model: answeredModel ?? model,
          usage,
          firstTokenMs,
          durationMs: Date.now() - startedAt,
        }
      } catch (error) {
        lastError = error
        if (emitted) throw error
        if (!isFailoverable(error)) throw error
      }
    }
    throw wrapAllProvidersFailed(lastError, attempts)
  }

  private async buildPrompt(request: TranslateRequest): Promise<string> {
    const promptKey = `translation/${request.mode}`
    const context = this.retriever
      ? (await this.retriever.retrieve({ text: request.text })).text
      : 'None.'
    return this.prompts.render(promptKey, {
      sourceLanguage:
        request.sourceLanguage === AUTO_DETECT ? 'auto-detect' : languageLabel(request.sourceLanguage),
      targetLanguage: languageLabel(request.targetLanguage),
      context,
    })
  }
}
