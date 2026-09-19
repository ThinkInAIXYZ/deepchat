/// <reference types="vite/client" />

import type { YoBrowserActivityPayload } from '@deepchat/shared/types/browser'

declare global {
  interface Window {
    yoBrowserOverlay: {
      onActivityChanged: (callback: (payload: YoBrowserActivityPayload) => void) => () => void
    }
  }
}

export {}
