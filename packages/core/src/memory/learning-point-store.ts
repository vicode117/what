import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AppError } from '@tt/contracts'
import { LearningPointSchema } from '@tt/contracts'
import type { LearningKind, LearningPoint, LearningStatus } from '@tt/contracts'
import { buildBody, parseBody, parseDocument, serializeDocument } from '../storage/markdown'

const SECTION_HEADINGS = ['Notes'] as const

/**
 * Markdown persistence for learning points, one file per item:
 * - kind vocabulary  → memory/vocabulary/
 * - kind expression/grammar → memory/expressions/
 *
 * The in-memory map also maintains a normalized-term key so repeated
 * occurrences of the same word or phrase MERGE into one learning point
 * (appending sources and dates) instead of creating duplicates.
 */
export class LearningPointStore {
  private points = new Map<string, LearningPoint>()
  private byKey = new Map<string, string>()
  private loadedOnce = false

  constructor(
    private readonly vaultPath: string,
    private readonly options: { now?: () => Date } = {},
  ) {}

  private get vocabularyDir(): string {
    return path.join(this.vaultPath, 'memory', 'vocabulary')
  }

  private get expressionsDir(): string {
    return path.join(this.vaultPath, 'memory', 'expressions')
  }

  private dirFor(kind: LearningKind): string {
    return kind === 'vocabulary' ? this.vocabularyDir : this.expressionsDir
  }

  async load(): Promise<void> {
    if (this.loadedOnce) return
    for (const dir of [this.vocabularyDir, this.expressionsDir]) {
      const entries = await fs.readdir(dir).catch(() => [])
      for (const name of entries) {
        if (!name.endsWith('.md')) continue
        const filePath = path.join(dir, name)
        try {
          const point = parseLearningPoint(await fs.readFile(filePath, 'utf8'))
          this.points.set(point.id, point)
          this.byKey.set(normalizeTerm(point.term), point.id)
        } catch {
          // unreadable file — skip; source of truth stays untouched
        }
      }
    }
    this.loadedOnce = true
  }

  async ensure(): Promise<void> {
    await this.load()
  }

  all(): LearningPoint[] {
    return [...this.points.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  get(id: string): LearningPoint | null {
    return this.points.get(id) ?? null
  }

  async upsertCandidate(
    recordId: string,
    date: string,
    kind: LearningKind,
    candidate: { term: string; meaning?: string; explanation?: string },
  ): Promise<LearningPoint> {
    await this.load()
    const now = (this.options.now?.() ?? new Date()).toISOString()
    const key = normalizeTerm(candidate.term)
    const existingId = this.byKey.get(key)

    if (existingId) {
      const existing = this.points.get(existingId)
      if (existing) {
        const merged: LearningPoint = {
          ...existing,
          sourceTranslationIds: existing.sourceTranslationIds.includes(recordId)
            ? existing.sourceTranslationIds
            : [...existing.sourceTranslationIds, recordId],
          occurrenceDates: existing.occurrenceDates.includes(date)
            ? existing.occurrenceDates
            : [...existing.occurrenceDates, date],
          meaning: existing.meaning || candidate.meaning || '',
          explanation: existing.explanation || candidate.explanation || '',
          updatedAt: now,
        }
        await this.write(merged)
        return merged
      }
    }

    // Ids use the compact date form (YYYYMMDD) while occurrenceDates keep
    // the human-readable YYYY-MM-DD format.
    const id = await this.nextId(date.replaceAll('-', ''))
    const point: LearningPoint = {
      id,
      kind,
      term: candidate.term.trim(),
      meaning: candidate.meaning ?? '',
      explanation: candidate.explanation ?? '',
      status: 'active',
      sourceTranslationIds: [recordId],
      occurrenceDates: [date],
      createdAt: now,
      updatedAt: now,
      lastReviewedAt: null,
      nextReviewAt: null,
      successCount: 0,
      failureCount: 0,
      streak: 0,
      notes: '',
    }
    await this.write(point)
    return point
  }

  async update(
    id: string,
    patch: { status?: LearningStatus; notes?: string },
  ): Promise<LearningPoint | null> {
    await this.load()
    const existing = this.points.get(id)
    if (!existing) return null
    const next: LearningPoint = {
      ...existing,
      status: patch.status ?? existing.status,
      notes: patch.notes ?? existing.notes,
      updatedAt: (this.options.now?.() ?? new Date()).toISOString(),
    }
    await this.write(next)
    return next
  }

  /** Applies review outcomes (called by the training scheduler). */
  async applyReview(
    id: string,
    patch: {
      lastReviewedAt: string
      nextReviewAt: string | null
      successCount: number
      failureCount: number
      streak: number
    },
  ): Promise<LearningPoint | null> {
    await this.load()
    const existing = this.points.get(id)
    if (!existing) return null
    const next: LearningPoint = { ...existing, ...patch, updatedAt: (this.options.now?.() ?? new Date()).toISOString() }
    await this.write(next)
    return next
  }

  async delete(id: string): Promise<boolean> {
    await this.load()
    const existing = this.points.get(id)
    if (!existing) return false
    const filePath = this.filePathFor(existing)
    await fs.rm(filePath, { force: true })
    this.points.delete(id)
    this.byKey.delete(normalizeTerm(existing.term))
    return true
  }

  private async write(point: LearningPoint): Promise<void> {
    const dir = this.dirFor(point.kind)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${point.id}.md`), serializeLearningPoint(point), 'utf8')
    this.points.set(point.id, point)
    this.byKey.set(normalizeTerm(point.term), point.id)
  }

  private filePathFor(point: LearningPoint): string {
    return path.join(this.dirFor(point.kind), `${point.id}.md`)
  }

  private async nextId(date: string): Promise<string> {
    let max = 0
    for (const id of this.points.keys()) {
      const match = /^lp_(\d{8})_(\d+)$/.exec(id)
      if (match && match[1] === date) max = Math.max(max, Number(match[2]))
    }
    return `lp_${date}_${String(max + 1).padStart(3, '0')}`
  }
}

export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase()
}

export function serializeLearningPoint(point: LearningPoint): string {
  const frontmatter: Record<string, unknown> = {
    id: point.id,
    kind: point.kind,
    term: point.term,
    meaning: point.meaning,
    explanation: point.explanation,
    status: point.status,
    sourceTranslationIds: point.sourceTranslationIds,
    occurrenceDates: point.occurrenceDates,
    createdAt: point.createdAt,
    updatedAt: point.updatedAt,
    successCount: point.successCount,
    failureCount: point.failureCount,
    streak: point.streak,
  }
  if (point.lastReviewedAt !== null) frontmatter['lastReviewedAt'] = point.lastReviewedAt
  if (point.nextReviewAt !== null) frontmatter['nextReviewAt'] = point.nextReviewAt

  const sections: { heading: string; content: string }[] = []
  if (point.notes.trim().length > 0) {
    sections.push({ heading: 'Notes', content: point.notes })
  }
  return serializeDocument(frontmatter, buildBody(point.term, sections))
}

export function parseLearningPoint(raw: string): LearningPoint {
  const document = parseDocument(raw)
  const parsed = LearningPointSchema.safeParse(document.frontmatter)
  if (!parsed.success) {
    throw new AppError('STORAGE_ERROR', 'Learning point frontmatter is missing or invalid', {
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    })
  }
  const sections = parseBody(document.body, SECTION_HEADINGS)
  return { ...parsed.data, notes: sections['Notes'] ?? '' }
}
