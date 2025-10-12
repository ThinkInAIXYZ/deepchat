/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_CLIENT_ID: string
  readonly VITE_GITHUB_CLIENT_SECRET: string
  readonly VITE_GITHUB_REDIRECT_URI: string
  readonly VITE_LOG_IPC_CALL: string
  readonly VITE_APP_LIFECYCLE_HOOK_DELAY?: string
  readonly VITE_PROVIDER_DB_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
