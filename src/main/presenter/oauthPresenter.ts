import { BrowserWindow } from 'electron'
import { presenter } from '.'
import * as http from 'http'
import { URL } from 'url'
import { createGitHubCopilotOAuth } from './githubCopilotOAuth'
import { getGlobalGitHubCopilotDeviceFlow } from './githubCopilotDeviceFlow'
import { createAnthropicOAuth } from './anthropicOAuth'
import { eventBus } from '@/eventbus'

export interface OAuthConfig {
  authUrl: string
  redirectUri: string
  clientId: string
  clientSecret?: string
  scope: string
  responseType: string
}

export class OAuthPresenter {
  private authWindow: BrowserWindow | null = null
  private callbackServer: http.Server | null = null
  private callbackPort = 3000

  /**
   * Validate GitHub access token
   */
  private async validateGitHubAccessToken(token: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'DeepChat/1.0.0'
        }
      })

      return response.ok
    } catch (error) {
      console.error('Token validation failed:', error)
      return false
    }
  }

  /**
   * Start GitHub Copilot Device Flow login process (recommended)
   */
  async startGitHubCopilotDeviceFlowLogin(providerId: string): Promise<boolean> {
    try {
      const githubDeviceFlow = getGlobalGitHubCopilotDeviceFlow()
      const provider = presenter.configPresenter.getProviderById(providerId)

      // 首先检查现有认证状态
      if (provider && provider.apiKey) {
        const existingToken = await githubDeviceFlow.checkExistingAuth(provider.apiKey)
        if (existingToken) {
          return true
        }
      }

      // 开始Device Flow登录
      const accessToken = await githubDeviceFlow.startDeviceFlow()

      // Validate token
      console.log('Validating access token...')
      const isValid = await this.validateGitHubAccessToken(accessToken)
      if (!isValid) {
        throw new Error('Obtained access token is invalid')
      }

      // 保存访问令牌到provider配置
      if (provider) {
        provider.apiKey = accessToken
        presenter.configPresenter.setProviderById(providerId, provider)
        console.log('[GitHub Copilot] Device Flow login completed successfully')

        // 触发provider更新事件，通知前端刷新UI
        eventBus.emit('providerUpdated', { providerId })
      } else {
        throw new Error(`Provider ${providerId} not found`)
      }

      return true
    } catch (error) {
      console.error('[GitHub Copilot] Device Flow login failed:', error)
      return false
    }
  }

  /**
   * Start GitHub Copilot OAuth login process (traditional method)
   */
  async startGitHubCopilotLogin(providerId: string): Promise<boolean> {
    try {
      console.log(
        '[GitHub Copilot][OAuth] Starting traditional OAuth login for provider:',
        providerId
      )

      // 使用专门的GitHub Copilot OAuth实现
      console.log('[GitHub Copilot][OAuth] Creating GitHub OAuth instance...')
      const githubOAuth = createGitHubCopilotOAuth()

      // 开始OAuth登录
      console.log('[GitHub Copilot][OAuth] Starting OAuth login flow...')
      const authCode = await githubOAuth.startLogin()
      console.log(
        '[GitHub Copilot][OAuth] OAuth login completed, auth code received:',
        authCode ? 'SUCCESS' : 'FAILED'
      )

      if (!authCode) {
        throw new Error('Failed to obtain authorization code')
      }

      console.log('[GitHub Copilot][OAuth] Auth code received successfully')

      // 用授权码交换访问令牌
      console.log('[GitHub Copilot][OAuth] Exchanging auth code for access token...')
      const accessToken = await githubOAuth.exchangeCodeForToken(authCode)
      console.log(
        '[GitHub Copilot][OAuth] Token exchange completed, access token received:',
        accessToken ? 'SUCCESS' : 'FAILED'
      )

      if (accessToken) {
        console.log('[GitHub Copilot][OAuth] Access token received successfully')
      }

      // Validate token
      console.log('[GitHub Copilot][OAuth] Validating access token...')
      const isValid = await githubOAuth.validateToken(accessToken)
      console.log('[GitHub Copilot][OAuth] Token validation result:', isValid)

      if (!isValid) {
        console.error('[GitHub Copilot][OAuth] Token validation failed - token is invalid')
        throw new Error('获取的访问令牌无效')
      }

      // 保存访问令牌到provider配置
      console.log('[GitHub Copilot][OAuth] Saving access token to provider configuration...')
      const provider = presenter.configPresenter.getProviderById(providerId)
      if (provider) {
        provider.apiKey = accessToken
        presenter.configPresenter.setProviderById(providerId, provider)
        console.log(
          '[GitHub Copilot][OAuth] Access token saved successfully to provider:',
          providerId
        )
        console.log('[GitHub Copilot][OAuth] Traditional OAuth login completed successfully')

        // 触发provider更新事件，通知前端刷新UI
        eventBus.emit('providerUpdated', { providerId })
      } else {
        console.error('[GitHub Copilot][OAuth] Provider not found:', providerId)
        throw new Error(`Provider ${providerId} not found`)
      }

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
      return false
    }
  }

  /**
   * Check if Anthropic OAuth credentials exist
   */
  async hasAnthropicCredentials(): Promise<boolean> {
    try {
      const anthropicOAuth = createAnthropicOAuth()
      return await anthropicOAuth.hasCredentials()
    } catch (error) {
      console.error('Failed to check Anthropic credentials:', error)
      return false
    }
  }

  /**
   * Get valid Anthropic access token
   */
  async getAnthropicAccessToken(): Promise<string | null> {
    try {
      const anthropicOAuth = createAnthropicOAuth()
      return await anthropicOAuth.getValidAccessToken()
    } catch (error) {
      console.error('Failed to get Anthropic access token:', error)
      return null
    }
  }

  /**
   * Clear Anthropic OAuth credentials
   */
  async clearAnthropicCredentials(): Promise<void> {
    try {
      const anthropicOAuth = createAnthropicOAuth()
      await anthropicOAuth.clearCredentials()
    } catch (error) {
      console.error('Failed to clear Anthropic credentials:', error)
      throw error
    }
  }

  /**
   * Start Anthropic OAuth flow (external browser)
   */
  async startAnthropicOAuthFlow(): Promise<string> {
    try {
      console.log('Starting Anthropic OAuth flow with external browser')
      const anthropicOAuth = createAnthropicOAuth()
      const authUrl = await anthropicOAuth.startOAuthFlow()
      console.log('OAuth URL opened in external browser:', authUrl)
      return authUrl
    } catch (error) {
      console.error('Failed to start Anthropic OAuth flow:', error)
      throw error
    }
  }

  /**
   * Complete Anthropic OAuth flow (using user-provided code)
   */
  async completeAnthropicOAuthWithCode(code: string): Promise<boolean> {
    try {
      console.log('Completing Anthropic OAuth with user-provided code')
      const anthropicOAuth = createAnthropicOAuth()
      const accessToken = await anthropicOAuth.completeOAuthWithCode(code)

      if (!accessToken) {
        console.error('Failed to get access token from code exchange')
        return false
      }

      console.log('Successfully obtained access token')
      return true
    } catch (error) {
      console.error('Failed to complete Anthropic OAuth with code:', error)
      return false
    }
  }

  /**
   * Cancel Anthropic OAuth flow
   */
  async cancelAnthropicOAuthFlow(): Promise<void> {
    try {
      console.log('Cancelling Anthropic OAuth flow')
      const anthropicOAuth = createAnthropicOAuth()
      anthropicOAuth.cancelOAuthFlow()
    } catch (error) {
      console.error('Failed to cancel Anthropic OAuth flow:', error)
    }
  }

  /**
   * Start OAuth login flow (generic method)
   */
  async startOAuthLogin(providerId: string, config: OAuthConfig): Promise<boolean> {
    try {
      // Start callback server
      await this.startCallbackServer()

      // Start OAuth login
      const authCode = await this.startOAuthFlow(config)

      // Stop callback server
      this.stopCallbackServer()

      // 用授权码交换访问令牌
      const accessToken = await this.exchangeCodeForToken(authCode, config)

      // Save access token to provider configuration
      const provider = presenter.configPresenter.getProviderById(providerId)
      if (provider) {
        provider.apiKey = accessToken
        presenter.configPresenter.setProviderById(providerId, provider)
      }

      return true
    } catch (error) {
      console.error('OAuth login failed:', error)
      this.stopCallbackServer()

      return false
    }
  }

  /**
   * Start callback server
   */
  private async startCallbackServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.callbackServer = http.createServer((req, res) => {
        const url = new URL(req.url!, `http://localhost:${this.callbackPort}`)

        console.log('Callback server received request:', url.href)

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (url.pathname === '/auth/callback') {
          const code = url.searchParams.get('code')
          const error = url.searchParams.get('error')

          if (code) {
            // Success page
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <title>Authorization Successful</title>
                <style>
                  body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                  .success { color: #28a745; }
                </style>
              </head>
              <body>
                <h1 class="success">✅ Authorization Successful</h1>
                <p>You have successfully authorized GitHub Copilot access.</p>
                <p>You can close this window now.</p>
                <script>
                  // Auto close window after 3 seconds
                  setTimeout(() => {
                    window.close();
                  }, 3000);
                </script>
              </body>
              </html>
            `)

            // Trigger callback handling
            this.handleServerCallback(code, null)
          } else if (error) {
            // Error page
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <title>Authorization Failed</title>
                <style>
                  body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                  .error { color: #dc3545; }
                </style>
              </head>
              <body>
                <h1 class="error">❌ Authorization Failed</h1>
                <p>An error occurred during authorization: ${error}</p>
                <p>You can close this window and try again.</p>
              </body>
              </html>
            `)

            this.handleServerCallback(null, error)
          } else {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Invalid callback request')
          }
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not found')
        }
      })

      this.callbackServer.listen(this.callbackPort, 'localhost', () => {
        console.log(`OAuth callback server started on http://localhost:${this.callbackPort}`)
        resolve()
      })

      this.callbackServer.on('error', (error) => {
        console.error('Callback server error:', error)
        reject(error)
      })
    })
  }

  /**
   * Stop callback server
   */
  private stopCallbackServer(): void {
    if (this.callbackServer) {
      this.callbackServer.close()
      this.callbackServer = null
      console.log('OAuth callback server stopped')
    }
  }

  // Callback handling resolve and reject functions
  private callbackResolve: ((value: string) => void) | null = null
  private callbackReject: ((reason?: Error) => void) | null = null

  /**
   * Handle server callback
   */
  private handleServerCallback(code: string | null, error: string | null): void {
    if (error) {
      console.error('OAuth server callback error:', error)
      this.callbackReject?.(new Error(`OAuth authorization failed: ${error}`))
    } else if (code) {
      console.log('OAuth server callback success, received authorization code')
      this.callbackResolve?.(code)
    }

    // Clean up callback functions
    this.callbackResolve = null
    this.callbackReject = null
  }

  /**
   * Start OAuth flow
   */
  private async startOAuthFlow(config: OAuthConfig): Promise<string> {
    return new Promise((resolve, reject) => {
      // Save callback functions
      this.callbackResolve = resolve
      this.callbackReject = reject

      // Create authorization window
      this.authWindow = new BrowserWindow({
        width: 500,
        height: 700,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        },
        autoHideMenuBar: true,
        title: 'GitHub Authorization Login'
      })

      // Build authorization URL
      const authUrl = this.buildAuthUrl(config)
      console.log('Opening OAuth URL:', authUrl)

      // Load authorization page
      this.authWindow.loadURL(authUrl)
      this.authWindow.show()

      // Handle window close
      this.authWindow.on('closed', () => {
        this.authWindow = null
        if (this.callbackReject) {
          this.callbackReject(new Error('User cancelled login'))
          this.callbackReject = null
          this.callbackResolve = null
        }
      })

      // Handle loading errors
      this.authWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        console.error('OAuth page load failed:', errorCode, errorDescription)
        this.closeAuthWindow()
        if (this.callbackReject) {
          this.callbackReject(new Error(`Failed to load authorization page: ${errorDescription}`))
          this.callbackReject = null
          this.callbackResolve = null
        }
      })

      // Monitor page navigation to check if callback page is reached
      this.authWindow.webContents.on('did-navigate', (_event, navigationUrl) => {
        console.log('OAuth window navigated to:', navigationUrl)
        // If navigated to our callback page, authorization flow is complete
        if (navigationUrl.includes('deepchatai.cn/auth/github/callback')) {
          // Close authorization window as callback server handles remaining logic
          setTimeout(() => {
            this.closeAuthWindow()
          }, 2000) // Close after 2 seconds to let user see success page
        }
      })
    })
  }

  /**
   * Build authorization URL
   */
  private buildAuthUrl(config: OAuthConfig): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: config.responseType,
      scope: config.scope
    })

    return `${config.authUrl}?${params.toString()}`
  }

  /**
   * Exchange authorization code for access token
   */
  private async exchangeCodeForToken(code: string, config: OAuthConfig): Promise<string> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'DeepChat/1.0.0'
      },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret || process.env.GITHUB_CLIENT_SECRET,
        code: code,
        redirect_uri: config.redirectUri
      })
    })

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as {
      access_token: string
      error?: string
      error_description?: string
    }

    if (data.error) {
      throw new Error(`Token exchange error: ${data.error_description || data.error}`)
    }

    return data.access_token
  }

  /**
   * Close authorization window
   */
  private closeAuthWindow(): void {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.close()
      this.authWindow = null
    }
  }
}

// GitHub Copilot OAuth configuration
export const GITHUB_COPILOT_OAUTH_CONFIG: OAuthConfig = {
  authUrl: 'https://github.com/login/oauth/authorize',
  redirectUri:
    import.meta.env.VITE_GITHUB_REDIRECT_URI || 'https://deepchatai.cn/auth/github/callback',
  clientId: import.meta.env.VITE_GITHUB_CLIENT_ID,
  clientSecret: import.meta.env.VITE_GITHUB_CLIENT_SECRET,
  scope: 'read:user read:org',
  responseType: 'code'
}
