import type { DeepchatBridge } from '@shared/contracts/bridge'

declare global {
  interface Window {
    deepchat: DeepchatBridge
    api: {
      copyText(text: string): void
      copyImage(image: string): void
      readClipboardText(): string
      getPathForFile(file: File): string
      getPlatform(): string
      getArch(): string
      openExternal?(url: string): Promise<void>
      toRelativePath?(filePath: string, baseDir?: string): string
      formatPathForInput?(filePath: string): string
    }
    __deepchatDev?: {
      goToWelcome(): boolean
      clearWelcomeOverride(): boolean
    }
  }
}
