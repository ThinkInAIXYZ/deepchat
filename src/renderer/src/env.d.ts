/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  const component: DefineComponent<{}, {}, any>
  export default component
}
interface ImportMetaEnv {
  readonly VITE_GITHUB_CLIENT_ID: string
  readonly VITE_GITHUB_CLIENT_SECRET: string
  readonly VITE_GITHUB_REDIRECT_URI: string
  readonly VITE_LOG_IPC_CALL: string
  readonly VITE_ENABLE_PLAYGROUND: 'true' | 'false'
  readonly VITE_PROVIDER_DB_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
