import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { HistoryQuery, StoredTranslationRecord, TranslationRecord } from '@tt/contracts'
import { finalTranslation } from '@tt/contracts'
import { parseTranslationRecord } from './translation-record'

/**
 * Derived full-text index over the Vault's translation Markdown files,
 * stored at `<vault>/.app/index/search.json`.
 *
 * It is a cache ONLY: deleting it is always safe because `rebuild()`
 * reconstructs it from the source files. Scoring is a transparent
 * token/substring match that works for both space-separated languages
 * and CJK text — FlexSearch would add value only at much larger scale.
 */

const INDEX_DIR = path.join('.app', 'index')
const INDEX_FILENAME = 'search.json'

export type SearchIndexEntry = {
  id: string
  filePath: string
  createdAt: string
  deletedAt: string | null
  analyzedAt: string | null
  sourceLanguage: string
  targetLanguage: string
  mode: string
  provider: string
  model: string
  tags: string[]
  sourceText: string
  finalText: string
  aiText: string
  notes: string
}

type SearchIndexFile = {
  version: 1
  builtAt: string
  entries: Record<string, SearchIndexEntry>
}

const CJK_PATTERN = /[\u4e00-\u9fff\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af]/

export function hasCjk(text: string): boolean {
  return CJK_PATTERN.test(text)
}

/** Lowercased tokens; punctuation on token edges is stripped. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((token) => token.length > 0)
}

export function entryHaystack(entry: SearchIndexEntry): string {
  return [entry.sourceText, entry.finalText, entry.aiText, entry.notes, entry.tags.join(' ')]
    .join('\n')
    .toLowerCase()
}

/** Returns a relevance score, or null when any token is missing (AND semantics). */
export function matchScore(entry: SearchIndexEntry, tokens: string[]): number | null {
  if (tokens.length === 0) return 0
  const source = entry.sourceText.toLowerCase()
  const translation = `${entry.finalText}\n${entry.aiText}`.toLowerCase()
  const notes = entry.notes.toLowerCase()
  const tags = entry.tags.join(' ').toLowerCase()
  const haystack = entryHaystack(entry)

  let score = 0
  for (const token of tokens) {
    const field = hasCjk(token)
      ? [source, translation, notes, tags, haystack]
      : [source, translation, notes, tags]
    let tokenScore = 0
    if (field[0]?.includes(token)) tokenScore += 3
    if (field[1]?.includes(token)) tokenScore += 3
    if (field[2]?.includes(token)) tokenScore += 2
    if (field[3]?.includes(token)) tokenScore += 2
    if (tokenScore === 0) {
      // CJK has no word boundaries: fall back to a whole-haystack substring hit.
      if (hasCjk(token) && haystack.includes(token)) tokenScore = 1
      else return null
    }
    score += tokenScore
  }
  return score
}

export type SearchIndexOptions = {
  /** Injectable clock for tests. */
  now?: () => Date
}

export class SearchIndexService {
  private entries = new Map<string, SearchIndexEntry>()
  private loaded = false

  constructor(
    private readonly vaultPath: string,
    private readonly options: SearchIndexOptions = {},
  ) {}

  private get indexFile(): string {
    return path.join(this.vaultPath, INDEX_DIR, INDEX_FILENAME)
  }

  private get translationsRoot(): string {
    return path.join(this.vaultPath, 'translations')
  }

