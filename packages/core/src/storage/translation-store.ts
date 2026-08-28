import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AppError } from '@tt/contracts'
import type { SaveRequest, SaveResult, StoredTranslationRecord, TranslationRecord } from '@tt/contracts'
import { nextTranslationId, parseTranslationId } from './id'
import { parseTranslationRecord, serializeTranslationRecord } from './translation-record'

export type TranslationStoreOptions = {
  /** Injectable clock for tests. */
  now?: () => Date
}

/**
 * Filesystem-backed persistence for translation records.
 *
 * Layout: `<vault>/translations/YYYY/MM/<id>.md`. The Markdown files are
 * the source of truth; this class only reads and writes them.
 */
export class TranslationStore {
  constructor(
    private readonly vaultPath: string,
    private readonly options: TranslationStoreOptions = {},
  ) {}

  private get translationsRoot(): string {
    return path.join(this.vaultPath, 'translations')
  }

  async save(draft: SaveRequest): Promise<SaveResult> {
    const now = this.options.now?.() ?? new Date()
    const monthDir = this.monthDirFor(now)
    await fs.mkdir(monthDir, { recursive: true })

    const id = nextTranslationId(await this.listIdsInMonth(now), now)
    const userEdited = draft.userTranslation !== undefined && draft.userTranslation !== draft.aiTranslation
    const record: TranslationRecord = {
      id,
      createdAt: now.toISOString(),
      sourceLanguage: draft.sourceLanguage,
      targetLanguage: draft.targetLanguage,
      mode: draft.mode,
      provider: draft.provider,
      model: draft.model,
      tags: draft.tags ?? [],
      notes: draft.notes ?? '',
      sourceText: draft.sourceText,
      aiTranslation: draft.aiTranslation,
      userTranslation: userEdited ? draft.userTranslation! : null,
    }

    const filePath = this.filePathForId(id)
    try {
      await fs.writeFile(filePath, serializeTranslationRecord(record), 'utf8')
    } catch (error) {
      throw new AppError('STORAGE_ERROR', 'Failed to write translation file', {
        path: filePath,
        cause: error instanceof Error ? error.message : String(error),
      })
    }
    return { id, filePath }
  }

  async get(id: string): Promise<StoredTranslationRecord | null> {
    const filePath = this.filePathForId(id)
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch {
      return this.findByPrefix(id)
    }
    return { ...parseTranslationRecord(raw), filePath }
  }

  /**
   * Cloud-sync services (OneDrive/Dropbox) may leave conflict copies like
   * `tr_20260829_001 (1).md`. Fall back to prefix search so records stay
   * readable without corrupting anything.
   */
  private async findByPrefix(id: string): Promise<StoredTranslationRecord | null> {
    const parsed = parseTranslationId(id)
    if (!parsed) return null
    const dir = path.join(
      this.translationsRoot,
      String(parsed.year),
      String(parsed.month).padStart(2, '0'),
    )
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return null
    }
    const candidates = entries.filter((name) => name.startsWith(id) && name.endsWith('.md')).sort()
    for (const candidate of candidates) {
      const filePath = path.join(dir, candidate)
      try {
        const raw = await fs.readFile(filePath, 'utf8')
        return { ...parseTranslationRecord(raw), filePath }
      } catch {
        continue
      }
    }
    return null
  }

  private monthDirFor(date: Date): string {
    return path.join(
      this.translationsRoot,
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, '0'),
    )
  }

  private async listIdsInMonth(date: Date): Promise<string[]> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.monthDirFor(date))
    } catch {
      return []
    }
    return entries.filter((name) => /^tr_\d{8}_\d+\.md$/.test(name)).map((name) => name.replace(/\.md$/, ''))
  }

  private filePathForId(id: string): string {
    const parsed = parseTranslationId(id)
    if (!parsed) {
      return path.join(this.translationsRoot, `${id}.md`)
    }
    return path.join(
      this.translationsRoot,
      String(parsed.year),
      String(parsed.month).padStart(2, '0'),
      `${id}.md`,
    )
  }
}
