import { describe, expect, it } from 'vitest'
import { buildExerciseForPoint, chooseClozeToken, estimateDifficulty, maskTerm } from './exercise-generator'
import type { LearningPoint, StoredTranslationRecord } from '@tt/contracts'

const record: StoredTranslationRecord = {
  id: 'tr_20260829_001',
  createdAt: '2026-08-29T10:00:00.000Z',
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  mode: 'natural',
  provider: 'openai-compatible',
  model: 'example-model',
  tags: [],
  notes: '',
  sourceText: 'We need to take traceability into account.',
  aiTranslation: '我们需要考虑可追溯性。',
  userTranslation: null,
  analyzedAt: null,
  deletedAt: null,
  filePath: '/vault/tr_20260829_001.md',
}

const point = (overrides: Partial<LearningPoint> = {}): LearningPoint => ({
  id: 'lp_20260829_001',
  kind: 'vocabulary',
  term: 'traceability',
  meaning: '可追溯性',
  explanation: '',
  status: 'active',
  sourceTranslationIds: [record.id],
  occurrenceDates: ['2026-08-29'],
  createdAt: record.createdAt,
  updatedAt: record.createdAt,
  lastReviewedAt: null,
  nextReviewAt: null,
  successCount: 0,
  failureCount: 0,
  streak: 0,
  notes: '',
  ...overrides,
})

describe('buildExerciseForPoint', () => {
  it('builds a cloze exercise when the term appears in the source text', () => {
    const exercise = buildExerciseForPoint(point(), record)
    expect(exercise).toMatchObject({
      type: 'cloze',
      prompt: 'We need to take ____ into account.',
      referenceAnswer: 'traceability',
      sourceTranslationIds: [record.id],
      learningPointId: point().id,
    })
    expect(exercise!.prompt).not.toContain('traceability')
  })

  it('falls back to reverse translation when the term is absent', () => {
    const exercise = buildExerciseForPoint(point({ term: 'unrelated' }), record)
    expect(exercise).toMatchObject({
      type: 'reverse-translation',
      prompt: '我们需要考虑可追溯性。',
      referenceAnswer: record.sourceText,
    })
    expect(exercise!.instruction).toContain('English')
  })

  it('always keeps provenance to the source record', () => {
    for (const variant of [point(), point({ kind: 'grammar' })]) {
      const exercise = buildExerciseForPoint(variant, record)
      expect(exercise?.sourceTranslationIds).toEqual([record.id])
      expect(exercise?.sourceTranslationIds.length).toBeGreaterThan(0)
    }
  })
})

describe('maskTerm / chooseClozeToken', () => {
  it('masks case-insensitively and preserves the original token', () => {
    const masked = maskTerm('Traceability matters.', 'traceability')
    expect(masked).toEqual({ sentence: '____ matters.', token: 'Traceability' })
  })

  it('returns null when the term is absent', () => {
    expect(maskTerm('Nothing here.', 'missing')).toBeNull()
  })

  it('chooses a non-stopword token', () => {
    expect(chooseClozeToken('We will deploy the application tomorrow')).toBe('application')
  })
})

describe('estimateDifficulty', () => {
  it('scales with length and past errors, and drops with success', () => {
    expect(estimateDifficulty('Short.', 0, 0)).toBe('easy')
    expect(estimateDifficulty('a'.repeat(200), 0, 0)).toBe('hard')
    expect(estimateDifficulty('a'.repeat(60), 0, 0)).toBe('normal')
    expect(estimateDifficulty('Short.', 2, 0)).toBe('normal')
    expect(estimateDifficulty('Short.', 3, 0)).toBe('hard')
    expect(estimateDifficulty('a'.repeat(60), 1, 3)).toBe('normal')
  })
})
