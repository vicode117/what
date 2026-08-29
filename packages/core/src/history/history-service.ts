import type { HistoryPage, HistoryQuery, StoredTranslationRecord } from '@tt/contracts'
import type { SearchIndexService } from '../storage/search-index'
import type { TranslationStore } from '../storage/translation-store'

/**
 * Read/write facade over the translation store and the derived search
 * index. The Markdown files stay authoritative: every mutation rewrites
 * the file first, then refreshes the index entry.
 */
export class HistoryService {
  constructor(
    private readonly store: TranslationStore,
    private readonly index: SearchIndexService,
  ) {}

  list(query: HistoryQuery): Promise<HistoryPage> {
    return this.index.list(query)
  }

  get(id: string): Promise<StoredTranslationRecord | null> {
    return this.store.get(id)
  }

  async updateMeta(
    id: string,
    patch: { tags?: string[]; notes?: string; userTranslation?: string | null },
  ): Promise<StoredTranslationRecord | null> {
    const updated = await this.store.update(id, patch)
    if (updated) await this.index.upsert(updated)
    return updated
  }

  async setDeleted(id: string, deleted: boolean): Promise<StoredTranslationRecord | null> {
    const updated = await this.store.update(id, {
      deletedAt: deleted ? new Date().toISOString() : null,
    })
    if (updated) await this.index.upsert(updated)
    return updated
  }
}
