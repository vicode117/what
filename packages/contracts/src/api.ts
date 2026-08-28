import type { SaveRequest, SaveResult, TranslateRequest, TranslateResult, GetRecordRequest } from './ipc'
import type { HistoryPage, HistoryQuery, HistoryUpdate, IdRequest, StoredTranslationRecord } from './history'
import type { SettingsView, UpdateSettings } from './settings'

/**
 * The complete surface exposed to the renderer through contextBridge.
 *
 * Deliberately narrow and domain-oriented. There is no `window.fs`,
 * no `window.node`, no generic `invoke` — the renderer can only call
 * these application operations, and never receives API keys,
 * filesystem access, or Node.js APIs.
 */
export type AppApi = {
  translation: {
    translate(request: TranslateRequest): Promise<TranslateResult>
    save(request: SaveRequest): Promise<SaveResult>
  }
  history: {
    /** Returns null when no record with that id exists. */
    get(request: GetRecordRequest): Promise<StoredTranslationRecord | null>
    list(request: HistoryQuery): Promise<HistoryPage>
    update(request: HistoryUpdate): Promise<StoredTranslationRecord | null>
    /** Soft delete: the file stays in place and can be restored. */
    delete(request: IdRequest): Promise<StoredTranslationRecord | null>
    restore(request: IdRequest): Promise<StoredTranslationRecord | null>
  }
  maintenance: {
    /** Rebuilds the derived search index from the Vault source files. */
    rebuildIndex(): Promise<{ count: number }>
  }
  settings: {
    get(): Promise<SettingsView>
    update(patch: UpdateSettings): Promise<SettingsView>
    /** Opens a directory picker; resolves null when cancelled. */
    chooseVault(): Promise<string | null>
  }
}