  /** Loads the index from disk, rebuilding it when missing or unreadable. */
  async ensure(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = await fs.readFile(this.indexFile, 'utf8')
      const parsed = JSON.parse(raw) as SearchIndexFile
      if (parsed.version !== 1 || typeof parsed.entries !== 'object' || parsed.entries === null) {
        throw new Error('unsupported index version')
      }
      this.entries = new Map(Object.entries(parsed.entries))
    } catch {
      await this.rebuild()
    }
    this.loaded = true
  }

  /** Rebuilds the index from all translation Markdown files. Returns the entry count. */
  async rebuild(): Promise<number> {
    const entries = new Map<string, SearchIndexEntry>()
    const files = await this.listTranslationFiles()
    for (const filePath of files) {
      try {
        const raw = await fs.readFile(filePath, 'utf8')
        const record = parseTranslationRecord(raw)
        entries.set(record.id, toEntry(record, filePath))
      } catch {
        // unreadable/corrupt file — skip; the file itself is never touched
      }
    }    this.entries = entries
    await this.persist()
    this.loaded = true
    return entries.size
  }

  async upsert(record: StoredTranslationRecord): Promise<void> {
    this.entries.set(record.id, toEntry(record, record.filePath))
    await this.persist()
  }

  async remove(id: string): Promise<void> {
    if (this.entries.delete(id)) {
      await this.persist()
    }
  }

  /** Removes the entry whose file was deleted without needing a record parse. */
  async removeByFilePath(filePath: string): Promise<void> {
    const normalized = path.normalize(filePath)
    for (const [id, entry] of this.entries) {
      if (path.normalize(entry.filePath) === normalized) {
        this.entries.delete(id)
        await this.persist()
        return
      }
    }
  }

  async list(query: HistoryQuery): Promise<{ items: StoredTranslationRecord[]; total: number }> {
    await this.ensure()
    const tokens = query.text ? tokenize(query.text) : []
    const includeDeleted = query.includeDeleted === true
    const offset = query.offset ?? 0
    const limit = query.limit ?? 50

    const matches: { entry: SearchIndexEntry; score: number }[] = []
    for (const entry of this.entries.values()) {
      if (!includeDeleted && entry.deletedAt !== null) continue
      if (query.sourceLanguage && entry.sourceLanguage !== query.sourceLanguage) continue
      if (query.targetLanguage && entry.targetLanguage !== query.targetLanguage) continue
      if (query.tag && !entry.tags.includes(query.tag)) continue
      const day = entry.createdAt.slice(0, 10)
      if (query.from && day < query.from) continue
      if (query.to && day > query.to) continue
      const score = matchScore(entry, tokens)
      if (score === null) continue
      matches.push({ entry, score })
    }

    matches.sort((a, b) => {
      if (tokens.length > 0 && b.score !== a.score) return b.score - a.score
      return b.entry.createdAt.localeCompare(a.entry.createdAt)
    })

    const items = matches
      .slice(offset, offset + limit)
      .map(({ entry }) => fromEntry(entry))
    return { items, total: matches.length }
  }

  /**
   * Best-overlap similarity for translation-memory context. Unlike the
   * AND search above, partial coverage is ranked, not filtered out.
   */
  async similar(text: string, limit = 3, minCoverage = 0.2): Promise<StoredTranslationRecord[]> {
    await this.ensure()
    const tokens = tokenize(text).slice(0, 12)
    if (tokens.length === 0) return []
    const scored: { entry: SearchIndexEntry; coverage: number }[] = []
    for (const entry of this.entries.values()) {
      if (entry.deletedAt !== null) continue
      const source = entry.sourceText.toLowerCase()
      const haystack = entryHaystack(entry)
      let hits = 0
      for (const token of tokens) {
        if (source.includes(token) || haystack.includes(token)) hits += 1
      }
      const coverage = hits / tokens.length
      if (coverage >= minCoverage) scored.push({ entry, coverage })
    }
    scored.sort((a, b) => b.coverage - a.coverage)
    return scored.slice(0, limit).map(({ entry }) => fromEntry(entry))
  }

  size(): number {
    return this.entries.size
  }

  private async persist(): Promise<void> {
    const file: SearchIndexFile = {
      version: 1,
      builtAt: (this.options.now?.() ?? new Date()).toISOString(),
      entries: Object.fromEntries(this.entries),
    }
    await fs.mkdir(path.dirname(this.indexFile), { recursive: true })
    await fs.writeFile(this.indexFile, JSON.stringify(file, null, 2), 'utf8')
  }

  private async listTranslationFiles(): Promise<string[]> {
    const files: string[] = []
    async function walk(dir: string): Promise<void> {
      const dirEntries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
      if (dirEntries === null) return
      for (const entry of dirEntries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (entry.isFile() && /^tr_\d{8}_\d+.*\.md$/.test(entry.name)) files.push(full)
      }
    }
    await walk(this.translationsRoot)
    return files
  }
}

function toEntry(record: TranslationRecord, filePath: string): SearchIndexEntry {
  return {
    id: record.id,
    filePath,
    createdAt: record.createdAt,
    deletedAt: record.deletedAt,
    analyzedAt: record.analyzedAt,
    sourceLanguage: record.sourceLanguage,
    targetLanguage: record.targetLanguage,
    mode: record.mode,
    provider: record.provider,
    model: record.model,
    tags: record.tags,
    sourceText: record.sourceText,
    finalText: finalTranslation(record),
    aiText: record.aiTranslation,
    notes: record.notes,
  }
}

function fromEntry(entry: SearchIndexEntry): StoredTranslationRecord {
  const userTranslation = entry.finalText === entry.aiText ? null : entry.finalText
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    sourceLanguage: entry.sourceLanguage as StoredTranslationRecord['sourceLanguage'],
    targetLanguage: entry.targetLanguage as StoredTranslationRecord['targetLanguage'],
    mode: entry.mode as StoredTranslationRecord['mode'],
    provider: entry.provider,
    model: entry.model,
    tags: entry.tags,
    notes: entry.notes,
    sourceText: entry.sourceText,
    aiTranslation: entry.aiText,
    userTranslation,
    analyzedAt: entry.analyzedAt,
    deletedAt: entry.deletedAt,
    filePath: entry.filePath,
  }
}
