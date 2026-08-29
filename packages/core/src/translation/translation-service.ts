import { AUTO_DETECT, languageLabel } from '@tt/contracts'
import type { TranslateRequest, TranslateResult } from '@tt/contracts'
import type { LlmClient } from '../ai/llm-client'
import type { PromptManager } from '../prompts/prompt-manager'
import type { ContextRetriever } from './context-retriever'

/**
 * Builds the translation prompt from version-controlled Markdown
 * templates — enriched with translation-memory context when a
 * retriever is provided — and delegates generation to the LLM client
 * boundary. Knows nothing about providers, API keys, or storage.
 */
export class TranslationService {
  constructor(
    private readonly prompts: PromptManager,
    private readonly retriever?: ContextRetriever,
  ) {}

  async translate(request: TranslateRequest, client: LlmClient): Promise<TranslateResult> {
    const systemPrompt = await this.buildPrompt(request)

    const startedAt = Date.now()
    const result = await client.generate({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: request.text },
      ],
    })
    const durationMs = Date.now() - startedAt

    return {
      translatedText: result.text.trim(),
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      durationMs,
    }
  }

  /**
   * Streaming variant: forwards deltas while generating and resolves
   * with the final (trimmed) result. Falls back to a non-streaming
   * call when the client does not implement stream().
   */
  async translateStream(
    request: TranslateRequest,
    client: LlmClient,
    onDelta?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<TranslateResult> {
    const systemPrompt = await this.buildPrompt(request)
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: request.text },
    ]

    const startedAt = Date.now()
    let text = ''
    let model: string | undefined
    let usage: TranslateResult['usage']

    if (client.stream) {
      for await (const chunk of client.stream({ messages, signal })) {
        text += chunk.textDelta
        if (!model && chunk.model) model = chunk.model
        if (chunk.textDelta.length > 0) onDelta?.(chunk.textDelta)
      }
    } else {
      const result = await client.generate({ messages, signal })
      text = result.text
      model = result.model
      usage = result.usage
      onDelta?.(text)
    }
    const durationMs = Date.now() - startedAt

    return {
      translatedText: text.trim(),
      provider: client.provider,
      model: model ?? 'unknown',
      usage,
      durationMs,
    }
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
