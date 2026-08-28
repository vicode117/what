import { contextBridge, ipcRenderer } from 'electron'
import { AppError, IPC } from '@tt/contracts'
import type {
  AppApi,
  GetRecordRequest,
  HistoryQuery,
  HistoryUpdate,
  IdRequest,
  IpcResult,
  SaveRequest,
  TranslateRequest,
  UpdateSettings,
} from '@tt/contracts'

/**
 * Narrow, domain-scoped bridge. Every call goes through the typed IPC
 * envelope; failures are rethrown as typed AppErrors. The renderer has
 * no access to fs, Node APIs, or API keys — only these operations.
 */
async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, payload)) as IpcResult<T>
  if (!result.ok) throw AppError.fromPayload(result.error)
  return result.data
}

const api: AppApi = {
  translation: {
    translate: (request: TranslateRequest) => invoke(IPC.translate, request),
    save: (request: SaveRequest) => invoke(IPC.save, request),
  },
  history: {
    get: (request: GetRecordRequest) => invoke(IPC.getRecord, request),
    list: (request: HistoryQuery) => invoke(IPC.historyList, request),
    update: (request: HistoryUpdate) => invoke(IPC.historyUpdate, request),
    delete: (request: IdRequest) => invoke(IPC.historyDelete, request),
    restore: (request: IdRequest) => invoke(IPC.historyRestore, request),
  },
  maintenance: {
    rebuildIndex: () => invoke(IPC.indexRebuild),
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch: UpdateSettings) => invoke(IPC.settingsUpdate, patch),
    chooseVault: () => invoke(IPC.settingsChooseVault),
  },
}

contextBridge.exposeInMainWorld('app', api)
