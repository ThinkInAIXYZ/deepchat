/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  const component: DefineComponent<{}, {}, any>
  export default component
}
interface ImportMetaEnv {
  readonly BASE_URL: string
  readonly MODE: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly SSR: boolean
  readonly VITE_GITHUB_CLIENT_ID: string
  readonly VITE_GITHUB_CLIENT_SECRET: string
  readonly VITE_GITHUB_REDIRECT_URI: string
  readonly VITE_LOG_IPC_CALL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.css'

declare module '*.png?url' {
  const src: string
  export default src
}

declare module '*.svg?url' {
  const src: string
  export default src
}

declare module '*.webp?url' {
  const src: string
  export default src
}

declare module '*?worker&inline' {
  const WorkerFactory: {
    new (): Worker
  }
  export default WorkerFactory
}
