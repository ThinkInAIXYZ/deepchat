/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  const component: DefineComponent<{}, {}, any>
  export default component
}

// 悬浮按钮 API 类型声明
declare global {
  interface Window {
    floatingButtonAPI: {
      onClick: () => void
      onConfigUpdate: (callback: (config: any) => void) => void
      removeAllListeners: () => void
    }
  }
}

export {}
