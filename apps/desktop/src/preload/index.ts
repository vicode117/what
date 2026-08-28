import { contextBridge, ipcRenderer } from 'electron'
import { AppError, IPC } from '@tt/contracts'
import type {
  AppApi,
  GetRecordRequest,
  GlossaryEntry,
  HistoryQuery,
  HistoryUpdate,
  IdRequest,
  MemoryQuery,
  MemoryUpdate,
  IpcResult,
  SaveRequest,
  SubmitAnswer,
  TermRequest,
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
    analyze: (request: IdRequest) => invoke(IPC.historyAnalyze, request),
  },
  memory: {
    list: (request: MemoryQuery) => invoke(IPC.memoryList, request),
    update: (request: MemoryUpdate) => invoke(IPC.memoryUpdate, request),
    delete: (request: IdRequest) => invoke(IPC.memoryDelete, request),
  },
  glossary: {
    list: () => invoke(IPC.glossaryList),
    add: (request: GlossaryEntry) => invoke(IPC.glossaryAdd, request),
    remove: (request: TermRequest) => invoke(IPC.glossaryRemove, request),
  },
  training: {
    getToday: () => invoke(IPC.trainingGetToday),
    submit: (request: SubmitAnswer) => invoke(IPC.trainingSubmit, request),
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
