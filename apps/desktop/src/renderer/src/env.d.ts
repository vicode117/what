import type { AppApi } from '@tt/contracts'

declare global {
  interface Window {
    app: AppApi
  }
}

export {}
