import logger from '@shared/logger'
import { createGitHubCopilotOAuth } from './githubCopilotOAuth'
import { getGlobalGitHubCopilotDeviceFlow } from './githubCopilotDeviceFlow'
import { getGitHubCopilotToken } from './githubCopilotToken'
import type { OpenAICodexAuthStatus } from '@shared/types/openai-codex'
import type { XaiGrokAuthStatus } from '@shared/types/xai-grok'
import type {
  GitHubCopilotCredentialOwner,
  OAuthServicePort,
  ProviderAccountAuthPort
} from '@shared/types/oauth'

export class OAuthService implements OAuthServicePort {
  private stopped = false
  private readonly copilotController = new AbortController()

  constructor(
    private readonly providerAuth: GitHubCopilotCredentialOwner,
    private readonly accounts: ProviderAccountAuthPort
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
      const githubDeviceFlow = getGlobalGitHubCopilotDeviceFlow(target.clientId)

      // 开始Device Flow登录
      const accessToken = await githubDeviceFlow.startDeviceFlow()
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

      // 使用专门的GitHub Copilot OAuth实现
      logger.info('[GitHub Copilot][OAuth] Creating GitHub OAuth instance...')
      if (this.stopped) throw new Error('OAuth service is stopped')
      const target = await this.providerAuth.getGitHubCopilotSignInTarget(providerId)
      if (this.stopped) throw new Error('OAuth service is stopped')
      const githubOAuth = createGitHubCopilotOAuth(target.clientId)

      // 开始OAuth登录
      logger.info('[GitHub Copilot][OAuth] Starting OAuth login flow...')
      const authCode = await githubOAuth.startLogin()
      logger.info(
        '[GitHub Copilot][OAuth] OAuth login completed, auth code received:',
        authCode ? 'SUCCESS' : 'FAILED'
      )

      if (!authCode) {
        throw new Error('Failed to obtain authorization code')
      }
      if (this.stopped) throw new Error('OAuth service is stopped')

      logger.info('[GitHub Copilot][OAuth] Auth code received successfully')

      // 用授权码交换访问令牌
      logger.info('[GitHub Copilot][OAuth] Exchanging auth code for access token...')
      const accessToken = await githubOAuth.exchangeCodeForToken(authCode)
      if (this.stopped) throw new Error('OAuth service is stopped')
      logger.info(
        '[GitHub Copilot][OAuth] Token exchange completed, access token received:',
        accessToken ? 'SUCCESS' : 'FAILED'
      )

      if (accessToken) {
        logger.info('[GitHub Copilot][OAuth] Access token received successfully')
      }

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
