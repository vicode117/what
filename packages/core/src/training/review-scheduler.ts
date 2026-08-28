import type { LearningPoint, ReviewResultValue } from '@tt/contracts'

export type Schedule = {
  nextReviewAt: string | null
  streak: number
}

/**
 * Replaceable scheduling boundary (spec: a more sophisticated
 * algorithm such as FSRS can slot in here later).
 */
export interface ReviewScheduler {
  schedule(point: LearningPoint, result: ReviewResultValue, now: Date): Schedule
}

const CORRECT_INTERVAL_DAYS = [3, 7, 14, 30, 60]

/**
 * Simple interval scheduler: incorrect items come back tomorrow, a
 * partial answer in two days, and correct answers stretch their streak
 * through 3 → 7 → 14 → 30 → 60 days — so incorrect items always return
 * sooner than anything answered correctly.
 */
export class SimpleScheduler implements ReviewScheduler {
  schedule(point: LearningPoint, result: ReviewResultValue, now: Date): Schedule {
    if (result === 'correct') {
      const streak = point.streak + 1
      const days = CORRECT_INTERVAL_DAYS[Math.min(streak - 1, CORRECT_INTERVAL_DAYS.length - 1)]!
      return { nextReviewAt: addDays(now, days), streak }
    }
    if (result === 'partiallyCorrect') {
      return { nextReviewAt: addDays(now, 2), streak: point.streak }
    }
    return { nextReviewAt: addDays(now, 1), streak: 0 }
  }
}

function addDays(date: Date, days: number): string {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next.toISOString()
}
