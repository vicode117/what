import { describe, expect, it } from 'vitest'
import { WeightedSelectionStrategy } from './selection-strategy'
import type { LearningPoint, StoredTranslationRecord } from '@tt/contracts'
import { SimpleScheduler } from './review-scheduler'

const NOW = new Date(2026, 7, 29, 10, 0, 0)

const point = (id: string, overrides: Partial<LearningPoint> = {}): LearningPoint => ({
  id,
  kind: 'vocabulary',
  term: id,
  meaning: '',
  explanation: '',
  status: 'active',
  sourceTranslationIds: [`tr_${id}`],
  occurrenceDates: ['2026-08-29'],
  createdAt: '2026-08-29T09:00:00.000Z',
  updatedAt: '2026-08-29T09:00:00.000Z',
  lastReviewedAt: null,
  nextReviewAt: null,
  successCount: 0,
  failureCount: 0,
  streak: 0,
  notes: '',
  ...overrides,
})

const record = (id: string, overrides: Partial<StoredTranslationRecord> = {}): StoredTranslationRecord => ({
  id,
  createdAt: '2026-08-29T09:00:00.000Z',
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  mode: 'natural',
  provider: 'openai-compatible',
  model: 'example-model',
  tags: [],
  notes: '',
  sourceText: 'text',
  aiTranslation: 'ai',
  userTranslation: null,
  analyzedAt: null,
  deletedAt: null,
  filePath: `/vault/${id}.md`,
  ...overrides,
})

function buildFixture(prefix: string, count: number, overrides: (index: number) => Partial<LearningPoint>) {
  const points: LearningPoint[] = []
  const recordById = new Map<string, StoredTranslationRecord>()
  for (let i = 0; i < count; i++) {
    const p = point(`${prefix}${i}`, overrides(i))
    points.push(p)
    recordById.set(`tr_${prefix}${i}`, record(`tr_${prefix}${i}`))
  }
  return { points, recordById }
}

describe('WeightedSelectionStrategy', () => {
  it('applies the 50/30/20 mix (rounded, deficits filled)', () => {
    const due = buildFixture('due', 5, () => ({ nextReviewAt: '2026-08-28T00:00:00.000Z' }))
    const weak = buildFixture('weak', 5, () => ({ failureCount: 2 }))
    const fresh = buildFixture('new', 10, () => ({}))

    const strategy = new WeightedSelectionStrategy()
    const selected = strategy.select({
      points: [...due.points, ...weak.points, ...fresh.points],
      recordById: new Map([...due.recordById, ...weak.recordById, ...fresh.recordById]),
      now: NOW,
      targetSize: 10,
    })

    expect(selected).toHaveLength(10)
    const dueCount = selected.filter((p) => p.nextReviewAt !== null).length
    const weakCount = selected.filter((p) => p.failureCount > 0).length
    const newCount = selected.filter((p) => p.nextReviewAt === null && p.failureCount === 0).length
    expect(dueCount).toBe(5)
    expect(weakCount).toBe(3)
    expect(newCount).toBe(2)
  })

  it('never selects mastered or excluded items', () => {
    const fixture = buildFixture('base', 6, () => ({}))
    const mastered = point('m1', { status: 'mastered' })
    const excluded = point('m2', { status: 'excluded' })

    const selected = new WeightedSelectionStrategy().select({
      points: [...fixture.points, mastered, excluded],
      recordById: new Map([...fixture.recordById, ['tr_m1', record('tr_m1')], ['tr_m2', record('tr_m2')]]),
      now: NOW,
      targetSize: 10,
    })

    expect(selected.map((p) => p.id)).not.toContain('m1')
    expect(selected.map((p) => p.id)).not.toContain('m2')
  })

  it('skips points whose linked records are missing', () => {
    const orphan = point('orphan')
    const selected = new WeightedSelectionStrategy().select({
      points: [orphan],
      recordById: new Map(),
      now: NOW,
      targetSize: 5,
    })
    expect(selected).toHaveLength(0)
  })

  it('prefers points backed by user-corrected translations', () => {
    const plain = buildFixture('plain', 1, () => ({}))
    const corrected = buildFixture('fixed', 1, () => ({}))
    const correctedRecord = record('tr_fixed0', { userTranslation: '修正后的译文' })
    corrected.recordById.set('tr_fixed0', correctedRecord)

    const selected = new WeightedSelectionStrategy().select({
      points: [...plain.points, ...corrected.points],
      recordById: new Map([...plain.recordById, ...corrected.recordById]),
      now: NOW,
      targetSize: 1,
    })

    expect(selected).toHaveLength(1)
    expect(selected[0]!.sourceTranslationIds).toEqual(['tr_fixed0'])
    expect(correctedRecord.userTranslation).not.toBeNull()
  })
})

describe('SimpleScheduler', () => {
  const scheduler = new SimpleScheduler()
  const base = point('p')

  it('returns incorrect items sooner than anything correct', () => {
    const incorrect = scheduler.schedule(base, 'incorrect', NOW)
    const partial = scheduler.schedule(base, 'partiallyCorrect', NOW)
    const correct = scheduler.schedule(base, 'correct', NOW)
    expect(new Date(incorrect.nextReviewAt!).getTime()).toBeLessThan(
      new Date(partial.nextReviewAt!).getTime(),
    )
    expect(new Date(partial.nextReviewAt!).getTime()).toBeLessThan(
      new Date(correct.nextReviewAt!).getTime(),
    )
  })

  it('stretches intervals as the streak grows', () => {
    const first = scheduler.schedule(base, 'correct', NOW)
    const second = scheduler.schedule({ ...base, streak: first.streak }, 'correct', NOW)
    const firstDays = new Date(first.nextReviewAt!).getTime() - NOW.getTime()
    const secondDays = new Date(second.nextReviewAt!).getTime() - NOW.getTime()
    expect(secondDays).toBeGreaterThan(firstDays)
  })

  it('resets the streak on failure', () => {
    const scheduled = scheduler.schedule({ ...base, streak: 3 }, 'incorrect', NOW)
    expect(scheduled.streak).toBe(0)
  })
})
