import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import {
  AppError,
  errorToPayload,
  GetRecordRequestSchema,
  GlossaryEntrySchema,
  HistoryQuerySchema,
  HistoryUpdateSchema,
  IdRequestSchema,
  MemoryQuerySchema,
  MemoryUpdateSchema,
  IPC,
  SaveRequestSchema,
  SubmitAnswerSchema,
  TermRequestSchema,
  TranslateRequestSchema,
  TranslateStreamRequestSchema,
  UpdateSettingsSchema,
} from '@tt/contracts'
import type { IpcResult, SettingsView } from '@tt/contracts'
import {
  AnswerEvaluator,
  ContextRetriever,
  HistoryService,
  LearningExtractor,
  LearningPointStore,
  MemoryService,
  GlossaryStore,
  OpenAiCompatibleClient,
  PromptManager,
  ReviewLog,
  SearchIndexService,
  SettingsStore,
  SimpleScheduler,
  TrainingService,
  TranslationService,
  TranslationStore,
  WeightedSelectionStrategy,
  parseTranslationRecord,
} from '@tt/core'
import type { LlmClient, ProviderRuntime } from '@tt/core'
import { SafeCredentialStore } from './credentials'
import { builtinPromptsDir } from './paths'
import { VaultWatcher } from './watcher'
import { getVaultPath, setVaultPath } from './vault'

function handle<T>(
  channel: string,
  fn: (payload: unknown, event: IpcMainInvokeEvent) => Promise<T>,
): void {
  ipcMain.handle(channel, async (event, payload: unknown): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn(payload, event) }
    } catch (error) {
      const errorPayload = errorToPayload(error)
      // Privacy: log code/message only — never translation content or API keys.
      console.error(`[ipc] ${channel} failed: ${errorPayload.code} ${errorPayload.message}`)
      return { ok: false, error: errorPayload }
    }
  })
}

