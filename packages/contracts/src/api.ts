import type { SaveRequest, SaveResult, TranslateRequest, TranslateResult, GetRecordRequest } from './ipc'
import type { StoredTranslationRecord } from './translation'
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
  }
  settings: {
    get(): Promise<SettingsView>
    update(patch: UpdateSettings): Promise<SettingsView>
    /** Opens a directory picker; resolves null when cancelled. */
    chooseVault(): Promise<string | null>
  }
}
