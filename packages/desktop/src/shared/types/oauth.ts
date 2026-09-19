import type { OpenAICodexAuthStatus } from './openai-codex'
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
  getOpenAICodexStatus(): Promise<OpenAICodexAuthStatus>
  startOpenAICodexBrowserLogin(): Promise<OpenAICodexAuthStatus>
  completeOpenAICodexBrowserLoginFromUrl(callbackUrl: string): Promise<OpenAICodexAuthStatus>
  cancelOpenAICodexLogin(): Promise<OpenAICodexAuthStatus>
  logoutOpenAICodex(): Promise<OpenAICodexAuthStatus>
  getXaiGrokStatus(): Promise<XaiGrokAuthStatus>
  startXaiGrokDeviceLogin(): Promise<XaiGrokAuthStatus>
  cancelXaiGrokLogin(): Promise<XaiGrokAuthStatus>
  logoutXaiGrok(): Promise<XaiGrokAuthStatus>
}
