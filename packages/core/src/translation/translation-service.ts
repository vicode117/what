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
    const promptKey = `translation/${request.mode}`
    const context = this.retriever
      ? (await this.retriever.retrieve({ text: request.text })).text
      : 'None.'
    const systemPrompt = this.prompts.render(promptKey, {
      sourceLanguage:
        request.sourceLanguage === AUTO_DETECT ? 'auto-detect' : languageLabel(request.sourceLanguage),
      targetLanguage: languageLabel(request.targetLanguage),
      context,
    })

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
}
