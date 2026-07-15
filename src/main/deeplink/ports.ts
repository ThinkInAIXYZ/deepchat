import type { ProviderInstallPreview } from '@shared/providerDeeplink'

export type DeeplinkStartPayload = {
  msg: string
  modelId: string | null
  systemPrompt: string
  mentions: string[]
  autoSend: false
}

export interface DeeplinkDesktopPort {
  requestStart(payload: DeeplinkStartPayload): Promise<boolean>
}

export interface DeeplinkMcpInstallPort {
  isReady(): boolean
  requestInstall(mcpConfig: string): Promise<boolean>
}

export interface DeeplinkProviderInstallPort {
  hasProvider(providerId: string): boolean
  requestInstall(preview: ProviderInstallPreview): Promise<boolean>
  notifyError(message: string): void
}
