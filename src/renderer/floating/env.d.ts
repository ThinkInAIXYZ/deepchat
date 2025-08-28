/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare global {
  interface Window {
    floatingButtonAPI: {
      onClick: () => void
      onRightClick: () => void
      onDragStart: (x: number, y: number) => void
      onDragMove: (x: number, y: number) => void
      onDragEnd: (x: number, y: number) => void
      onConfigUpdate: (callback: (config: any) => void) => void
      removeAllListeners: () => void
    }
  }
}

export {}
