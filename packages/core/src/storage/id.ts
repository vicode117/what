const ID_PATTERN = /^tr_(\d{4})(\d{2})(\d{2})_(\d+)$/

export type ParsedTranslationId = {
  year: number
  month: number
  day: number
  sequence: number
}

/** `tr_20260829_001` — local calendar day plus per-day sequence. */
export function translationIdFor(date: Date, sequence: number): string {
  return `tr_${dateKey(date)}_${String(sequence).padStart(3, '0')}`
}

/** Local-time date key used for both ids and folder layout (YYYY/MM). */
export function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

export function parseTranslationId(id: string): ParsedTranslationId | null {
  const match = ID_PATTERN.exec(id)
  if (!match) return null
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    sequence: Number(match[4]),
  }
}

/** Next free sequence for the given day, based on ids already on disk. */
export function nextTranslationId(existingIds: readonly string[], now: Date): string {
  const key = dateKey(now)
  let maxSequence = 0
  for (const id of existingIds) {
    const parsed = parseTranslationId(id)
    if (parsed && dateKey(new Date(parsed.year, parsed.month - 1, parsed.day)) === key) {
      maxSequence = Math.max(maxSequence, parsed.sequence)
    }
  }
  return translationIdFor(now, maxSequence + 1)
}
