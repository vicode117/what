/**
 * Initial language list. Intentionally small; may grow later.
 * `auto` is only valid as a SOURCE language.
 */
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'es', label: 'Spanish' },
  { code: 'ru', label: 'Russian' },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

/** Literal tuple so `z.enum` keeps the narrow union type. */
export const LANGUAGE_CODES = [
  'en',
  'zh-CN',
  'zh-TW',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'ru',
] as const satisfies readonly LanguageCode[]

const LANGUAGE_LABELS = new Map<string, string>(LANGUAGES.map((l) => [l.code, l.label]))

export const AUTO_DETECT = 'auto' as const
export type SourceLanguage = LanguageCode | typeof AUTO_DETECT

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS.get(code) ?? code
}
