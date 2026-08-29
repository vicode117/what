import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROVIDER_ID, VaultSettingsSchema } from '@tt/contracts'
import type { UpdateSettings, VaultSettings } from '@tt/contracts'

export const CONFIG_FILENAME = 'config.json'

/**
 * Reads and writes `<vault>/config.json`.
 *
 * This file holds non-secret settings only (provider endpoints/models,
 * language defaults). A missing or corrupt file falls back to defaults
 * so the app keeps working with cloud-synced vaults that may briefly
 * expose conflict states.
 *
 * Legacy single-provider configs (`provider` field, no `providers`)
 * are migrated on read into a one-entry `providers` list with the
 * well-known id `prov_default`; on write, providers[0] is mirrored
 * back into the legacy field.
 */
export class SettingsStore {
  constructor(private readonly vaultPath: string) {}

  private get configFile(): string {
    return path.join(this.vaultPath, CONFIG_FILENAME)
  }

  async get(): Promise<VaultSettings> {
    let raw: string
    try {
      raw = await fs.readFile(this.configFile, 'utf8')
    } catch {
      return this.normalize(VaultSettingsSchema.parse({}))
    }
    try {
      return this.normalize(VaultSettingsSchema.parse(JSON.parse(raw)))
    } catch (error) {
      console.warn(
        '[settings] config.json is invalid; using defaults',
        error instanceof Error ? error.message : error,
      )
      return this.normalize(VaultSettingsSchema.parse({}))
    }
  }

  async update(patch: UpdateSettings): Promise<VaultSettings> {
    const current = await this.get()
    const providers = patch.providers ?? current.providers
    const next: VaultSettings = {
      providers,
      provider: legacyProviderFrom(providers[0]),
      translation: { ...current.translation, ...(patch.translation ?? {}) },
      training: { ...current.training, ...(patch.training ?? {}) },
    }
    const validated = VaultSettingsSchema.parse(next)
    await fs.mkdir(this.vaultPath, { recursive: true })
    await fs.writeFile(this.configFile, `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
    return validated
  }

  private normalize(settings: VaultSettings): VaultSettings {
    if (settings.providers.length > 0) return settings
    return {
      ...settings,
      providers: [
        {
          id: DEFAULT_PROVIDER_ID,
          label: 'Default',
          baseUrl: settings.provider.baseUrl,
          model: settings.provider.model,
          timeoutMs: settings.provider.timeoutMs,
          temperature: settings.provider.temperature,
          maxRetries: settings.provider.maxRetries,
        },
      ],
    }
  }
}

function legacyProviderFrom(provider: VaultSettings['providers'][number] | undefined): VaultSettings['provider'] {
  return {
    name: 'openai-compatible',
    baseUrl: provider?.baseUrl ?? 'https://api.openai.com/v1',
    model: provider?.model ?? 'gpt-4o-mini',
    timeoutMs: provider?.timeoutMs ?? 60000,
    temperature: provider?.temperature ?? 0.3,
    maxRetries: provider?.maxRetries ?? 2,
  }
}
