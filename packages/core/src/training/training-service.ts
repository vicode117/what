import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AppError } from '@tt/contracts'
import { TrainingSessionSchema, SubmitResultSchema } from '@tt/contracts'
import type { StoredTranslationRecord, SubmitAnswer, SubmitResult, TrainingSession } from '@tt/contracts'
import { buildExerciseForPoint } from './exercise-generator'
import type { ExerciseSelectionStrategy } from './selection-strategy'
import type { ReviewScheduler } from './review-scheduler'
import type { AnswerEvaluator } from './answer-evaluator'
import type { ReviewLog } from './review-log'
import type { LearningPointStore } from '../memory/learning-point-store'
import type { HistoryService } from '../history/history-service'

export type TrainingServiceDeps = {
  points: LearningPointStore
  history: HistoryService
  scheduler: ReviewScheduler
  strategy: ExerciseSelectionStrategy
  evaluator: AnswerEvaluator
  reviewLog: ReviewLog
  /** Where daily session files live: <vault>/training/sessions. */
  sessionsDir: string
  /** Injectable clock for tests. */
  now?: () => Date
}

export type BuildSessionOptions = {
  targetSize: number
}

/**
 * Daily training (spec sections 30–31): due reviews + weak items +
 * new material, selected by a replaceable strategy, every exercise
 * referencing real translation history. The session is persisted per
 * local day so reopening the app does not reshuffle or re-ask items.
 */
export class TrainingService {
  constructor(private readonly deps: TrainingServiceDeps) {}

  async getToday(options: BuildSessionOptions, now = this.deps.now?.() ?? new Date()): Promise<TrainingSession> {
    const date = localDateKey(now)
    const existing = await this.loadSession(date)
    if (existing) return existing

    const session = await this.build(date, options, now)
    await this.persistSession(session)
    return session
  }

  async submit(input: SubmitAnswer, now = this.deps.now?.() ?? new Date()): Promise<SubmitResult> {
    const session = await this.loadSession(sessionDateFromId(input.sessionId))
    if (!session || session.sessionId !== input.sessionId) {
      throw new AppError('STORAGE_ERROR', `Training session not found: ${input.sessionId}`)
    }
    const exercise = session.exercises.find((item) => item.exerciseId === input.exerciseId)
    if (!exercise) {
      throw new AppError('STORAGE_ERROR', `Exercise not found in session: ${input.exerciseId}`)
    }

    const outcome = await this.deps.evaluator.evaluate(exercise, input.answer)

    await this.deps.reviewLog.append({
      at: now.toISOString(),
      sessionId: session.sessionId,
      exerciseId: exercise.exerciseId,
      learningPointId: exercise.learningPointId,
      translationId: exercise.sourceTranslationIds[0] ?? null,
      type: exercise.type,
      result: outcome.result,
      durationMs: input.durationMs,
      feedbackSource: outcome.feedbackSource,
    })

    if (exercise.learningPointId) {
      const point = this.deps.points.get(exercise.learningPointId)
      if (point) {
        const schedule = this.deps.scheduler.schedule(point, outcome.result, now)
        await this.deps.points.applyReview(point.id, {
          lastReviewedAt: now.toISOString(),
          nextReviewAt: schedule.nextReviewAt,
          successCount: point.successCount + (outcome.result === 'incorrect' ? 0 : 1),
          failureCount: point.failureCount + (outcome.result === 'incorrect' ? 1 : 0),
          streak: schedule.streak,
        })
      }
    }

    session.results[exercise.exerciseId] = { result: outcome.result, at: now.toISOString() }
    await this.persistSession(session)

    return SubmitResultSchema.parse({
      exerciseId: exercise.exerciseId,
      result: outcome.result,
      feedback: outcome.feedback,
      importantDifferences: outcome.importantDifferences,
      referenceAnswer: exercise.referenceAnswer,
      explanation: exercise.explanation,
      feedbackSource: outcome.feedbackSource,
    })
  }

  private async build(
    date: string,
    options: BuildSessionOptions,
    now: Date,
  ): Promise<TrainingSession> {
    await this.deps.points.ensure()
    const activePoints = this.deps.points.all().filter((point) => point.status === 'active')

    // Resolve linked history; deleted/missing records make a point unusable.
    const recordById = new Map<string, StoredTranslationRecord>()
    for (const point of activePoints) {
      for (const id of point.sourceTranslationIds) {
        if (recordById.has(id)) continue
        const record = await this.deps.history.get(id)
        if (record && record.deletedAt === null) recordById.set(id, record)
      }
    }

    const usable = activePoints.filter((point) =>
      point.sourceTranslationIds.some((id) => recordById.has(id)),
    )
    const selected = this.deps.strategy.select({
      points: usable,
      recordById,
      now,
      targetSize: Math.max(1, options.targetSize),
    })

    const exercises = selected
      .map((point) => {
        const records = point.sourceTranslationIds
          .map((id) => recordById.get(id))
          .filter((record) => record !== undefined)
        if (records.length === 0) return null
        const newest = records.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
        return buildExerciseForPoint(point, newest)
      })
      .filter((exercise): exercise is NonNullable<typeof exercise> => exercise !== null)

    return TrainingSessionSchema.parse({
      sessionId: `sess_${date}`,
      date,
      createdAt: now.toISOString(),
      exercises,
      results: {},
    })
  }

  private sessionFile(date: string): string {
    return path.join(this.deps.sessionsDir, `${date}.json`)
  }

  private async loadSession(date: string): Promise<TrainingSession | null> {
    let raw: string
    try {
      raw = await fs.readFile(this.sessionFile(date), 'utf8')
    } catch {
      return null
    }
    try {
      return TrainingSessionSchema.parse(JSON.parse(raw))
    } catch {
      // Corrupt session file — regenerate rather than fail the day.
      return null
    }
  }

  private async persistSession(session: TrainingSession): Promise<void> {
    await fs.mkdir(this.deps.sessionsDir, { recursive: true })
    await fs.writeFile(this.sessionFile(session.date), JSON.stringify(session, null, 2), 'utf8')
  }
}

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sessionDateFromId(sessionId: string): string {
  const match = /^sess_(\d{4}-\d{2}-\d{2})$/.exec(sessionId)
  if (!match) {
    throw new AppError('VALIDATION_ERROR', `Invalid session id: ${sessionId}`)
  }
  return match[1]!
}
