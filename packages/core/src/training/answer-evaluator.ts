import { AiEvaluationSchema } from '@tt/contracts'
import type { Exercise, ReviewOutcome } from '@tt/contracts'
import type { LlmClient } from '../ai/llm-client'
import { parseJsonObject } from '../analysis/learning-extractor'
import type { PromptManager } from '../prompts/prompt-manager'

/**
 * Answer evaluation: deterministic normalization + comparison first;
 * AI semantic evaluation only for free-text exercises when needed
 * (spec section 36). Translation has many valid answers — the AI path
 * grades meaning, not wording.
 */
export class AnswerEvaluator {
  constructor(
    private readonly deps: {
      prompts: PromptManager
      clientProvider: () => Promise<LlmClient | null>
    },
  ) {}

  async evaluate(exercise: Exercise, answer: string): Promise<ReviewOutcome> {
    const reference = normalizeAnswer(exercise.referenceAnswer)
    const given = normalizeAnswer(answer)

    if (given.length > 0 && given === reference) {
      return { result: 'correct', feedback: 'Exact match.', importantDifferences: [], feedbackSource: 'heuristic' }
    }

    const sim = similarity(given, reference)
    if (sim >= 0.98) {
      return {
        result: 'correct',
        feedback: 'Matches the reference apart from minor spelling.',
        importantDifferences: [],
        feedbackSource: 'heuristic',
      }
    }

    if (exercise.type === 'cloze') {
      if (sim >= 0.8) {
        return {
          result: 'partiallyCorrect',
          feedback: 'Very close — check the exact term.',
          importantDifferences: [`Reference: ${exercise.referenceAnswer}`],
          feedbackSource: 'heuristic',
        }
      }
      return {
        result: 'incorrect',
        feedback: `Reference: ${exercise.referenceAnswer}`,
        importantDifferences: exercise.explanation ? [exercise.explanation] : [],
        feedbackSource: 'heuristic',
      }
    }

    // Free-text (reverse translation): heuristic first.
    const heuristic: ReviewOutcome =
      sim >= 0.75
        ? {
            result: 'partiallyCorrect',
            feedback: 'Close to the reference, but check the differences below.',
            importantDifferences: [`Reference: ${exercise.referenceAnswer}`],
            feedbackSource: 'heuristic',
          }
        : {
            result: 'incorrect',
            feedback: 'Does not match the reference meaning yet.',
            importantDifferences: [`Reference: ${exercise.referenceAnswer}`],
            feedbackSource: 'heuristic',
          }

    // Same normalized answer handled above; near-identical stays heuristic.
    if (sim >= 0.98) return heuristic

    const client = await this.deps.clientProvider()
    if (!client) return heuristic

    try {
      const systemPrompt = this.deps.prompts.render('training/evaluate-answer', {
        exercisePrompt: exercise.prompt,
        referenceAnswer: exercise.referenceAnswer,
        userAnswer: answer,
      })
      const result = await client.generate({
        messages: [{ role: 'system', content: systemPrompt }],
        temperature: 0,
      })
      const parsed = AiEvaluationSchema.safeParse(parseJsonObject(result.text))
      if (!parsed.success) return heuristic
      return {
        result: parsed.data.verdict,
        feedback: parsed.data.feedback || heuristic.feedback,
        importantDifferences: parsed.data.importantDifferences,
        feedbackSource: 'ai',
      }
    } catch {
      // AI evaluation is an enhancement — heuristic verdict always stands.
      return heuristic
    }
  }
}

/** NFKC + lowercase + punctuation-insensitive whitespace collapse. */
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function bigrams(text: string): string[] {
  const clean = text.replace(/\s+/g, '')
  if (clean.length < 2) return clean.length === 1 ? [clean] : []
  const out: string[] = []
  for (let i = 0; i < clean.length - 1; i++) out.push(clean.slice(i, i + 2))
  return out
}

/** Sørensen–Dice over character bigrams; works for Latin and CJK. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.length === 0 || B.length === 0) return 0
  const counts = new Map<string, number>()
  for (const gram of A) counts.set(gram, (counts.get(gram) ?? 0) + 1)
  let intersection = 0
  for (const gram of B) {
    const remaining = counts.get(gram) ?? 0
    if (remaining > 0) {
      intersection += 1
      counts.set(gram, remaining - 1)
    }
  }
  return (2 * intersection) / (A.length + B.length)
}
