import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'

/**
 * Provider API key storage.
 *
 * - Lives in Electron's userData directory, NOT in the Vault (which may
 *   sync to cloud drives).
 * - Encrypted with safeStorage (OS keychain) when available; otherwise a
 *   plaintext fallback is used, which is still out of the renderer's reach.
 * - Never logged, never sent to the renderer (the renderer only sees a
 *   `hasApiKey` boolean).
 */
export class SafeCredentialStore {
  private readonly file: () => string

  /** userDataDir is resolved lazily — it is only valid after app ready. */
  constructor(userDataDir: () => string) {
    this.file = () => path.join(userDataDir(), 'credentials.json')
  }

  async load(): Promise<string | null> {
    let raw: string
    try {
      raw = readFileSync(this.file(), 'utf8')
    } catch {
      return null
    }
    try {
      const parsed = JSON.parse(raw) as { encrypted?: string; plaintext?: string }
      if (parsed.encrypted) {
        return safeStorage.decryptString(Buffer.from(parsed.encrypted, 'base64'))
      }
      return parsed.plaintext ?? null
    } catch {
      return null
    }
  }

  async store(apiKey: string): Promise<void> {
    const payload =
      safeStorage.isEncryptionAvailable()
        ? { encrypted: safeStorage.encryptString(apiKey).toString('base64') }
        : { plaintext: apiKey }
    writeFileSync(this.file(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }
}
