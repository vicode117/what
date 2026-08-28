import { promises as fs } from 'node:fs'
import path from 'node:path'
import { VaultSettingsSchema } from '@tt/contracts'
import type { UpdateSettings, VaultSettings } from '@tt/contracts'

export const CONFIG_FILENAME = 'config.json'

/**
 * Reads and writes `<vault>/config.json`.
 *
 * This file holds non-secret settings only (provider endpoint/model,
 * language defaults). A missing or corrupt file falls back to defaults
 * so the app keeps working with cloud-synced vaults that may briefly
 * expose conflict states.
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
      return VaultSettingsSchema.parse({})
    }
    try {
      return VaultSettingsSchema.parse(JSON.parse(raw))
    } catch (error) {
      console.warn(
        '[settings] config.json is invalid; using defaults',
        error instanceof Error ? error.message : error,
      )
      return VaultSettingsSchema.parse({})
    }
  }

  async update(patch: UpdateSettings): Promise<VaultSettings> {
    const current = await this.get()
    const next: VaultSettings = {
      provider: { ...current.provider, ...(patch.provider ?? {}) },
      translation: { ...current.translation, ...(patch.translation ?? {}) },
    }
    const validated = VaultSettingsSchema.parse(next)
    await fs.mkdir(this.vaultPath, { recursive: true })
    await fs.writeFile(this.configFile, `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
    return validated
  }
}
