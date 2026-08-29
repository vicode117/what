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
    expect(settings.providers).toHaveLength(1)
    expect(settings.providers[0]).toMatchObject({
      id: 'prov_default',
      label: 'Default',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini'],
    })
    expect(settings.translation.sourceLanguage).toBe('auto')
    expect(settings.translation.targetLanguage).toBe('zh-CN')
    expect(settings.translation.mode).toBe('natural')
    expect(settings.training.dailySessionSize).toBe(12)
  })

  it('migrates legacy single-provider configs into the providers list', async () => {
    await writeFile(
      path.join(vault, CONFIG_FILENAME),
      JSON.stringify({
        provider: { name: 'openai-compatible', baseUrl: 'https://legacy.example.com/v1', model: 'legacy-model', timeoutMs: 30000, temperature: 0.5, maxRetries: 1 },
        translation: { sourceLanguage: 'en', targetLanguage: 'ja', mode: 'literal' },
      }),
      'utf8',
    )
    const settings = await new SettingsStore(vault).get()
    expect(settings.providers).toEqual([
      {
        id: 'prov_default',
        label: 'Default',
        baseUrl: 'https://legacy.example.com/v1',
        models: ['legacy-model'],
        timeoutMs: 30000,
        temperature: 0.5,
        maxRetries: 1,
      },
    ])
  })

  it('migrates old profiles with a single model field to the models list', async () => {
    await writeFile(
      path.join(vault, CONFIG_FILENAME),
      JSON.stringify({
        providers: [
          { id: 'prov_old', label: 'Old shape', baseUrl: 'https://old.example.com/v1', model: 'old-model', timeoutMs: 60000, temperature: 0.3, maxRetries: 2 },
        ],
      }),
      'utf8',
    )
    const settings = await new SettingsStore(vault).get()
    expect(settings.providers[0]!.models).toEqual(['old-model'])
  })

  it('persists the ordered provider list and keeps the legacy field in sync', async () => {
    const store = new SettingsStore(vault)
    await store.update({
      providers: [
        { id: 'prov_a', label: 'Primary', baseUrl: 'https://a.example.com/v1', models: ['model-a1', 'model-a2'], timeoutMs: 20000, temperature: 0.1, maxRetries: 0 },
        { id: 'prov_b', label: 'Backup', baseUrl: 'https://b.example.com/v1', models: ['model-b1'], timeoutMs: 45000, temperature: 0.7, maxRetries: 3 },
      ],
      translation: { autoSave: false },
    })
    const settings = await store.get()
    expect(settings.providers.map((provider) => provider.id)).toEqual(['prov_a', 'prov_b'])
    expect(settings.providers[0]!.models).toEqual(['model-a1', 'model-a2'])
    expect(settings.provider.baseUrl).toBe('https://a.example.com/v1')
    expect(settings.provider.model).toBe('model-a1')
    expect(settings.translation.autoSave).toBe(false)

    const raw = JSON.parse(await readFile(path.join(vault, CONFIG_FILENAME), 'utf8'))
    expect(raw.providers[1].label).toBe('Backup')
    expect(raw.translation.autoSave).toBe(false)
  })

  it('persists partial updates and keeps untouched defaults', async () => {
    const store = new SettingsStore(vault)
    await store.update({ translation: { mode: 'literal' } })
    const settings = await store.get()
    expect(settings.translation.mode).toBe('literal')
    expect(settings.translation.autoSave).toBe(true)
    expect(settings.providers[0]!.models).toEqual(['gpt-4o-mini'])
  })

  it('falls back to defaults on a corrupt file instead of crashing', async () => {
    await writeFile(path.join(vault, CONFIG_FILENAME), '{not json', 'utf8')
    const settings = await new SettingsStore(vault).get()
    expect(settings.providers[0]!.models).toEqual(['gpt-4o-mini'])
  })

  it('rejects duplicate provider ids', async () => {
    const store = new SettingsStore(vault)
    const duplicate = {
      id: 'prov_x',
      label: 'X',
      baseUrl: 'https://x.example.com/v1',
      models: ['m'],
      timeoutMs: 60000,
      temperature: 0.3,
      maxRetries: 2,
    }
    await expect(
      store.update({ providers: [duplicate, { ...duplicate, label: 'Y' }] }),
    ).rejects.toThrow()
  })
})
