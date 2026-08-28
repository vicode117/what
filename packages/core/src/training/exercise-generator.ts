import { AUTO_DETECT, languageLabel } from '@tt/contracts'
import type { Difficulty, Exercise, LearningPoint, StoredTranslationRecord } from '@tt/contracts'
import { finalTranslation } from '@tt/contracts'

const CLOZE_MASK = '____'

/** Common English words never worth masking in cloze exercises. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it',
  'this', 'that', 'these', 'those', 'we', 'you', 'they', 'he', 'she', 'our',
  'their', 'your', 'not', 'no', 'can', 'will', 'should', 'would', 'could',
])

/**
 * Deterministic exercise generation from real history.
 * Prefers cloze when the learned term appears in the source text;
 * otherwise builds a reverse-translation exercise.
 */
export function buildExerciseForPoint(
  point: LearningPoint,
  record: StoredTranslationRecord,
): Exercise | null {
  const difficulty = estimateDifficulty(record.sourceText, point.failureCount, point.successCount)
  const explanation = point.meaning
    ? `${point.term} — ${point.meaning}`
    : point.explanation

  if (point.kind !== 'grammar') {
    const masked = maskTerm(record.sourceText, point.term)
    if (masked) {
      return {
        exerciseId: `ex_${point.id}`,
        type: 'cloze',
        instruction: 'Fill in the blank.',
        prompt: masked.sentence,
        referenceAnswer: masked.token,
        explanation,
        difficulty,
        sourceTranslationIds: [record.id],
        learningPointId: point.id,
      }
    }
  }

  return {
    exerciseId: `ex_${point.id}`,
    type: 'reverse-translation',
    instruction:
      record.sourceLanguage === AUTO_DETECT
        ? 'Translate back into the original language.'
        : `Translate into ${languageLabel(record.sourceLanguage)}.`,
    prompt: finalTranslation(record),
    referenceAnswer: record.sourceText,
    explanation,
    difficulty,
    sourceTranslationIds: [record.id],
    learningPointId: point.id,
  }
}

/** Masks the first case-insensitive occurrence of `term` in `text`. */
export function maskTerm(text: string, term: string): { sentence: string; token: string } | null {
  const lowerText = text.toLowerCase()
  const lowerTerm = term.trim().toLowerCase()
  if (lowerTerm.length === 0) return null
  const index = lowerText.indexOf(lowerTerm)
  if (index === -1) return null
  const token = text.slice(index, index + lowerTerm.length)
  return {
    sentence: `${text.slice(0, index)}${CLOZE_MASK}${text.slice(index + lowerTerm.length)}`,
    token,
  }
}

/** Picks the token a cloze exercise should mask when no term is given. */
export function chooseClozeToken(text: string): string | null {
  const tokens = text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []
  const candidates = tokens
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
    .sort((a, b) => b.length - a.length)
  if (candidates.length === 0) return null
  const chosen = candidates[0]!
  const match = new RegExp(`\\b${escapeRegExp(chosen)}\\b`, 'i').exec(text)
  return match ? match[0] : null
}

/**
 * Heuristic difficulty (spec: no ML). Longer sentences and past
 * mistakes raise difficulty; repeated success lowers it.
 */
export function estimateDifficulty(
  sourceText: string,
  failureCount: number,
  successCount: number,
): Difficulty {
  let score = sourceText.length > 120 ? 2 : sourceText.length > 40 ? 1 : 0
  if (failureCount > 0) score += 1
  if (failureCount >= 3) score += 1
  if (successCount >= 2) score -= 1
  if (score >= 2) return 'hard'
  if (score === 1) return 'normal'
  return 'easy'
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
