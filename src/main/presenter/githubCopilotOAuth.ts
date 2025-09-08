import { BrowserWindow } from 'electron'
import { randomBytes } from 'crypto'
import { is } from '@electron-toolkit/utils'

export interface GitHubOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scope: string
}

export class GitHubCopilotOAuth {
  private authWindow: BrowserWindow | null = null
  private state: string = ''

  constructor(private config: GitHubOAuthConfig) {}

  /**
   * Start GitHub OAuth login process
   */
  async startLogin(): Promise<string> {
    return new Promise((resolve, reject) => {
      // Generate random state for security verification
      this.state = randomBytes(16).toString('hex')

      // Build authorization URL
      const authUrl = this.buildAuthUrl()
      console.log('Starting GitHub OAuth with URL:', authUrl)

      // Create authorization window
      this.authWindow = new BrowserWindow({
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

      // Monitor URL changes to capture authorization callback
      this.authWindow.webContents.on('will-redirect', (_event, url) => {
        console.log('Redirecting to:', url)
        this.handleCallback(url, resolve, reject)
      })

      // Note: did-get-redirect-request is deprecated in newer Electron versions
      // this.authWindow.webContents.on('did-get-redirect-request', (event, oldUrl, newUrl) => {
      //   console.log('Redirect request:', oldUrl, '->', newUrl)
      //   this.handleCallback(newUrl, resolve, reject)
      // })

      // Monitor navigation events
      this.authWindow.webContents.on('did-navigate', (_event, url) => {
        console.log('Navigated to:', url)
        this.handleCallback(url, resolve, reject)
      })

      // Monitor new window events (GitHub may open in new window)
      this.authWindow.webContents.setWindowOpenHandler(({ url }) => {
        console.log('New window requested for:', url)
        this.handleCallback(url, resolve, reject)
        return { action: 'deny' }
      })

      // Handle window close
      this.authWindow.on('closed', () => {
        this.authWindow = null
        reject(new Error('User cancelled authorization'))
      })

      // Load authorization page
      this.authWindow.loadURL(authUrl)
      this.authWindow.show()

      // Set timeout
      setTimeout(() => {
        if (this.authWindow) {
          this.closeWindow()
          reject(new Error('Authorization timeout'))
        }
      }, 300000) // 5 minute timeout
    })
  }

  /**
   * Build GitHub OAuth authorization URL
   */
  private buildAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope,
      state: this.state,
      response_type: 'code'
    })

    return `https://github.com/login/oauth/authorize?${params.toString()}`
  }

  /**
   * Handle OAuth callback
   */
  private handleCallback(
    url: string,
    resolve: (code: string) => void,
    reject: (error: Error) => void
  ): void {
    try {
      const urlObj = new URL(url)

      // Check if this is our callback URL
      if (url.startsWith(this.config.redirectUri)) {
        const code = urlObj.searchParams.get('code')
        const error = urlObj.searchParams.get('error')
        const returnedState = urlObj.searchParams.get('state')

        // Verify state parameter
        if (returnedState !== this.state) {
          console.error('State mismatch:', returnedState, 'vs', this.state)
          this.closeWindow()
          reject(new Error('Security verification failed: state parameter mismatch'))
          return
        }

        if (error) {
          console.error('OAuth error:', error)
          this.closeWindow()
          reject(new Error(`GitHub authorization failed: ${error}`))
        } else if (code) {
          console.log('OAuth success, received code:', code)
          this.closeWindow()
          resolve(code)
        } else {
          console.warn('No code or error in callback URL:', url)
        }
      }
    } catch (error) {
      console.error('Error parsing callback URL:', error)
      this.closeWindow()
      reject(new Error('Failed to parse callback URL'))
    }
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<string> {
    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'DeepChat/1.0.0'
        },
        body: JSON.stringify({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code: code,
          redirect_uri: this.config.redirectUri
        })
      })

      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`)
      }

      const data = (await response.json()) as {
        access_token?: string
        error?: string
        error_description?: string
      }

      if (data.error) {
        throw new Error(`Token exchange error: ${data.error_description || data.error}`)
      }

      if (!data.access_token) {
        throw new Error('No access token received')
      }

      return data.access_token
    } catch (error) {
      console.error('Token exchange failed:', error)
      throw error
    }
  }

  /**
   * Validate access token
   */
  async validateToken(token: string): Promise<boolean> {
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
   * Close authorization window
   */
  private closeWindow(): void {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.close()
      this.authWindow = null
    }
  }
}

// GitHub Copilot OAuth configuration
export function createGitHubCopilotOAuth(): GitHubCopilotOAuth {
  // Read GitHub OAuth configuration from environment variables
  const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID
  const clientSecret = import.meta.env.VITE_GITHUB_CLIENT_SECRET
  const redirectUri =
    import.meta.env.VITE_GITHUB_REDIRECT_URI || 'https://deepchatai.cn/auth/github/callback'

  console.log('GitHub OAuth Configuration:')
  console.log('- Client ID configured:', clientId ? '✅' : '❌')
  console.log('- Client Secret configured:', clientSecret ? '✅' : '❌')
  console.log('- Redirect URI:', redirectUri)
  console.log('- Environment variables check:')
  console.log(
    '  - import.meta.env.VITE_GITHUB_CLIENT_ID:',
    import.meta.env.VITE_GITHUB_CLIENT_ID ? 'EXISTS' : 'NOT SET'
  )
  console.log(
    '  - import.meta.env.VITE_GITHUB_CLIENT_SECRET:',
    import.meta.env.VITE_GITHUB_CLIENT_SECRET ? 'EXISTS' : 'NOT SET'
  )
  console.log(
    '  - import.meta.env.VITE_GITHUB_REDIRECT_URI:',
    import.meta.env.VITE_GITHUB_REDIRECT_URI ? 'EXISTS' : 'NOT SET'
  )

  if (!clientId) {
    throw new Error(
      'GITHUB_CLIENT_ID environment variable is required. Please create a .env file with your GitHub OAuth Client ID. You can use either GITHUB_CLIENT_ID or VITE_GITHUB_CLIENT_ID.'
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
    console.log('Final OAuth config:', {
      clientId:
        config.clientId.substring(0, 4) +
        '****' +
        config.clientId.substring(config.clientId.length - 4),
      redirectUri: config.redirectUri,
      scope: config.scope,
      clientSecretLength: config.clientSecret.length
    })
  }

  return new GitHubCopilotOAuth(config)
}
