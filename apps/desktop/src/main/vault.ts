import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { AppError } from '@tt/contracts'

/**
 * The Vault location is an application-level setting (it cannot live
 * inside the vault itself). It is stored in Electron's userData
 * directory. The vault may sit inside OneDrive/iCloud/Dropbox/git —
 * sync is the user's choice, not ours.
 */
const APP_CONFIG_FILE = 'app-config.json'

type AppConfig = { vaultPath?: string }

let cachedVaultPath: string | null = null

function appConfigPath(): string {
  return path.join(app.getPath('userData'), APP_CONFIG_FILE)
}

function readAppConfig(): AppConfig {
  try {
    return JSON.parse(readFileSync(appConfigPath(), 'utf8')) as AppConfig
  } catch {
    return {}
  }
}

export function getVaultPath(): string {
  if (cachedVaultPath !== null) return cachedVaultPath
  cachedVaultPath = readAppConfig().vaultPath ?? path.join(app.getPath('documents'), 'TranslationVault')
  return cachedVaultPath
}

export function setVaultPath(vaultPath: string): string {
  if (!path.isAbsolute(vaultPath)) {
    throw new AppError('CONFIG_ERROR', 'Vault path must be an absolute path')
  }
  mkdirSync(vaultPath, { recursive: true })
  const config: AppConfig = { ...readAppConfig(), vaultPath }
  writeFileSync(appConfigPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  cachedVaultPath = vaultPath
  return vaultPath
}
