import { useCallback, useRef, useState } from 'react'

/** Clipboard helper with a transient "copied" state. */
export function useCopy(resetAfterMs = 1500): { copied: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), resetAfterMs)
      } catch {
        // clipboard unavailable (e.g. unfocused window) — ignore
      }
    },
    [resetAfterMs],
  )

  return { copied, copy }
}
