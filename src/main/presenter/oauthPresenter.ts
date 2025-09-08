import { BrowserWindow } from 'electron'
import { presenter } from '.'
import * as http from 'http'
import { URL } from 'url'
import { createGitHubCopilotOAuth } from './githubCopilotOAuth'
import { createGitHubCopilotDeviceFlow } from './githubCopilotDeviceFlow'
import { createAnthropicOAuth } from './anthropicOAuth'

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
      console.log('Starting GitHub Copilot Device Flow login for provider:', providerId)

      // Use dedicated GitHub Copilot Device Flow implementation
      console.log('Creating GitHub Device Flow instance...')
      const githubDeviceFlow = createGitHubCopilotDeviceFlow()

      // Start Device Flow login
      console.log('Starting Device Flow login...')
      const accessToken = await githubDeviceFlow.startDeviceFlow()
      console.log('Received access token:', accessToken ? 'SUCCESS' : 'FAILED')

      // Validate token
      console.log('Validating access token...')
      const isValid = await this.validateGitHubAccessToken(accessToken)
      console.log('Token validation result:', isValid)

      if (!isValid) {
        throw new Error('Obtained access token is invalid')
      }

      // Save access token to provider configuration
      console.log('Saving access token to provider configuration...')
      const provider = presenter.configPresenter.getProviderById(providerId)
      if (provider) {
        provider.apiKey = accessToken
        presenter.configPresenter.setProviderById(providerId, provider)
        console.log('Access token saved successfully')
      } else {
        console.warn('Provider not found:', providerId)
      }

      return true
    } catch (error) {
      console.error('GitHub Copilot Device Flow login failed:', error)
      return false
    }
  }

  /**
   * Start GitHub Copilot OAuth login process (traditional method)
   */
  async startGitHubCopilotLogin(providerId: string): Promise<boolean> {
    try {
      console.log('Starting GitHub Copilot OAuth login for provider:', providerId)

      // Use dedicated GitHub Copilot OAuth implementation
      console.log('Creating GitHub OAuth instance...')
      const githubOAuth = createGitHubCopilotOAuth()

      // Start OAuth login
      console.log('Starting OAuth login flow...')
      const authCode = await githubOAuth.startLogin()
      console.log('Received auth code:', authCode ? 'SUCCESS' : 'FAILED')

      // 用授权码交换访问令牌
      console.log('Exchanging auth code for access token...')
      const accessToken = await githubOAuth.exchangeCodeForToken(authCode)
      console.log('Received access token:', accessToken ? 'SUCCESS' : 'FAILED')

      // Validate token
      console.log('Validating access token...')
      const isValid = await githubOAuth.validateToken(accessToken)
      console.log('Token validation result:', isValid)

      if (!isValid) {
        throw new Error('Obtained access token is invalid')
      }

      // Save access token to provider configuration
      console.log('Saving access token to provider configuration...')
      const provider = presenter.configPresenter.getProviderById(providerId)
      if (provider) {
        provider.apiKey = accessToken
        presenter.configPresenter.setProviderById(providerId, provider)
        console.log('Access token saved successfully')
      } else {
        console.warn('Provider not found:', providerId)
      }

      console.log('GitHub Copilot OAuth login completed successfully')
      return true
    } catch (error) {
      console.error('GitHub Copilot OAuth login failed:')
      console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error)
      console.error('Error message:', error instanceof Error ? error.message : error)
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace')
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
      console.log('OAuth server callback success, received code:', code)
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
