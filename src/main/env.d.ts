/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_CLIENT_ID: string
  readonly VITE_GITHUB_CLIENT_SECRET: string
  readonly VITE_GITHUB_REDIRECT_URI: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
