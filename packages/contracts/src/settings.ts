import { z } from 'zod'
import { AUTO_DETECT } from './languages'
import { LanguageCodeSchema, SourceLanguageSchema, TranslationModeSchema } from './translation'

/**
 * Legacy single-provider settings. Kept for reading old config.json
 * files; it is migrated into `providers` on load and kept in sync with
 * providers[0] on write.
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

/**
 * A configurable model provider. Array order = priority order.
 * `models` is an ordered list — attempts run provider-major,
 * model-minor (P1/M1 → P1/M2 → P2/M1 …).
 */
export const ProviderProfileSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  baseUrl: z.url(),
  models: z.array(z.string().min(1).max(200)).min(1).max(20),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  temperature: z.number().min(0).max(2).default(0.3),
  maxRetries: z.number().int().min(0).max(10).default(2),
})

export type ProviderProfile = z.infer<typeof ProviderProfileSchema>

export const ProviderProfilesSchema = z
  .array(ProviderProfileSchema)
  .max(10)
  .superRefine((list, ctx) => {
    const seen = new Set<string>()
    for (const [index, provider] of list.entries()) {
      if (seen.has(provider.id)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate provider id: ${provider.id}`, path: [index, 'id'] })
      }
      seen.add(provider.id)
      if (provider.models.length === 0) {
        ctx.addIssue({ code: 'custom', message: `Provider "${provider.label}" needs at least one model`, path: [index, 'models'] })
      }
    }
  })

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
  /** Ordered by priority: index 0 is tried first; failures fall through. */
  providers: ProviderProfilesSchema.prefault([]),
  provider: ProviderConfigSchema.prefault({}),
  translation: TranslationDefaultsSchema.prefault({}),
  training: TrainingSettingsSchema.prefault({}),
})

export type VaultSettings = z.infer<typeof VaultSettingsSchema>

/** Partial update payload sent from the renderer. */
export const ProviderKeyInputSchema = z.object({
  providerId: z.string().min(1).max(64),
  apiKey: z.string().min(1).max(1000),
})

export type ProviderKeyInput = z.infer<typeof ProviderKeyInputSchema>

export const UpdateSettingsSchema = z.object({
  /** Full ordered list replacing the existing providers. */
  providers: ProviderProfilesSchema.optional(),
  /** API keys to store for provider ids (only sent when changed). */
  providerKeys: z.array(ProviderKeyInputSchema).max(10).optional(),
  vaultPath: z.string().min(1).optional(),
  translation: TranslationDefaultsSchema.partial().optional(),
  training: TrainingSettingsSchema.partial().optional(),
})

export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>

/** What the renderer may see. API keys themselves are never included. */
export type SettingsView = VaultSettings & {
  vaultPath: string
  /** provider id → whether a key is stored. */
  hasApiKeys: Record<string, boolean>
}

export const DEFAULT_PROVIDER_ID = 'prov_default'
