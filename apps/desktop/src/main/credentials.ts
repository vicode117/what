import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import { DEFAULT_PROVIDER_ID } from '@tt/contracts'

type CredentialFile = { keys?: Record<string, string> }

/**
 * Per-provider API key storage.
 *
 * - Lives in Electron's userData directory, NOT in the Vault (which may
 *   sync to cloud drives).
 * - Encrypted with safeStorage (OS keychain) when available; otherwise a
 *   plaintext fallback is used, which is still out of the renderer's reach.
 * - Never logged, never sent to the renderer (the renderer only sees a
 *   `hasApiKeys` map).
 * - Legacy single-key files ({encrypted}|{plaintext}) are migrated to
 *   the well-known `prov_default` id on first read.
 */
export class SafeCredentialStore {
  private readonly file: () => string

  /** userDataDir is resolved lazily — it is only valid after app ready. */
  constructor(userDataDir: () => string) {
    this.file = () => path.join(userDataDir(), 'credentials.json')
  }

  async loadAll(): Promise<Record<string, string>> {
    const raw = this.readWithMigration()
    const keys: Record<string, string> = {}
    for (const [id, value] of Object.entries(raw.keys ?? {})) {
      try {
        keys[id] = this.decrypt(value)
      } catch {
        // A key that cannot be decrypted is as good as absent.
      }
    }
    return keys
  }

  async load(providerId: string): Promise<string | null> {
    const all = await this.loadAll()
    return all[providerId] ?? null
  }

  async store(providerId: string, apiKey: string): Promise<void> {
    const raw = this.readWithMigration()
    const keys = { ...(raw.keys ?? {}) }
    keys[providerId] = this.encrypt(apiKey)
    this.write({ keys })
  }

  /** Removes keys for provider ids that no longer exist. */
  async retainOnly(providerIds: readonly string[]): Promise<void> {
    const raw = this.readWithMigration()
    const keys = { ...(raw.keys ?? {}) }
    const keep = new Set(providerIds)
    let changed = false
    for (const id of Object.keys(keys)) {
      if (!keep.has(id)) {
        delete keys[id]
        changed = true
      }
    }
    if (changed) this.write({ keys })
  }

  private encrypt(apiKey: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(apiKey).toString('base64')
    }
    return `plain:${Buffer.from(apiKey, 'utf8').toString('base64')}`
  }

  private decrypt(stored: string): string {
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    }
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  }

  private readWithMigration(): CredentialFile {
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(readFileSync(this.file(), 'utf8')) as Record<string, unknown>
    } catch {
      return {}
    }
    // Legacy single-key shape → migrate under the default provider id.
    if (!raw['keys'] && (typeof raw['encrypted'] === 'string' || typeof raw['plaintext'] === 'string')) {
      const legacy =
        typeof raw['encrypted'] === 'string'
          ? (raw['encrypted'] as string)
          : `plain:${Buffer.from(raw['plaintext'] as string, 'utf8').toString('base64')}`
      const migrated: CredentialFile = { keys: { [DEFAULT_PROVIDER_ID]: legacy } }
      try {
        writeFileSync(this.file(), `${JSON.stringify(migrated, null, 2)}\n`, 'utf8')
      } catch {
        // read-only moments are fine — migration retried on next write
      }
      return migrated
    }
    return raw as CredentialFile
  }

  private write(file: CredentialFile): void {
    writeFileSync(this.file(), `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  }
}
