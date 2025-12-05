import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      copyText(text: string): void
      copyImage(image: string): void
      readClipboardText(): string
      getPathForFile(file: File): string
      getWindowId(): number | null
      getWebContentsId(): number
      openExternal?(url: string): Promise<void>
      toRelativePath?(filePath: string, baseDir?: string): string
      formatPathForInput?(filePath: string): string
    }
    floatingButtonAPI: typeof floatingButtonAPI
  }
}
