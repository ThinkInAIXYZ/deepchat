import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      copyText(text: string): void
      copyImage(image: string): void
      getPathForFile(file: File): string
      getWindowId(): number | null
      getWebContentsId(): number
    }
    floatingButtonAPI: typeof floatingButtonAPI
  }
}
