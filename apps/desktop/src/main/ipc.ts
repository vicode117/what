import path from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import { errorToPayload, GetRecordRequestSchema, IPC, SaveRequestSchema, TranslateRequestSchema, UpdateSettingsSchema } from '@tt/contracts'
import type { IpcResult, SettingsView } from '@tt/contracts'
import { OpenAiCompatibleClient, PromptManager, SettingsStore, TranslationService, TranslationStore } from '@tt/core'
import type { LlmClient } from '@tt/core'
import { SafeCredentialStore } from './credentials'
import { builtinPromptsDir } from './paths'
import { getVaultPath, setVaultPath } from './vault'

function handle<T>(channel: string, fn: (payload: unknown) => Promise<T>): void {
  ipcMain.handle(channel, async (_event, payload: unknown): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn(payload) }
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

  /**
   * Services are built per request so a vault change or settings update
   * takes effect immediately. Loads are small local file reads.
   */
  async function buildServices(): Promise<{
    translation: TranslationService
    store: TranslationStore
    client: LlmClient
  }> {
    const vaultPath = getVaultPath()
    const vaultSettings = await new SettingsStore(vaultPath).get()
    const prompts = new PromptManager([path.join(vaultPath, 'prompts'), builtinPromptsDir()])
    await prompts.load()
    const apiKey = await credentials.load()
    const client = new OpenAiCompatibleClient({
      baseUrl: vaultSettings.provider.baseUrl,
      apiKey,
      model: vaultSettings.provider.model,
      temperature: vaultSettings.provider.temperature,
      timeoutMs: vaultSettings.provider.timeoutMs,
      maxRetries: vaultSettings.provider.maxRetries,
    })
    return {
      translation: new TranslationService(prompts),
      store: new TranslationStore(vaultPath),
      client,
    }
  }

  async function settingsView(): Promise<SettingsView> {
    const vaultPath = getVaultPath()
    const [vaultSettings, apiKey] = await Promise.all([
      new SettingsStore(vaultPath).get(),
      credentials.load(),
    ])
    return { ...vaultSettings, vaultPath, hasApiKey: apiKey !== null }
  }

  handle(IPC.translate, async (payload) => {
    const request = TranslateRequestSchema.parse(payload)
    const services = await buildServices()
    return services.translation.translate(request, services.client)
  })

  handle(IPC.save, async (payload) => {
    const request = SaveRequestSchema.parse(payload)
    const services = await buildServices()
    return services.store.save(request)
  })

  handle(IPC.getRecord, async (payload) => {
    const request = GetRecordRequestSchema.parse(payload)
    const services = await buildServices()
    return services.store.get(request.id)
  })

  handle(IPC.settingsGet, async () => settingsView())

  handle(IPC.settingsUpdate, async (payload) => {
    const patch = UpdateSettingsSchema.parse(payload)
    if (patch.vaultPath) setVaultPath(patch.vaultPath)
    if (patch.apiKey) await credentials.store(patch.apiKey)
    await new SettingsStore(getVaultPath()).update({
      provider: patch.provider,
      translation: patch.translation,
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
