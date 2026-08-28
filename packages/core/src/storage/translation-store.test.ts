import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TranslationStore } from './translation-store'

let vault: string

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), 'tt-store-'))
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

function storeFor(day: Date): TranslationStore {
  return new TranslationStore(vault, { now: () => day })
}

describe('TranslationStore', () => {
  it('saves into translations/YYYY/MM with sequential ids', async () => {
    const store = storeFor(new Date(2026, 7, 29, 10, 0, 0))
    const first = await store.save(draft)
    const second = await store.save(draft)
    expect(first.id).toBe('tr_20260829_001')
    expect(second.id).toBe('tr_20260829_002')
    expect(first.filePath).toContain(path.join('translations', '2026', '08'))
    const raw = await readFile(first.filePath, 'utf8')
    expect(raw).toContain('## Source')
    expect(raw).toContain('## Translation')
  })

  it('treats an identical user text as unedited', async () => {
    const store = storeFor(new Date(2026, 7, 29))
    const { id } = await store.save({ ...draft, userTranslation: draft.aiTranslation })
    const record = await store.get(id)
    expect(record?.userTranslation).toBeNull()
    expect(record?.id).toBe(id)
  })

  it('never overwrites the AI translation with the user correction', async () => {
    const store = storeFor(new Date(2026, 7, 29))
    const { id } = await store.save({ ...draft, userTranslation: '修正后的译文' })
    const record = await store.get(id)
    expect(record?.aiTranslation).toBe('你好，世界')
    expect(record?.userTranslation).toBe('修正后的译文')
  })

  it('returns null for unknown ids', async () => {
    const store = storeFor(new Date(2026, 7, 29))
    expect(await store.get('tr_20260829_999')).toBeNull()
  })

  it('reads cloud-sync conflict copies by id prefix', async () => {
    const store = storeFor(new Date(2026, 7, 29))
    const { id, filePath } = await store.save(draft)
    const conflictPath = filePath.replace(/\.md$/, ' (1).md')
    await writeFile(conflictPath, await readFile(filePath, 'utf8'), 'utf8')
    await unlink(filePath)

    const record = await store.get(id)
    expect(record?.id).toBe(id)
    expect(record?.filePath).toBe(conflictPath)
  })
})
