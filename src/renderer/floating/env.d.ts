/// <reference types="vite/client" />

import type { FloatingWidgetSnapshot } from '@shared/types/floating-widget'

type FloatingButtonUnsubscribe = () => void

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
      getSnapshot: () => Promise<FloatingWidgetSnapshot>
      getLanguage: () => Promise<string>
      getTheme: () => Promise<'dark' | 'light'>
      getAcpRegistryIconMarkup: (agentId: string, iconUrl: string) => Promise<string>
      toggleExpanded: () => void
      setExpanded: (expanded: boolean) => void
      setHovering: (hovering: boolean) => void
      openSession: (sessionId: string) => void
      onDragStart: (x: number, y: number) => void
      onDragMove: (x: number, y: number) => void
      onDragEnd: (x: number, y: number) => void
      onSnapshotUpdate: (
        callback: (snapshot: FloatingWidgetSnapshot) => void
      ) => FloatingButtonUnsubscribe
      onLanguageChanged: (callback: (language: string) => void) => FloatingButtonUnsubscribe
      onThemeChanged: (callback: (theme: 'dark' | 'light') => void) => FloatingButtonUnsubscribe
    }
  }
}

export {}
