import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SearchIndexService, hasCjk, matchScore, tokenize } from './search-index'
import { TranslationStore } from './translation-store'

let vault: string

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), 'tt-index-'))
})

afterEach(async () => {
  await rm(vault, { recursive: true, force: true })
})

const draft = (sourceText: string, aiTranslation: string, tags: string[] = []) => ({
  sourceText,
  aiTranslation,
  sourceLanguage: 'en' as const,
  targetLanguage: 'zh-CN' as const,
  mode: 'natural' as const,
  provider: 'openai-compatible',
  model: 'example-model',
  tags,
})

async function seed(): Promise<{ a: string; b: string; c: string }> {
  let clock = new Date(2026, 7, 29, 9, 0, 0)
  const store = new TranslationStore(vault, { now: () => clock })
  const a = await store.save(draft('The application should remain maintainable.', '这个应用应该保持可维护性。', ['software']))
  clock = new Date(2026, 7, 29, 9, 5, 0)
  const b = await store.save(draft('Wire harness traceability matters.', '线束可追溯性很重要。', ['work']))
  clock = new Date(2026, 7, 29, 9, 10, 0)
  const c = await store.save(draft('Deleted item about weather.', '关于天气的已删除条目。'))
  await store.update(a.id, { notes: 'favorite example' })
  await store.update(c.id, { deletedAt: '2026-08-29T10:00:00.000Z' })
  return { a: a.id, b: b.id, c: c.id }
}

describe('tokenize / matchScore', () => {
  it('tokenizes and strips edge punctuation', () => {
    expect(tokenize('Hello, WORLD!')).toEqual(['hello', 'world'])
  })

  it('detects CJK', () => {
    expect(hasCjk('应用')).toBe(true)
    expect(hasCjk('app')).toBe(false)
  })

  it('requires all tokens (AND) and scores field weights', () => {
    const entry = {
      id: 'x', filePath: 'x', createdAt: '', deletedAt: null, analyzedAt: null,
      sourceLanguage: 'en', targetLanguage: 'zh-CN', mode: 'natural',
      provider: 'openai-compatible', model: 'example-model', tags: [],
      sourceText: 'maintainable application', finalText: '可维护', aiText: '可维护', notes: '',
    }
    expect(matchScore(entry, ['maintainable'])).not.toBeNull()
    expect(matchScore(entry, ['maintainable', 'missing'])).toBeNull()
    const sourceHit = matchScore(entry, ['maintainable'])
    const notesOnly = matchScore({ ...entry, sourceText: 'x', notes: 'maintainable' }, ['maintainable'])
    expect(sourceHit!).toBeGreaterThan(notesOnly!)
  })
})

describe('SearchIndexService', () => {
  it('rebuilds from source files and excludes deleted records', async () => {
    const ids = await seed()
    const index = new SearchIndexService(vault)
    const count = await index.rebuild()
    expect(count).toBe(3)

    const page = await index.list({ limit: 10 })
    expect(page.total).toBe(2)
    expect(page.items.map((r) => r.id)).toEqual([ids.b, ids.a])
  })

  it('finds records by text in source and translation, ranked', async () => {
    const ids = await seed()
    const index = new SearchIndexService(vault)
    await index.rebuild()

    const bySource = await index.list({ text: 'traceability', limit: 10 })
    expect(bySource.items.map((r) => r.id)).toEqual([ids.b])

    const byTranslation = await index.list({ text: '线束', limit: 10 })
    expect(byTranslation.items.map((r) => r.id)).toEqual([ids.b])

    const byNotes = await index.list({ text: 'favorite', limit: 10 })
    expect(byNotes.items.map((r) => r.id)).toEqual([ids.a])
  })

  it('applies language, tag and date filters', async () => {
    const ids = await seed()
    const index = new SearchIndexService(vault)
    await index.rebuild()

    expect((await index.list({ tag: 'work', limit: 10 })).items.map((r) => r.id)).toEqual([ids.b])
    expect((await index.list({ sourceLanguage: 'en', limit: 10 })).total).toBe(2)
    expect((await index.list({ from: '2026-08-30', limit: 10 })).total).toBe(0)
    expect((await index.list({ to: '2026-08-29', limit: 10 })).total).toBe(2)
  })

  it('reconstructs entries without re-reading files', async () => {
    await seed()
    const index = new SearchIndexService(vault)
    await index.rebuild()
    const item = (await index.list({ limit: 1 })).items[0]!
    expect(item.sourceText.length).toBeGreaterThan(0)
    expect(item.filePath).toContain('translations')
    expect(item.deletedAt).toBeNull()
  })

  it('recovers when the index file is deleted (rebuildable)', async () => {
    await seed()
    const index = new SearchIndexService(vault)
    await index.rebuild()
    await rm(path.join(vault, '.app'), { recursive: true, force: true })
    const fresh = new SearchIndexService(vault)
    const page = await fresh.list({ limit: 10 })
    expect(page.total).toBe(2)
  })
})
