import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ExerciseType, ReviewResultValue } from '@tt/contracts'

/** Append-only review event (spec section 34). Stored at logs/reviews.jsonl. */
export type ReviewEvent = {
  eventId: string
  at: string
  sessionId: string
  exerciseId: string
  learningPointId: string | null
  translationId: string | null
  type: ExerciseType
  result: ReviewResultValue
  durationMs: number
  feedbackSource: 'heuristic' | 'ai'
}

export class ReviewLog {
  constructor(private readonly vaultPath: string) {}

  private get file(): string {
    return path.join(this.vaultPath, 'logs', 'reviews.jsonl')
  }

  async append(
    event: Omit<ReviewEvent, 'eventId'> & { eventId?: string },
  ): Promise<ReviewEvent> {
    const full: ReviewEvent = { eventId: event.eventId ?? randomUUID(), ...event }
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await fs.appendFile(this.file, `${JSON.stringify(full)}\n`, 'utf8')
    return full
  }

  /** Tolerant read: corrupt lines are skipped, never rewritten. */
  async read(): Promise<ReviewEvent[]> {
    let raw: string
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch {
      return []
    }
    const events: ReviewEvent[] = []
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue
      try {
        events.push(JSON.parse(line) as ReviewEvent)
      } catch {
        continue
      }
    }
    return events
  }
}
