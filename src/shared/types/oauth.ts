import type { OpenAICodexAuthStatus } from './openai-codex'
import type { XaiGrokAuthStatus } from './xai-grok'

export interface GitHubCopilotSignInTarget {
  providerId: string
  clientId?: string
  configurationId: string
}

export interface GitHubCopilotCredentialOwner {
  getGitHubCopilotSignInTarget(providerId: string): Promise<GitHubCopilotSignInTarget>
  commitGitHubCopilotCredential(target: GitHubCopilotSignInTarget, apiKey: string): Promise<void>
  invalidateGitHubCopilotSignIns(): Promise<void>
}

export interface OAuthServicePort {
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

export type ProviderAccountAuthPort = Omit<
  OAuthServicePort,
  'startGitHubCopilotLogin' | 'startGitHubCopilotDeviceFlowLogin'
> & {
  stop(): Promise<void>
}
