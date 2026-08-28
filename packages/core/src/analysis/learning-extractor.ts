import { AppError } from '@tt/contracts'
import { LearningExtractionSchema } from '@tt/contracts'
import type { LearningExtraction } from '@tt/contracts'
import { languageLabel } from '@tt/contracts'
import { AUTO_DETECT } from '@tt/contracts'
import type { LlmClient } from '../ai/llm-client'
import type { PromptManager } from '../prompts/prompt-manager'

export type ExtractionInput = {
  sourceText: string
  aiTranslation: string
  userTranslation: string | null
  sourceLanguage: string
  targetLanguage: string
}

/**
 * Extracts structured learning candidates from a saved translation.
 * The model must answer with JSON matching the Zod schema — anything
 * else becomes INVALID_RESPONSE, never silently accepted.
 */
export class LearningExtractor {
  constructor(private readonly prompts: PromptManager) {}

  async extract(input: ExtractionInput, client: LlmClient): Promise<LearningExtraction> {
    const systemPrompt = this.prompts.render('analysis/extract-learning-points', {
      sourceLanguage: input.sourceLanguage === AUTO_DETECT ? 'auto-detect' : languageLabel(input.sourceLanguage),
      targetLanguage: languageLabel(input.targetLanguage),
      sourceText: input.sourceText,
      translation: input.userTranslation ?? input.aiTranslation,
    })

    const result = await client.generate({
      messages: [{ role: 'system', content: systemPrompt }],
      temperature: 0,
    })

    const candidate = parseJsonObject(result.text)
    const validated = LearningExtractionSchema.safeParse(candidate)
    if (!validated.success) {
      throw new AppError('INVALID_RESPONSE', 'Learning extraction returned an unexpected JSON structure', {
        issues: validated.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      })
    }
    return validated.data
  }
}

/** Tolerates markdown fences or prose around a single JSON object. */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new AppError('INVALID_RESPONSE', 'AI response did not contain a JSON object')
  }
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    throw new AppError('INVALID_RESPONSE', 'AI response contained invalid JSON', {
      cause: error instanceof Error ? error.message : String(error),
    })
  }
}
