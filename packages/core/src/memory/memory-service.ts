import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { GlossaryEntry, LearningExtraction, LearningPoint, MemoryQuery } from '@tt/contracts'
import { normalizeTerm, LearningPointStore } from './learning-point-store'
import type { LearningExtractor } from '../analysis/learning-extractor'
import type { LlmClient } from '../ai/llm-client'
import type { StoredTranslationRecord } from '@tt/contracts'

/**
 * Personal language memory: learning points with provenance plus the
 * user-maintained glossary. Facade used by IPC and training.
 */
export class MemoryService {
  constructor(
    private readonly store: LearningPointStore,
    private readonly extractor: LearningExtractor,
  ) {}

  async analyze(
    record: StoredTranslationRecord,
    client: LlmClient,
  ): Promise<{ learningPointIds: string[]; extraction: LearningExtraction }> {
    const extraction = await this.extractor.extract(
      {
        sourceText: record.sourceText,
        aiTranslation: record.aiTranslation,
        userTranslation: record.userTranslation,
        sourceLanguage: record.sourceLanguage,
        targetLanguage: record.targetLanguage,
      },
      client,
    )

    const date = record.createdAt.slice(0, 10)
    const ids: string[] = []
    for (const candidate of extraction.difficultWords) {
      ids.push((await this.store.upsertCandidate(record.id, date, 'vocabulary', candidate)).id)
    }
    for (const candidate of extraction.expressions) {
      ids.push((await this.store.upsertCandidate(record.id, date, 'expression', candidate)).id)
    }
    for (const point of extraction.grammarPoints) {
      ids.push(
        (
          await this.store.upsertCandidate(record.id, date, 'grammar', {
            term: point.pattern,
            meaning: '',
            explanation: point.explanation,
          })
        ).id,
      )
    }
    return { learningPointIds: ids, extraction }
  }

  async list(query: MemoryQuery): Promise<{ items: LearningPoint[]; total: number }> {
    await this.store.ensure()
    let items = this.store.all()
    const total = items.length

    const text = query.text?.trim().toLowerCase()
    if (text) {
      items = items.filter(
        (point) =>
          point.term.toLowerCase().includes(text) ||
          point.meaning.toLowerCase().includes(text) ||
          point.explanation.toLowerCase().includes(text),
      )
    }
    if (query.kind) items = items.filter((point) => point.kind === query.kind)
    if (query.status) items = items.filter((point) => point.status === query.status)
    if (query.sourceTranslationId) {
      items = items.filter((point) => point.sourceTranslationIds.includes(query.sourceTranslationId!))
    }

    const offset = query.offset ?? 0
    const limit = query.limit ?? 100
    return { items: items.slice(offset, offset + limit), total }
  }

  get(id: string): LearningPoint | null {
    return this.store.get(id)
  }

  update(id: string, patch: { status?: LearningPoint['status']; notes?: string }) {
    return this.store.update(id, patch)
  }

  delete(id: string) {
    return this.store.delete(id)
  }

  storeRef(): LearningPointStore {
    return this.store
  }
}

const GLOSSARY_HEADER = '# Glossary'

type GlossaryCache = {
  mtimeMs: number
  ctimeMs: number
  size: number
  entries: GlossaryEntry[]
}

/**
 * Explicit user-maintained glossary at `memory/glossary/glossary.md`.
 * Entries outrank any inferred preference in translation context.
 */
export class GlossaryStore {
  private cache: GlossaryCache | null = null
  private loadPromise: Promise<GlossaryEntry[]> | null = null

  constructor(private readonly vaultPath: string) {}

  private get file(): string {
    return path.join(this.vaultPath, 'memory', 'glossary', 'glossary.md')
  }

  async list(): Promise<GlossaryEntry[]> {
    const stat = await fs.stat(this.file).catch(() => null)
    if (stat === null) {
      this.cache = null
      return []
    }
    if (
      this.cache &&
      this.cache.mtimeMs === stat.mtimeMs &&
      this.cache.ctimeMs === stat.ctimeMs &&
      this.cache.size === stat.size
    ) {
      return this.cache.entries
    }
    if (this.loadPromise) return this.loadPromise

    const promise = this.read(stat.mtimeMs, stat.ctimeMs, stat.size)
    this.loadPromise = promise
    try {
      return await promise
    } finally {
      if (this.loadPromise === promise) this.loadPromise = null
    }
  }

  private async read(mtimeMs: number, ctimeMs: number, size: number): Promise<GlossaryEntry[]> {
    const raw = await fs.readFile(this.file, 'utf8').catch(() => null)
    if (raw === null) {
      this.cache = null
      return []
    }
    const entries: GlossaryEntry[] = []
    for (const line of raw.split(/\r?\n/)) {
      const match = /^- (.+?) :: (.+?)\s*$/.exec(line)
      if (match) entries.push({ term: match[1]!, translation: match[2]! })
    }
    this.cache = { mtimeMs, ctimeMs, size, entries }
    return entries
  }

  /** Adds or replaces an entry (terms are matched case-insensitively). */
  async add(entry: GlossaryEntry): Promise<GlossaryEntry[]> {
    const entries = await this.list()
    const key = normalizeTerm(entry.term)
    const next = entries.filter((existing) => normalizeTerm(existing.term) !== key)
    next.push({ term: entry.term.trim(), translation: entry.translation.trim() })
    next.sort((a, b) => a.term.localeCompare(b.term))
    await this.write(next)
    return next
  }

  async remove(term: string): Promise<GlossaryEntry[]> {
    const entries = await this.list()
    const key = normalizeTerm(term)
    const next = entries.filter((existing) => normalizeTerm(existing.term) !== key)
    await this.write(next)
    return next
  }

  private async write(entries: GlossaryEntry[]): Promise<void> {
    const body = entries.length > 0
      ? `${entries.map((entry) => `- ${entry.term} :: ${entry.translation}`).join('\n')}\n`
      : ''
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await fs.writeFile(this.file, `${GLOSSARY_HEADER}\n\n${body}`, 'utf8')
    const stat = await fs.stat(this.file).catch(() => null)
    this.cache = stat
      ? { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, size: stat.size, entries }
      : null
  }
}
