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
  client: LlmClient
}

/**
 * Errors worth falling through to the next provider for. Request-side
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

/**
 * Builds the translation prompt from version-controlled Markdown
 * templates — enriched with translation-memory context when a
 * retriever is provided — and runs generation through the configured
 * providers in priority order: the first success wins; retryable
 * failures fall through to the next provider.
 */
export class TranslationService {
  constructor(
    private readonly prompts: PromptManager,
    private readonly retriever?: ContextRetriever,
  ) {}

  async translate(request: TranslateRequest, providers: ProviderRuntime[]): Promise<TranslateResult> {
    const systemPrompt = await this.buildPrompt(request)
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: request.text },
    ]

    let lastError: unknown
    for (const provider of providers) {
      try {
        const startedAt = Date.now()
        const result: GenerationResult = await provider.client.generate({ messages })
        return {
          translatedText: result.text.trim(),
          provider: provider.label,
          model: result.model,
          usage: result.usage,
          durationMs: Date.now() - startedAt,
        }
      } catch (error) {
        lastError = error
        if (!isFailoverable(error)) throw error
      }
    }
    throw wrapAllProvidersFailed(lastError, providers)
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
    const systemPrompt = await this.buildPrompt(request)
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: request.text },
    ]

    let emitted = false
    let lastError: unknown
    for (const provider of providers) {
      try {
        const startedAt = Date.now()
        let text = ''
        let model: string | undefined
        let usage: TranslateResult['usage']

        if (provider.client.stream) {
          for await (const chunk of provider.client.stream({ messages, signal })) {
            text += chunk.textDelta
            if (!model && chunk.model) model = chunk.model
            if (chunk.textDelta.length > 0) {
              emitted = true
              onDelta?.(chunk.textDelta)
            }
          }
        } else {
          const result = await provider.client.generate({ messages, signal })
          text = result.text
          model = result.model
          usage = result.usage
          if (text.length > 0) {
            emitted = true
            onDelta?.(text)
          }
        }

        const trimmed = text.trim()
        if (trimmed.length === 0) {
          throw new AppError('INVALID_RESPONSE', 'Provider returned an empty response', {
            provider: provider.label,
          })
        }
        return {
          translatedText: trimmed,
          provider: provider.label,
          model: model ?? 'unknown',
          usage,
          durationMs: Date.now() - startedAt,
        }
      } catch (error) {
        lastError = error
        if (emitted) throw error
        if (!isFailoverable(error)) throw error
      }
    }
    throw wrapAllProvidersFailed(lastError, providers)
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

function isFailoverable(error: unknown): boolean {
  return error instanceof AppError && FAILOVER_ERROR_CODES.has(error.code)
}

function wrapAllProvidersFailed(lastError: unknown, providers: ProviderRuntime[]): AppError {
  const last = lastError instanceof AppError ? lastError : undefined
  const attempts = providers.map((provider) => ({ provider: provider.label }))
  if (last) {
    return new AppError(
      last.code,
      `All ${providers.length} provider(s) failed — last error (${last.code}): ${last.message}`,
      { attempts },
    )
  }
  return new AppError('CONFIG_ERROR', 'No AI provider was attempted', { attempts })
}
