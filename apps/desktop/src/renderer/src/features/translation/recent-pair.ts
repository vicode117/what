import type { LanguageCode, SourceLanguage, TranslationMode } from '@tt/contracts'

const RECENT_PAIR_KEY = 'tt.recentLanguagePair'

export type RecentLanguagePair = {
  sourceLanguage: SourceLanguage
  targetLanguage: LanguageCode
  mode: TranslationMode
}

/** Remembers the most recent language pair + mode (renderer-local). */
export function readRecentPair(): RecentLanguagePair | null {
  try {
    const raw = localStorage.getItem(RECENT_PAIR_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RecentLanguagePair>
    if (typeof parsed.sourceLanguage !== 'string' || typeof parsed.targetLanguage !== 'string' || typeof parsed.mode !== 'string') {
      return null
    }
    return parsed as RecentLanguagePair
  } catch {
    return null
  }
}

export function rememberPair(pair: RecentLanguagePair): void {
  try {
    localStorage.setItem(RECENT_PAIR_KEY, JSON.stringify(pair))
  } catch {
    // storage unavailable — remembering is best-effort
  }
}
