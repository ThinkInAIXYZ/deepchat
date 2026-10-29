import logger from '@shared/logger'
import { getGitHubCopilotToken } from '@/provider/auth/githubCopilotToken'
import type { OpenAICodexAuthStatus } from '@shared/types/openai-codex'
import type { XaiGrokAuthStatus } from '@shared/types/xai-grok'
import type {
  GitHubCopilotCredentialOwner,
  OAuthServicePort,
  ProviderAccountAuthPort
} from '@shared/types/oauth'

export interface GitHubCopilotAuthorizationPort {
  browser(clientId: string | undefined, signal: AbortSignal): Promise<string>
  device(clientId: string | undefined, signal: AbortSignal): Promise<string>
}

export class OAuthService implements OAuthServicePort {
  private stopped = false
  private readonly copilotController = new AbortController()

  constructor(
    private readonly providerAuth: GitHubCopilotCredentialOwner,
    private readonly accounts: ProviderAccountAuthPort,
    private readonly authorization: GitHubCopilotAuthorizationPort
  ) {}

  async stop(): Promise<void> {
    this.stopped = true
    this.copilotController.abort()
    await Promise.all([this.accounts.stop(), this.providerAuth.invalidateGitHubCopilotSignIns()])
  }

  /**
   * Start GitHub Copilot Device Flow login process (recommended)
   */
  async startGitHubCopilotDeviceFlowLogin(providerId: string): Promise<boolean> {
    try {
      if (this.stopped) throw new Error('OAuth service is stopped')
      const target = await this.providerAuth.getGitHubCopilotSignInTarget(providerId)
      if (this.stopped) throw new Error('OAuth service is stopped')
      const accessToken = await this.authorization.device(
        target.clientId,
        this.copilotController.signal
      )
      if (this.stopped) throw new Error('OAuth service is stopped')
      await getGitHubCopilotToken(accessToken, this.copilotController.signal)
      if (this.stopped) throw new Error('OAuth service is stopped')
      await this.providerAuth.commitGitHubCopilotCredential(target, accessToken)
      logger.info('[GitHub Copilot] Device Flow login completed successfully')

      return true
    } catch (error) {
      console.error('[GitHub Copilot] Device Flow login failed:', error)
      throw error
    }
  }

  async getOpenAICodexStatus(): Promise<OpenAICodexAuthStatus> {
    return this.accounts.getOpenAICodexStatus()
  }

  async startOpenAICodexBrowserLogin(): Promise<OpenAICodexAuthStatus> {
    return this.accounts.startOpenAICodexBrowserLogin()
  }

  async completeOpenAICodexBrowserLoginFromUrl(
    callbackUrl: string
  ): Promise<OpenAICodexAuthStatus> {
    return this.accounts.completeOpenAICodexBrowserLoginFromUrl(callbackUrl)
  }

  async cancelOpenAICodexLogin(): Promise<OpenAICodexAuthStatus> {
    return this.accounts.cancelOpenAICodexLogin()
  }

  async logoutOpenAICodex(): Promise<OpenAICodexAuthStatus> {
    return this.accounts.logoutOpenAICodex()
  }

  async getXaiGrokStatus(): Promise<XaiGrokAuthStatus> {
    return this.accounts.getXaiGrokStatus()
  }

  async startXaiGrokDeviceLogin(): Promise<XaiGrokAuthStatus> {
    return this.accounts.startXaiGrokDeviceLogin()
  }

  async cancelXaiGrokLogin(): Promise<XaiGrokAuthStatus> {
    return this.accounts.cancelXaiGrokLogin()
  }

  async logoutXaiGrok(): Promise<XaiGrokAuthStatus> {
    return this.accounts.logoutXaiGrok()
  }

  /**
   * Start GitHub Copilot OAuth login process (traditional method)
   */
  async startGitHubCopilotLogin(providerId: string): Promise<boolean> {
    try {
      logger.info(
        '[GitHub Copilot][OAuth] Starting traditional OAuth login for provider:',
        providerId
      )

      logger.info('[GitHub Copilot][OAuth] Creating GitHub OAuth instance...')
      if (this.stopped) throw new Error('OAuth service is stopped')
      const target = await this.providerAuth.getGitHubCopilotSignInTarget(providerId)
      if (this.stopped) throw new Error('OAuth service is stopped')
      const accessToken = await this.authorization.browser(
        target.clientId,
        this.copilotController.signal
      )
      if (this.stopped) throw new Error('OAuth service is stopped')

      await getGitHubCopilotToken(accessToken, this.copilotController.signal)
      if (this.stopped) throw new Error('OAuth service is stopped')
      await this.providerAuth.commitGitHubCopilotCredential(target, accessToken)
      logger.info('[GitHub Copilot][OAuth] Traditional OAuth login completed successfully')

      return true
    } catch (error) {
      console.error('[GitHub Copilot][OAuth][ERROR] Traditional OAuth login failed:')
      console.error(
        '[GitHub Copilot][OAuth][ERROR] Error type:',
        error instanceof Error ? error.constructor.name : typeof error
      )
      console.error(
        '[GitHub Copilot][OAuth][ERROR] Error message:',
        error instanceof Error ? error.message : error
      )
      if (error instanceof Error && error.stack) {
        console.error('[GitHub Copilot][OAuth][ERROR] Stack trace:', error.stack)
      }
      throw error
    }
  }
}
