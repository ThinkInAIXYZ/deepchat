import type { ChatGPTAuthStatus, ChatGPTLogoutResult, ChatGPTNotice } from './chatgpt'
import type { XaiGrokAuthStatus } from './xai-grok'

export interface OAuthConfig {
  authUrl: string
  redirectUri: string
  clientId: string
  clientSecret?: string
  scope: string
  responseType: string
}

export interface OAuthServicePort {
  startOAuthLogin(providerId: string, config: OAuthConfig): Promise<boolean>
  startGitHubCopilotLogin(providerId: string): Promise<boolean>
  startGitHubCopilotDeviceFlowLogin(providerId: string): Promise<boolean>
  getChatGPTStatus(): Promise<ChatGPTAuthStatus>
  startChatGPTLogin(options?: { requestPlanConsent?: boolean }): Promise<ChatGPTAuthStatus>
  reopenChatGPTBrowser(): Promise<ChatGPTAuthStatus>
  cancelChatGPTLogin(): Promise<ChatGPTAuthStatus>
  logoutChatGPT(): Promise<ChatGPTLogoutResult>
  dismissChatGPTNotice(notice: ChatGPTNotice): Promise<ChatGPTAuthStatus>
  getXaiGrokStatus(): Promise<XaiGrokAuthStatus>
  startXaiGrokDeviceLogin(): Promise<XaiGrokAuthStatus>
  cancelXaiGrokLogin(): Promise<XaiGrokAuthStatus>
  logoutXaiGrok(): Promise<XaiGrokAuthStatus>
}
