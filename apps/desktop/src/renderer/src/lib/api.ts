import { AppError } from '@tt/contracts'
import type {
  ErrorCode,
  GetRecordRequest,
  GlossaryEntry,
  HistoryQuery,
  HistoryUpdate,
  IdRequest,
  MemoryQuery,
  MemoryUpdate,
  SaveRequest,
  SubmitAnswer,
  TermRequest,
  TranslateRequest,
  TranslateStreamRequest,
  UpdateSettings,
} from '@tt/contracts'

/**
 * Thin typed client over the contextBridge surface. TanStack Query
 * call these; components never touch `window.app` directly.
 */
export const api = {
  translation: {
    translate: (request: TranslateRequest) => window.app.translation.translate(request),
    translateStream: (request: TranslateStreamRequest, onChunk: (delta: string) => void) =>
      window.app.translation.translateStream(request, onChunk),
    cancelTranslate: (requestId: string) => window.app.translation.cancelTranslate(requestId),
    save: (request: SaveRequest) => window.app.translation.save(request),
  },
  history: {
    get: (request: GetRecordRequest) => window.app.history.get(request),
    list: (request: HistoryQuery) => window.app.history.list(request),
    update: (request: HistoryUpdate) => window.app.history.update(request),
    delete: (request: IdRequest) => window.app.history.delete(request),
    restore: (request: IdRequest) => window.app.history.restore(request),
    analyze: (request: IdRequest) => window.app.history.analyze(request),
  },
  memory: {
    list: (request: MemoryQuery) => window.app.memory.list(request),
    update: (request: MemoryUpdate) => window.app.memory.update(request),
    delete: (request: IdRequest) => window.app.memory.delete(request),
  },
  glossary: {
    list: () => window.app.glossary.list(),
    add: (request: GlossaryEntry) => window.app.glossary.add(request),
    remove: (request: TermRequest) => window.app.glossary.remove(request),
  },
  training: {
    getToday: () => window.app.training.getToday(),
    submit: (request: SubmitAnswer) => window.app.training.submit(request),
  },
  maintenance: {
    rebuildIndex: () => window.app.maintenance.rebuildIndex(),
  },
  settings: {
    get: () => window.app.settings.get(),
    update: (patch: UpdateSettings) => window.app.settings.update(patch),
    chooseVault: () => window.app.settings.chooseVault(),
  },
}

const ERROR_HINTS: Record<ErrorCode, string> = {
  TIMEOUT: 'The AI provider did not respond in time. Try again or raise the timeout in Settings.',
  RATE_LIMIT: 'The AI provider is rate limiting requests. Wait a moment and try again.',
  AUTH_ERROR: 'Authentication failed. Check the API key and base URL in Settings.',
  NETWORK_ERROR: 'Could not reach the AI provider. Check your connection and base URL.',
  INVALID_RESPONSE: 'The AI provider returned an unexpected response.',
  PROVIDER_ERROR: 'The AI provider reported an error.',
  CANCELLED: 'The request was cancelled.',
  VALIDATION_ERROR: 'Invalid input.',
  STORAGE_ERROR: 'Accessing the vault failed.',
  CONFIG_ERROR: 'Configuration problem.',
  PROMPT_ERROR: 'Prompt problem.',
  INTERNAL_ERROR: 'Unexpected internal error.',
}

export function describeError(error: unknown): string {
  if (error instanceof AppError) {
    return ERROR_HINTS[error.code] ?? 'Something went wrong.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong.'
}

export function isCancelled(error: unknown): boolean {
  return error instanceof AppError && error.code === 'CANCELLED'
}
