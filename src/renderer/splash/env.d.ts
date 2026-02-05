/// <reference types="vite/client" />

import type { ElectronAPI } from '@electron-toolkit/preload'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
export {}