export function registerIpcHandlers(): void {
  const credentials = new SafeCredentialStore(() => app.getPath('userData'))
  const watcher = new VaultWatcher((files) => void refreshIndexFiles(files))

  // The index is a long-lived derived cache; it is rebuilt automatically
  // when the Vault location changes.
  let indexCache: { vaultPath: string; index: SearchIndexService } | null = null
  let memoryCache: { vaultPath: string; memory: MemoryService; points: LearningPointStore } | null = null
  function getIndex(): SearchIndexService {
    const vaultPath = getVaultPath()
    if (!indexCache || indexCache.vaultPath !== vaultPath) {
      indexCache = { vaultPath, index: new SearchIndexService(vaultPath) }
      void watcher.watch(vaultPath).catch(() => undefined)
    }
    return indexCache.index
  }
  function getMemory(): MemoryService {
    const vaultPath = getVaultPath()
    if (!memoryCache || memoryCache.vaultPath !== vaultPath) {
      const store = new LearningPointStore(vaultPath)
      const prompts = new PromptManager([path.join(vaultPath, 'prompts'), builtinPromptsDir()])
      memoryCache = {
        vaultPath,
        memory: new MemoryService(store, new LearningExtractor(prompts)),
        points: store,
      }
    }
    return memoryCache.memory
  }
  function getPoints(): LearningPointStore {
    getMemory()
    return memoryCache!.points
  }

  /** AI client for optional enhancement paths; null when no key is set. */
  async function createClientOrNull(): Promise<LlmClient | null> {
    const providers = await buildProviderRuntimes()
    return providers[0]?.client ?? null
  }

  function getTraining(): TrainingService {
    const vaultPath = getVaultPath()
    return new TrainingService({
      points: getPoints(),
      history: new HistoryService(new TranslationStore(vaultPath), getIndex()),
      scheduler: new SimpleScheduler(),
      strategy: new WeightedSelectionStrategy(),
      evaluator: new AnswerEvaluator({
        prompts: new PromptManager([path.join(vaultPath, 'prompts'), builtinPromptsDir()]),
        clientProvider: createClientOrNull,
      }),
      reviewLog: new ReviewLog(vaultPath),
      sessionsDir: path.join(vaultPath, 'training', 'sessions'),
    })
  }

  async function refreshIndexFiles(files: string[]): Promise<void> {
    const index = getIndex()
    for (const file of files) {
      if (!file.endsWith('.md')) continue
      try {
        const raw = await fs.readFile(file, 'utf8')
        const record = parseTranslationRecord(raw)
        await index.upsert({ ...record, filePath: file })
      } catch {
        // Missing file (deleted externally) or unreadable content.
        try {
          await fs.access(file)
        } catch {
          await index.removeByFilePath(file)
        }
      }
    }
  }

  async function settingsView(): Promise<SettingsView> {
    const vaultPath = getVaultPath()
    const [vaultSettings, keys] = await Promise.all([
      new SettingsStore(vaultPath).get(),
      credentials.loadAll(),
    ])
    const hasApiKeys = Object.fromEntries(
      vaultSettings.providers.map((provider) => [
        provider.id,
        typeof keys[provider.id] === 'string' && (keys[provider.id] as string).length > 0,
      ]),
    )
    return { ...vaultSettings, vaultPath, hasApiKeys }
  }

  /**
   * Providers built in priority order from the current settings. Keys
   * stay in the Main process — only ready-to-use clients leave here.
   */
  async function buildProviderRuntimes(): Promise<ProviderRuntime[]> {
    const vaultSettings = await new SettingsStore(getVaultPath()).get()
    const keys = await credentials.loadAll()
    return vaultSettings.providers.map((profile) => ({
      id: profile.id,
      label: profile.label,
      client: new OpenAiCompatibleClient({
        baseUrl: profile.baseUrl,
        apiKey: keys[profile.id] ?? null,
        model: profile.model,
        temperature: profile.temperature,
        timeoutMs: profile.timeoutMs,
        maxRetries: profile.maxRetries,
      }),
    }))
  }

  /** Services are rebuilt per request so settings changes apply immediately. */
  async function buildServices(): Promise<{
    translation: TranslationService
    store: TranslationStore
    history: HistoryService
  }> {
    const vaultPath = getVaultPath()
    const prompts = new PromptManager([path.join(vaultPath, 'prompts'), builtinPromptsDir()])
    await prompts.load()
    const index = getIndex()
    const store = new TranslationStore(vaultPath)
    const history = new HistoryService(store, index)
    return {
      translation: new TranslationService(
        prompts,
        new ContextRetriever({ glossary: new GlossaryStore(vaultPath), index }),
      ),
      store,
      history,
    }
  }

  handle(IPC.translate, async (payload) => {
    const request = TranslateRequestSchema.parse(payload)
    const [services, providers] = await Promise.all([buildServices(), buildProviderRuntimes()])
    if (providers.length === 0) throw new AppError('CONFIG_ERROR', 'No AI provider configured')
    return services.translation.translate(request, providers)
  })

  // Streaming translate: chunk events go to the requesting window; the
  // invoke itself resolves with the final result. requestId is generated
  // by the renderer and correlates chunks and cancellation.
  const streamControllers = new Map<string, AbortController>()
  ipcMain.on(IPC.streamCancel, (_event, payload: unknown) => {
    const parsed = IdRequestSchema.safeParse(payload)
    const controller = parsed.success ? streamControllers.get(parsed.data.id) : undefined
    controller?.abort()
  })

  handle(IPC.translateStream, async (payload, event) => {
    const { requestId, ...request } = TranslateStreamRequestSchema.parse(payload)
    const [services, providers] = await Promise.all([buildServices(), buildProviderRuntimes()])
    if (providers.length === 0) throw new AppError('CONFIG_ERROR', 'No AI provider configured')
    const controller = new AbortController()
    streamControllers.set(requestId, controller)
    const streamStart = Date.now()
    try {
      return await services.translation.translateStream(request, providers, (delta) => {
        if (process.env['TT_STREAM_DEBUG'] === '1') {
          console.log(`[stream-delta] +${Date.now() - streamStart}ms len=${delta.length}`)
        }
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.streamChunk, { requestId, delta })
        }
      }, controller.signal)
    } finally {
      streamControllers.delete(requestId)
    }
  })

  handle(IPC.save, async (payload) => {
    const request = SaveRequestSchema.parse(payload)
    const services = await buildServices()
    const saved = await services.store.save(request)
    const record = await services.store.get(saved.id)
    if (record) await getIndex().upsert(record)
    return saved
  })

  handle(IPC.getRecord, async (payload) => {
    const request = GetRecordRequestSchema.parse(payload)
    const services = await buildServices()
    return services.history.get(request.id)
  })

  handle(IPC.historyList, async (payload) => {
    const query = HistoryQuerySchema.parse(payload)
    const services = await buildServices()
    return services.history.list(query)
  })

  handle(IPC.historyUpdate, async (payload) => {
    const request = HistoryUpdateSchema.parse(payload)
    const services = await buildServices()
    return services.history.updateMeta(request.id, {
      tags: request.tags,
      notes: request.notes,
      userTranslation: request.userTranslation,
    })
  })

  handle(IPC.historyDelete, async (payload) => {
    const request = IdRequestSchema.parse(payload)
    const services = await buildServices()
    return services.history.setDeleted(request.id, true)
  })

  handle(IPC.historyRestore, async (payload) => {
    const request = IdRequestSchema.parse(payload)
    const services = await buildServices()
    return services.history.setDeleted(request.id, false)
  })

  handle(IPC.historyAnalyze, async (payload) => {
    const request = IdRequestSchema.parse(payload)
    const [services, providers] = await Promise.all([buildServices(), buildProviderRuntimes()])
    const record = await services.history.get(request.id)
    if (!record) {
      throw new AppError('STORAGE_ERROR', `Record not found: ${request.id}`)
    }
    const primary = providers[0]
    if (!primary) throw new AppError('CONFIG_ERROR', 'No AI provider configured')
    const { learningPointIds } = await getMemory().analyze(record, primary.client)
    const updated = await services.store.update(request.id, {
      analyzedAt: new Date().toISOString(),
    })
    if (updated) await getIndex().upsert(updated)
    return { learningPointIds }
  })

  handle(IPC.memoryList, async (payload) => {
    const query = MemoryQuerySchema.parse(payload)
    return getMemory().list(query)
  })

  handle(IPC.memoryUpdate, async (payload) => {
    const request = MemoryUpdateSchema.parse(payload)
    return getMemory().update(request.id, { status: request.status, notes: request.notes })
  })

  handle(IPC.memoryDelete, async (payload) => {
    const request = IdRequestSchema.parse(payload)
    return getMemory().delete(request.id)
  })

  handle(IPC.glossaryList, async () => new GlossaryStore(getVaultPath()).list())

  handle(IPC.glossaryAdd, async (payload) => {
    const request = GlossaryEntrySchema.parse(payload)
    return new GlossaryStore(getVaultPath()).add(request)
  })

  handle(IPC.glossaryRemove, async (payload) => {
    const request = TermRequestSchema.parse(payload)
    return new GlossaryStore(getVaultPath()).remove(request.term)
  })

  handle(IPC.trainingGetToday, async () => {
    const vaultSettings = await new SettingsStore(getVaultPath()).get()
    return getTraining().getToday({ targetSize: vaultSettings.training.dailySessionSize })
  })

  handle(IPC.trainingSubmit, async (payload) => {
    const request = SubmitAnswerSchema.parse(payload)
    return getTraining().submit(request)
  })

  handle(IPC.indexRebuild, async () => {
    const count = await getIndex().rebuild()
    return { count }
  })

  handle(IPC.settingsGet, async () => settingsView())

  handle(IPC.settingsUpdate, async (payload) => {
    const patch = UpdateSettingsSchema.parse(payload)
    if (patch.vaultPath) setVaultPath(patch.vaultPath)
    if (patch.providers) {
      // Prune keys of deleted providers, then store any newly entered ones.
      await credentials.retainOnly(patch.providers.map((provider) => provider.id))
      for (const keyInput of patch.providerKeys ?? []) {
        await credentials.store(keyInput.providerId, keyInput.apiKey)
      }
    }
    await new SettingsStore(getVaultPath()).update({
      providers: patch.providers,
      translation: patch.translation,
      training: patch.training,
    })
    return settingsView()
  })

  handle(IPC.settingsChooseVault, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose Translation Vault',
      properties: ['openDirectory', 'createDirectory'],
    })
    const chosen = result.filePaths[0]
    if (!chosen) return null
    setVaultPath(chosen)
    return chosen
  })
}
