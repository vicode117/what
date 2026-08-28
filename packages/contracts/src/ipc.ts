import { z } from 'zod'
import type { ErrorPayload } from './errors'
import { LanguageCodeSchema, SourceLanguageSchema, TranslationModeSchema } from './translation'

/** IPC channel names. Preload only exposes these via domain APIs. */
export const IPC = {
  translate: 'translation:translate',
  save: 'translation:save',
  getRecord: 'history:get',
  historyList: 'history:list',
  historyUpdate: 'history:update',
  historyDelete: 'history:delete',
  historyRestore: 'history:restore',
  historyAnalyze: 'history:analyze',
  memoryList: 'memory:list',
  memoryUpdate: 'memory:update',
  memoryDelete: 'memory:delete',
  glossaryList: 'glossary:list',
  glossaryAdd: 'glossary:add',
  glossaryRemove: 'glossary:remove',
  trainingGetToday: 'training:get-today',
  trainingSubmit: 'training:submit',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChooseVault: 'settings:choose-vault',
  indexRebuild: 'index:rebuild',
} as const

/** Every IPC reply is an explicit result envelope — never a thrown raw error. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: ErrorPayload }

export const TranslateRequestSchema = z.object({
  text: z.string().min(1).max(20000),
  sourceLanguage: SourceLanguageSchema,
  targetLanguage: LanguageCodeSchema,
  mode: TranslationModeSchema,
})

export type TranslateRequest = z.infer<typeof TranslateRequestSchema>

export const UsageSchema = z.object({
  promptTokens: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
})

export type Usage = z.infer<typeof UsageSchema>

export const TranslateResultSchema = z.object({
  translatedText: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  usage: UsageSchema.optional(),
  durationMs: z.number().int().min(0),
})

export type TranslateResult = z.infer<typeof TranslateResultSchema>

export const SaveRequestSchema = z.object({
  sourceText: z.string().min(1).max(50000),
  aiTranslation: z.string().min(1).max(100000),
  /** Final text after user editing; omit when unchanged. */
  userTranslation: z.string().max(100000).optional(),
  sourceLanguage: SourceLanguageSchema,
  targetLanguage: LanguageCodeSchema,
  mode: TranslationModeSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
  notes: z.string().max(20000).optional(),
})

export type SaveRequest = z.infer<typeof SaveRequestSchema>

export const SaveResultSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
})

export type SaveResult = z.infer<typeof SaveResultSchema>

export const GetRecordRequestSchema = z.object({
  id: z.string().min(1).max(200),
})

export type GetRecordRequest = z.infer<typeof GetRecordRequestSchema>
