import { z } from 'zod'
import { AUTO_DETECT } from './languages'
import { LanguageCodeSchema, SourceLanguageSchema, TranslationModeSchema } from './translation'

/**
 * AI provider configuration. OpenAI-compatible first.
 *
 * NOTE: the API key is deliberately NOT part of this schema.
 * Credentials live in the Electron Main process (encrypted via
 * safeStorage) and are never sent to the renderer.
 */
export const ProviderConfigSchema = z.object({
  name: z.string().min(1).default('openai-compatible'),
  baseUrl: z.url().default('https://api.openai.com/v1'),
  model: z.string().min(1).default('gpt-4o-mini'),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  temperature: z.number().min(0).max(2).default(0.3),
  maxRetries: z.number().int().min(0).max(10).default(2),
})

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

export const TranslationDefaultsSchema = z.object({
  sourceLanguage: SourceLanguageSchema.default(AUTO_DETECT),
  targetLanguage: LanguageCodeSchema.default('zh-CN'),
  mode: TranslationModeSchema.default('natural'),
  /** Automatically persist every successful translation to the Vault. */
  autoSave: z.boolean().default(true),
})

export type TranslationDefaults = z.infer<typeof TranslationDefaultsSchema>

export const TrainingSettingsSchema = z.object({
  dailySessionSize: z.number().int().min(6).max(30).default(12),
})

export type TrainingSettings = z.infer<typeof TrainingSettingsSchema>

/** Settings persisted in `<vault>/config.json` (no secrets). */
export const VaultSettingsSchema = z.object({
  provider: ProviderConfigSchema.prefault({}),
  translation: TranslationDefaultsSchema.prefault({}),
  training: TrainingSettingsSchema.prefault({}),
})

export type VaultSettings = z.infer<typeof VaultSettingsSchema>

/** Partial update payload sent from the renderer. */
export const UpdateSettingsSchema = z.object({
  provider: ProviderConfigSchema.partial().optional(),
  apiKey: z.string().min(1).max(1000).optional(),
  vaultPath: z.string().min(1).optional(),
  translation: TranslationDefaultsSchema.partial().optional(),
  training: TrainingSettingsSchema.partial().optional(),
})

export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>

/** What the renderer may see. The API key itself is never included. */
export type SettingsView = VaultSettings & {
  vaultPath: string
  hasApiKey: boolean
}
