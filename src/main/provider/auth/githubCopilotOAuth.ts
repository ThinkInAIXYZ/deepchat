import logger from '@shared/logger'
import { BrowserWindow } from 'electron'
import { randomBytes } from 'crypto'
import { is } from '@electron-toolkit/utils'
import { z } from 'zod'
import { readAuthResponse } from './responseBody'

export interface GitHubOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scope: string
}

export class GitHubCopilotOAuth {
  constructor(private config: GitHubOAuthConfig) {}

  /**
   * Start GitHub OAuth login process
   */
  async startLogin(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const state = randomBytes(16).toString('hex')
    const redirect = new URL(this.config.redirectUri)
    const result = Promise.withResolvers<string>()
    void result.promise.catch(() => {})
    const closed = Promise.withResolvers<void>()
    const window = new BrowserWindow({
      width: 500,
      height: 700,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true
      },
      autoHideMenuBar: true,
      title: 'GitHub Copilot Authorization'
    })
    window.once('closed', () => {
      closed.resolve()
      result.reject(new Error('User cancelled authorization'))
    })
    const abort = () => result.reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => result.reject(new Error('Authorization timeout')), 300_000)
    const callback = (url: string): boolean => {
      let target: URL
      try {
        target = new URL(url)
      } catch {
        return false
      }
      if (
        target.protocol !== redirect.protocol ||
        target.host !== redirect.host ||
        target.pathname !== redirect.pathname
      )
        return false
      if (target.searchParams.get('state') !== state)
        result.reject(new Error('Security verification failed: state parameter mismatch'))
      else if (target.searchParams.has('error'))
        result.reject(new Error(`GitHub authorization failed: ${target.searchParams.get('error')}`))
      else if (target.searchParams.get('code')) result.resolve(target.searchParams.get('code')!)
      return true
    }
    window.webContents.on('will-redirect', (event, url) => {
      if (callback(url)) event.preventDefault()
    })
    window.webContents.on('did-navigate', (_event, url) => callback(url))
    window.webContents.setWindowOpenHandler(({ url }) => {
      callback(url)
      return { action: 'deny' }
    })
    const closeWindow = async () => {
      try {
        if (!window.isDestroyed()) window.destroy()
      } finally {
        await closed.promise
      }
    }
    try {
      if (signal.aborted) abort()
      else {
        void window.loadURL(this.buildAuthUrl(state)).catch(result.reject)
        window.show()
      }
      const code = await result.promise
      signal.throwIfAborted()
      return code
    } catch (error) {
      signal.throwIfAborted()
      throw error
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      await closeWindow()
    }
  }

  /**
   * Build GitHub OAuth authorization URL
   */
  private buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope,
      state,
      response_type: 'code'
    })

    return `https://github.com/login/oauth/authorize?${params.toString()}`
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    try {
      const response = await readAuthResponse(
        await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'DeepChat/1.0.0'
          },
          signal,
          body: JSON.stringify({
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            code: code,
            redirect_uri: this.config.redirectUri
          })
        }),
        signal
      )

      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`)
      }

      const parsed = z
        .object({
          access_token: z
            .string()
            .regex(/^[\x21-\x7e]+$/)
            .optional(),
          error: z.string().optional(),
          error_description: z.string().optional()
        })
        .safeParse(await response.json())
      if (!parsed.success) throw new Error('Invalid GitHub OAuth token response')
      const data = parsed.data
      signal.throwIfAborted()

      if (data.error) {
        throw new Error(`Token exchange error: ${data.error_description || data.error}`)
      }

      if (!data.access_token) {
        throw new Error('No access token received')
      }

      return data.access_token
    } catch (error) {
      signal.throwIfAborted()
      throw error
    }
  }
}

// GitHub Copilot OAuth configuration
export function createGitHubCopilotOAuth(clientIdOverride?: string): GitHubCopilotOAuth {
  // Read GitHub OAuth configuration from environment variables
  const clientId = clientIdOverride?.trim() || import.meta.env.VITE_GITHUB_CLIENT_ID
  const clientSecret = import.meta.env.VITE_GITHUB_CLIENT_SECRET
  const redirectUri =
    import.meta.env.VITE_GITHUB_REDIRECT_URI || 'https://deepchatai.cn/auth/github/callback'

  logger.info('GitHub OAuth Configuration:')
  logger.info('- Client ID configured:', clientId ? '✅' : '❌')
  logger.info('- Client ID override provided:', clientIdOverride ? '✅' : '❌')
  logger.info('- Client Secret configured:', clientSecret ? '✅' : '❌')
  logger.info('- Redirect URI:', redirectUri)
  logger.info('- Environment variables check:')
  logger.info(
    '  - import.meta.env.VITE_GITHUB_CLIENT_ID:',
    import.meta.env.VITE_GITHUB_CLIENT_ID ? 'EXISTS' : 'NOT SET'
  )
  logger.info(
    '  - import.meta.env.VITE_GITHUB_CLIENT_SECRET:',
    import.meta.env.VITE_GITHUB_CLIENT_SECRET ? 'EXISTS' : 'NOT SET'
  )
  logger.info(
    '  - import.meta.env.VITE_GITHUB_REDIRECT_URI:',
    import.meta.env.VITE_GITHUB_REDIRECT_URI ? 'EXISTS' : 'NOT SET'
  )

  if (!clientId) {
    throw new Error(
      'GitHub Client ID is required. Please enter it in the Copilot settings input or set GITHUB_CLIENT_ID / VITE_GITHUB_CLIENT_ID in .env.'
    )
  }

  if (!clientSecret) {
    throw new Error(
      'GITHUB_CLIENT_SECRET environment variable is required. Please create a .env file with your GitHub OAuth Client Secret. You can use either GITHUB_CLIENT_SECRET or VITE_GITHUB_CLIENT_SECRET.'
    )
  }

  const config: GitHubOAuthConfig = {
    clientId,
    clientSecret,
    redirectUri,
    scope: 'read:user read:org'
  }
  if (is.dev) {
    logger.info('Final OAuth config:', {
      clientIdConfigured: !!config.clientId,
      redirectUri: config.redirectUri,
      scope: config.scope,
      clientSecretConfigured: !!config.clientSecret
    })
  }

  return new GitHubCopilotOAuth(config)
}
