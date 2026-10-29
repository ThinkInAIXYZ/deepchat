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
  private readonly copilotLogins = new Set<Promise<boolean>>()
  private stopping: Promise<void> | undefined

  constructor(
    private readonly providerAuth: GitHubCopilotCredentialOwner,
    private readonly accounts: ProviderAccountAuthPort,
    private readonly authorization: GitHubCopilotAuthorizationPort
  ) {}

  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.stopped = true
    this.copilotController.abort()
    this.stopping = (async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(async () => await this.accounts.stop()),
        Promise.resolve().then(
          async () => await this.providerAuth.invalidateGitHubCopilotSignIns()
        ),
        Promise.allSettled(this.copilotLogins)
      ])
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : []
      )
      if (errors.length === 1) throw errors[0]
      if (errors.length) throw new AggregateError(errors, 'OAuth owner did not retire')
    })()
    return this.stopping
  }

  /**
   * Start GitHub Copilot Device Flow login process (recommended)
   */
  startGitHubCopilotDeviceFlowLogin(providerId: string): Promise<boolean> {
    return this.signIn(providerId, 'device')
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
  startGitHubCopilotLogin(providerId: string): Promise<boolean> {
    return this.signIn(providerId, 'browser')
  }

  private signIn(providerId: string, kind: 'browser' | 'device'): Promise<boolean> {
    if (this.stopped) return Promise.reject(new Error('OAuth service is stopped'))
    const assertActive = () => {
      if (this.stopped) throw new Error('OAuth service is stopped')
    }
    const operation = Promise.resolve().then(async () => {
      assertActive()
      const target = await this.providerAuth.getGitHubCopilotSignInTarget(providerId)
      assertActive()
      const accessToken = await this.authorization[kind](
        target.clientId,
        this.copilotController.signal
      )
      assertActive()
      await getGitHubCopilotToken(accessToken, this.copilotController.signal)
      assertActive()
      await this.providerAuth.commitGitHubCopilotCredential(target, accessToken)
      logger.info('[GitHub Copilot] Sign-in completed', { kind })
      return true
    })
    this.copilotLogins.add(operation)
    void operation.then(
      () => this.copilotLogins.delete(operation),
      () => this.copilotLogins.delete(operation)
    )
    return operation
  }
}
