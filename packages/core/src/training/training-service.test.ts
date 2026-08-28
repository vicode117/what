import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AnswerEvaluator } from './answer-evaluator'
import { HistoryService } from '../history/history-service'
import { LearningPointStore } from '../memory/learning-point-store'
import { PromptManager } from '../prompts/prompt-manager'
import { ReviewLog } from './review-log'
import { SearchIndexService } from '../storage/search-index'
import { SimpleScheduler } from './review-scheduler'
import { TrainingService } from './training-service'
import { TranslationStore } from '../storage/translation-store'
import { WeightedSelectionStrategy } from './selection-strategy'
import type { LearningPoint } from '@tt/contracts'

let vault: string

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), 'tt-training-'))
})

afterEach(async () => {
  await rm(vault, { recursive: true, force: true })
})

const repoPromptsDir = path.resolve(__dirname, '..', '..', '..', '..', 'prompts')
const NOW = new Date(2026, 7, 29, 10, 0, 0)

async function makeService(): Promise<{
  training: TrainingService
  store: TranslationStore
  points: LearningPointStore
  reviewLog: ReviewLog
}> {
  const store = new TranslationStore(vault, { now: () => NOW })
  const points = new LearningPointStore(vault, { now: () => NOW })
  const prompts = new PromptManager([repoPromptsDir])
  await prompts.load()
  const training = new TrainingService({
    points,
    history: new HistoryService(store, new SearchIndexService(vault)),
    scheduler: new SimpleScheduler(),
    strategy: new WeightedSelectionStrategy(),
    evaluator: new AnswerEvaluator({ prompts, clientProvider: async () => null }),
    reviewLog: new ReviewLog(vault),
    sessionsDir: path.join(vault, 'training', 'sessions'),
    now: () => NOW,
  })
  return { training, store, points, reviewLog: new ReviewLog(vault) }
}

async function saveRecord(store: TranslationStore, id: string): Promise<void> {
  await store.save({
    sourceText: `Source text for ${id}.`,
    aiTranslation: `译稿 ${id}`,
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    mode: 'natural',
    provider: 'openai-compatible',
    model: 'example-model',
  })
}

async function seedPoint(
  points: LearningPointStore,
  recordId: string,
  term: string,
  status?: 'mastered' | 'excluded',
): Promise<LearningPoint> {
  const point = await points.upsertCandidate(recordId, '2026-08-29', 'vocabulary', { term })
  if (status) await points.update(point.id, { status })
  return points.get(point.id)!
}

describe('TrainingService (spec section 57 rules)', () => {
  it('references real history — every exercise points at existing records', async () => {
    const { training, store, points } = await makeService()
    await saveRecord(store, 'tr_20260829_001')
    await saveRecord(store, 'tr_20260829_002')
    await seedPoint(points, 'tr_20260829_001', 'traceability')

    const session = await training.getToday({ targetSize: 10 })

    expect(session.exercises.length).toBeGreaterThan(0)
    for (const exercise of session.exercises) {
      for (const sourceId of exercise.sourceTranslationIds) {
        expect(await store.get(sourceId)).not.toBeNull()
      }
      expect(exercise.learningPointId).not.toBeNull()
    }
  })

  it('never generates source-less exercises (missing records are skipped)', async () => {
    const { training, points } = await makeService()
    await points.upsertCandidate('tr_missing', '2026-08-29', 'vocabulary', { term: 'orphan' })

    const session = await training.getToday({ targetSize: 10 })
    expect(session.exercises).toHaveLength(0)
  })

  it('does not use deleted records', async () => {
    const { training, store, points } = await makeService()
    await saveRecord(store, 'tr_20260829_001')
    const point = await seedPoint(points, 'tr_20260829_001', 'traceability')
    await store.update('tr_20260829_001', { deletedAt: '2026-08-29T09:30:00.000Z' })

    const session = await training.getToday({ targetSize: 10 })
    expect(session.exercises.map((exercise) => exercise.learningPointId)).not.toContain(point.id)
  })

  it('deprioritizes mastered items', async () => {
    const { training, store, points } = await makeService()
    await saveRecord(store, 'tr_20260829_001')
    await saveRecord(store, 'tr_20260829_002')
    const active = await seedPoint(points, 'tr_20260829_001', 'active-term')
    const mastered = await seedPoint(points, 'tr_20260829_002', 'mastered-term', 'mastered')

    const session = await training.getToday({ targetSize: 10 })
    const ids = session.exercises.map((exercise) => exercise.learningPointId)
    expect(ids).toContain(active.id)
    expect(ids).not.toContain(mastered.id)
  })

  it('schedules incorrect items to return sooner than correct ones', async () => {
    const { training, store, points } = await makeService()
    await saveRecord(store, 'tr_20260829_001')
    await saveRecord(store, 'tr_20260829_002')
    const missed = await seedPoint(points, 'tr_20260829_001', 'missed-term')
    const known = await seedPoint(points, 'tr_20260829_002', 'known-term')

    const session = await training.getToday({ targetSize: 10 })
    const exercises = session.exercises.filter(
      (exercise) => exercise.learningPointId === missed.id || exercise.learningPointId === known.id,
    )
    expect(exercises).toHaveLength(2)

    await training.submit({
      sessionId: session.sessionId,
      exerciseId: exercises[0]!.exerciseId,
      answer: 'totally wrong',
      durationMs: 1000,
    })
    await training.submit({
      sessionId: session.sessionId,
      exerciseId: exercises[1]!.exerciseId,
      answer: exercises[1]!.referenceAnswer,
      durationMs: 1000,
    })

    const afterMiss = points.get(missed.id)!
    const afterKnown = points.get(known.id)!
    expect(afterMiss.failureCount).toBe(1)
    expect(afterKnown.successCount).toBe(1)
    expect(new Date(afterMiss.nextReviewAt!).getTime()).toBeLessThan(
      new Date(afterKnown.nextReviewAt!).getTime(),
    )
  })

  it('keeps the session stable across restarts and records results', async () => {
    const { training, store, points } = await makeService()
    await saveRecord(store, 'tr_20260829_001')
    const point = await seedPoint(points, 'tr_20260829_001', 'traceability')

    const first = await training.getToday({ targetSize: 10 })
    const reopenedEarly = await training.getToday({ targetSize: 10 })
    expect(reopenedEarly.sessionId).toBe(first.sessionId)
    expect(reopenedEarly.exercises.map((e) => e.exerciseId)).toEqual(first.exercises.map((e) => e.exerciseId))

    const exercise = first.exercises[0]!
    const result = await training.submit({
      sessionId: first.sessionId,
      exerciseId: exercise.exerciseId,
      answer: exercise.referenceAnswer,
      durationMs: 500,
    })
    expect(result.result).toBe('correct')

    const reopened = await training.getToday({ targetSize: 10 })
    expect(reopened.results[exercise.exerciseId]?.result).toBe('correct')

    // Submitting an unknown exercise is a typed error, never a crash.
    await expect(
      training.submit({
        sessionId: first.sessionId,
        exerciseId: 'ex_unknown',
        answer: 'x',
        durationMs: 0,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_ERROR' })

    expect(point.id).toBeTruthy()
  })
})
