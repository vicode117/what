import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HistoryService } from './history-service'
import { SearchIndexService } from '../storage/search-index'
import { TranslationStore } from '../storage/translation-store'

let vault: string

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), 'tt-history-'))
})

afterEach(async () => {
  await rm(vault, { recursive: true, force: true })
})

const draft = {
  sourceText: 'Hello world',
  aiTranslation: '你好，世界',
  sourceLanguage: 'en' as const,
  targetLanguage: 'zh-CN' as const,
  mode: 'natural' as const,
  provider: 'openai-compatible',
  model: 'example-model',
}

function makeService(): { history: HistoryService; store: TranslationStore } {
  const store = new TranslationStore(vault, { now: () => new Date(2026, 7, 29, 9, 0, 0) })
  return { history: new HistoryService(store, new SearchIndexService(vault)), store }
}

describe('HistoryService', () => {
  it('updates tags and notes and reflects them in the index', async () => {
    const { history, store } = makeService()
    const { id } = await store.save(draft)

    const updated = await history.updateMeta(id, { tags: ['software'], notes: 'note here' })
    expect(updated?.tags).toEqual(['software'])
    expect(updated?.notes).toBe('note here')

    const listed = await history.list({ text: 'note here', limit: 10 })
    expect(listed.items.map((r) => r.id)).toContain(id)
  })

  it('soft-deletes and restores without losing the file', async () => {
    const { history, store } = makeService()
    const { id } = await store.save(draft)

    const deleted = await history.setDeleted(id, true)
    expect(deleted?.deletedAt).not.toBeNull()
    expect((await history.list({ limit: 10 })).total).toBe(0)
    expect((await history.list({ limit: 10, includeDeleted: true })).total).toBe(1)

    const restored = await history.setDeleted(id, false)
    expect(restored?.deletedAt).toBeNull()
    expect((await history.list({ limit: 10 })).total).toBe(1)

    // The AI translation and source text survive the cycle untouched.
    const record = await history.get(id)
    expect(record?.aiTranslation).toBe('你好，世界')
  })
})
