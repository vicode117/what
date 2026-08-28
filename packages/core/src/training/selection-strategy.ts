import type { LearningPoint, StoredTranslationRecord } from '@tt/contracts'

export type SelectionInput = {
  points: readonly LearningPoint[]
  recordById: ReadonlyMap<string, StoredTranslationRecord>
  now: Date
  targetSize: number
}

/**
 * Replaceable boundary for daily exercise selection (spec: strategies
 * must not be hard-coded across the UI/service).
 */
export interface ExerciseSelectionStrategy {
  select(input: SelectionInput): LearningPoint[]
}

type Sortable = { point: LearningPoint; corrected: boolean; recency: number }

/**
 * Initial heuristic mix (spec section 31):
 *   50% due review, 30% weak items, 20% new material.
 * Within each bucket, items backed by USER-CORRECTED translations come
 * first, then the most recent ones. Mastered/excluded items never pass
 * through selection.
 */
export class WeightedSelectionStrategy implements ExerciseSelectionStrategy {
  select(input: SelectionInput): LearningPoint[] {
    const { points, recordById, now, targetSize } = input
    const nowMs = now.getTime()

    const isDue = (point: LearningPoint) =>
      point.nextReviewAt !== null && new Date(point.nextReviewAt).getTime() <= nowMs
    const isWeak = (point: LearningPoint) => point.failureCount > 0
    const isNew = (point: LearningPoint) => point.successCount === 0 && point.failureCount === 0

    const sortables = new Map<string, Sortable>()
    for (const point of points) {
      if (point.status !== 'active') continue
      const records = point.sourceTranslationIds
        .map((id) => recordById.get(id))
        .filter((record): record is StoredTranslationRecord => record !== undefined)
      if (records.length === 0) continue
      const newest = records.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
      sortables.set(point.id, {
        point,
        corrected: newest.userTranslation !== null,
        recency: Math.max(
          new Date(newest.createdAt).getTime(),
          ...point.occurrenceDates.map((date) => new Date(`${date}T23:59:59`).getTime()),
        ),
      })
    }

    const byPriority = (a: Sortable, b: Sortable): number => {
      if (a.corrected !== b.corrected) return a.corrected ? -1 : 1
      return b.recency - a.recency
    }
    const byWeakness = (a: Sortable, b: Sortable): number => {
      if (a.corrected !== b.corrected) return a.corrected ? -1 : 1
      if (b.point.failureCount !== a.point.failureCount) return b.point.failureCount - a.point.failureCount
      return b.recency - a.recency
    }

    const all = [...sortables.values()]
    const due = all.filter((s) => isDue(s.point)).sort(byPriority)
    const weak = all.filter((s) => !isDue(s.point) && isWeak(s.point)).sort(byWeakness)
    const fresh = all.filter((s) => !isDue(s.point) && !isWeak(s.point) && isNew(s.point)).sort(byPriority)

    const target = Math.min(targetSize, all.length)
    const dueCount = Math.min(due.length, Math.round(target * 0.5))
    const weakCount = Math.min(weak.length, Math.round(target * 0.3))
    const newCount = Math.min(fresh.length, Math.max(target - dueCount - weakCount, 0))

    const selected: Sortable[] = [
      ...due.slice(0, dueCount),
      ...weak.slice(0, weakCount),
      ...fresh.slice(0, newCount),
    ]

    // Fill deficits from the strongest remaining candidates of any bucket.
    if (selected.length < target) {
      const chosen = new Set(selected.map((s) => s.point.id))
      const rest = all
        .filter((s) => !chosen.has(s.point.id))
        .sort((a, b) => byPriority(a, b))
      for (const candidate of rest) {
        if (selected.length >= target) break
        selected.push(candidate)
        chosen.add(candidate.point.id)
      }
    }

    return selected.map((s) => s.point)
  }
}
