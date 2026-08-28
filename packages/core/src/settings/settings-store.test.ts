import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONFIG_FILENAME, SettingsStore } from './settings-store'

let vault: string

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), 'tt-settings-'))
})

afterEach(async () => {
  await rm(vault, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('returns defaults when config.json is missing', async () => {
    const settings = await new SettingsStore(vault).get()
    expect(settings.provider.baseUrl).toBe('https://api.openai.com/v1')
    expect(settings.provider.timeoutMs).toBe(60000)
    expect(settings.translation.sourceLanguage).toBe('auto')
    expect(settings.translation.targetLanguage).toBe('zh-CN')
    expect(settings.translation.mode).toBe('natural')
  })

  it('persists partial updates and keeps untouched defaults', async () => {
    const store = new SettingsStore(vault)
    await store.update({ provider: { model: 'my-model' } })
    const settings = await store.get()
    expect(settings.provider.model).toBe('my-model')
    expect(settings.provider.temperature).toBe(0.3)

    const raw = JSON.parse(await readFile(path.join(vault, CONFIG_FILENAME), 'utf8'))
    expect(raw.provider.model).toBe('my-model')
  })

  it('falls back to defaults on a corrupt file instead of crashing', async () => {
    await writeFile(path.join(vault, CONFIG_FILENAME), '{not json', 'utf8')
    const settings = await new SettingsStore(vault).get()
    expect(settings.provider.model).toBe('gpt-4o-mini')
  })
})
