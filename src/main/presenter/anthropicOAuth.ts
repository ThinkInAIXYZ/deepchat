import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import * as crypto from 'crypto'
import { BrowserWindow } from 'electron'

// Constants
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const CREDS_PATH = join(homedir(), '.deepchat', 'credentials', 'anthropic.json')

// Types
interface Credentials {
  access_token: string
  refresh_token: string
  expires_at: number // timestamp in ms
}

interface PKCEPair {
  verifier: string
  challenge: string
}

export class AnthropicOAuth {
  private authWindow: BrowserWindow | null = null
  private callbackResolve: ((value: string) => void) | null = null
  private callbackReject: ((reason?: any) => void) | null = null

  // 1. Generate PKCE pair
  private generatePKCE(): PKCEPair {
    const verifier = crypto.randomBytes(32).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')

    return { verifier, challenge }
  }

  // 2. Get OAuth authorization URL
  private getAuthorizationURL(pkce: PKCEPair): string {
    const url = new URL('https://claude.ai/oauth/authorize')

    url.searchParams.set('code', 'true')
    url.searchParams.set('client_id', CLIENT_ID)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', 'https://console.anthropic.com/oauth/code/callback')
    url.searchParams.set('scope', 'org:create_api_key user:profile user:inference')
    url.searchParams.set('code_challenge', pkce.challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', pkce.verifier)

    return url.toString()
  }

  // 3. Exchange authorization code for tokens
  private async exchangeCodeForTokens(code: string, verifier: string): Promise<Credentials> {
    const [authCode, state] = code.split('#')

    const response = await fetch('https://console.anthropic.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: authCode,
        state: state,
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
        code_verifier: verifier
      })
    })

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.statusText}`)
    }

    const data = await response.json()

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000
    }
  }

  // 4. Refresh access token
  private async refreshAccessToken(refreshToken: string): Promise<Credentials> {
    const response = await fetch('https://console.anthropic.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID
      })
    })

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`)
    }

    const data = await response.json()

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000
    }
  }

  // 5. Save credentials
  private async saveCredentials(creds: Credentials): Promise<void> {
    await fs.mkdir(dirname(CREDS_PATH), { recursive: true })
    await fs.writeFile(CREDS_PATH, JSON.stringify(creds, null, 2))
    await fs.chmod(CREDS_PATH, 0o600) // Read/write for owner only
  }

  // 6. Load credentials
  private async loadCredentials(): Promise<Credentials | null> {
    try {
      const data = await fs.readFile(CREDS_PATH, 'utf-8')
      return JSON.parse(data)
    } catch {
      return null
    }
  }

  // 7. Get valid access token (refresh if needed)
  public async getValidAccessToken(): Promise<string | null> {
    const creds = await this.loadCredentials()
    if (!creds) return null

    // If token is still valid, return it
    if (creds.expires_at > Date.now() + 60000) {
      // 1 minute buffer
      return creds.access_token
    }

    // Otherwise, refresh it
    try {
      const newCreds = await this.refreshAccessToken(creds.refresh_token)
      await this.saveCredentials(newCreds)
      return newCreds.access_token
    } catch {
      return null
    }
  }

  // 8. Complete OAuth flow with BrowserWindow
  public async completeOAuthFlow(): Promise<string> {
    // Try to get existing valid token
    const existingToken = await this.getValidAccessToken()
    if (existingToken) return existingToken

    // Otherwise, go through auth flow
    const pkce = this.generatePKCE()

    try {
      // Use BrowserWindow for better UX
      const authCode = await this.startOAuthFlowWithWindow(pkce)
      const credentials = await this.exchangeCodeForTokens(authCode, pkce.verifier)
      await this.saveCredentials(credentials)
      return credentials.access_token
    } catch (error) {
      console.error('OAuth flow failed:', error)
      throw error
    }
  }

  // 8a. Start OAuth flow with BrowserWindow
  private async startOAuthFlowWithWindow(pkce: PKCEPair): Promise<string> {
    return new Promise((resolve, reject) => {
      // Store callback functions
      this.callbackResolve = resolve
      this.callbackReject = reject

      // Build authorization URL
      const authUrl = this.getAuthorizationURL(pkce)
      console.log('Starting OAuth with URL:', authUrl)

      // Create authorization window
      this.authWindow = new BrowserWindow({
        width: 600,
        height: 800,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true
        },
        autoHideMenuBar: true,
        title: 'Anthropic OAuth Authorization'
      })

      // Monitor URL changes to catch the callback
      this.authWindow.webContents.on('will-redirect', (_event, url) => {
        console.log('OAuth redirecting to:', url)
        this.handleCallback(url)
      })

      this.authWindow.webContents.on('did-navigate', (_event, url) => {
        console.log('OAuth navigated to:', url)
        this.handleCallback(url)
      })

      // Handle new window requests (in case of popups)
      this.authWindow.webContents.setWindowOpenHandler(({ url }) => {
        console.log('OAuth new window requested for:', url)
        this.handleCallback(url)
        return { action: 'deny' }
      })

      // Handle window close
      this.authWindow.on('closed', () => {
        this.authWindow = null
        if (this.callbackReject) {
          this.callbackReject(new Error('User cancelled OAuth authorization'))
          this.callbackReject = null
          this.callbackResolve = null
        }
      })

      // Handle load errors
      this.authWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        console.error('OAuth page load failed:', errorCode, errorDescription)
        this.closeAuthWindow()
        if (this.callbackReject) {
          this.callbackReject(new Error(`Failed to load authorization page: ${errorDescription}`))
          this.callbackReject = null
          this.callbackResolve = null
        }
      })

      // Load authorization page
      this.authWindow.loadURL(authUrl)
      this.authWindow.show()

      // Set timeout (5 minutes)
      setTimeout(() => {
        if (this.authWindow) {
          this.closeAuthWindow()
          if (this.callbackReject) {
            this.callbackReject(new Error('OAuth flow timeout'))
            this.callbackReject = null
            this.callbackResolve = null
          }
        }
      }, 300000)
    })
  }

  // 8b. Handle OAuth callback URL
  private handleCallback(url: string): void {
    try {
      console.log('Processing callback URL:', url)

      // Check if this is the callback URL
      if (url.includes('console.anthropic.com/oauth/code/callback')) {
        // Extract code from URL parameters
        const urlObj = new URL(url)
        const code = urlObj.searchParams.get('code')
        const state = urlObj.searchParams.get('state')
        const error = urlObj.searchParams.get('error')

        if (error) {
          console.error('OAuth error:', error)
          this.closeAuthWindow()
          if (this.callbackReject) {
            this.callbackReject(new Error(`OAuth error: ${error}`))
            this.callbackReject = null
            this.callbackResolve = null
          }
          return
        }

        if (code && state) {
          console.log('OAuth code received:', code.substring(0, 10) + '...')
          this.closeAuthWindow()

          // Combine code and state as expected by exchangeCodeForTokens
          const authCode = `${code}#${state}`

          if (this.callbackResolve) {
            this.callbackResolve(authCode)
            this.callbackResolve = null
            this.callbackReject = null
          }
          return
        }
      }

      // Alternative: Check if we're on a page that might contain the code
      // This handles cases where the callback page shows the code in the content
      if (url.includes('console.anthropic.com') && this.authWindow) {
        // Inject script to extract code from page content
        this.authWindow.webContents
          .executeJavaScript(
            `
          (() => {
            try {
              // Look for code in various possible locations
              const codeElement = document.querySelector('[data-code], .code, #code, .authorization-code');
              if (codeElement) {
                return { code: codeElement.textContent || codeElement.value, source: 'element' };
              }

              // Look for code in text content
              const bodyText = document.body.textContent || '';
              const codeMatch = bodyText.match(/authorization.code[:\s]+([a-zA-Z0-9_-]+)/i) ||
                              bodyText.match(/code[:\s]+([a-zA-Z0-9_-]{20,})/i);
              if (codeMatch) {
                return { code: codeMatch[1], source: 'text' };
              }

              // Look in URL fragments or hidden inputs
              const hiddenInputs = document.querySelectorAll('input[type="hidden"]');
              for (const input of hiddenInputs) {
                if (input.name.toLowerCase().includes('code') && input.value) {
                  return { code: input.value, source: 'hidden_input' };
                }
              }

              return null;
            } catch (e) {
              return { error: e.message };
            }
          })()
        `
          )
          .then((result: any) => {
            if (result && result.code) {
              console.log('Extracted code from page content via', result.source)
              this.closeAuthWindow()

              if (this.callbackResolve) {
                // For extracted codes, we might not have the state, so we'll use the verifier as state
                const authCode = `${result.code}#${result.code}`
                this.callbackResolve(authCode)
                this.callbackResolve = null
                this.callbackReject = null
              }
            }
          })
          .catch((error: any) => {
            console.error('Failed to extract code from page:', error)
          })
      }
    } catch (error) {
      console.error('Error handling callback:', error)
    }
  }

  // 8c. Close auth window
  private closeAuthWindow(): void {
    if (this.authWindow) {
      this.authWindow.close()
      this.authWindow = null
    }
  }

  // 9. Manual credential input (for cases where OAuth isn't feasible)
  public async setCredentialsFromCode(code: string, verifier: string): Promise<string> {
    try {
      const creds = await this.exchangeCodeForTokens(code, verifier)
      await this.saveCredentials(creds)
      console.log('Credentials saved!')
      return creds.access_token
    } catch (error) {
      console.error('Failed to exchange code for tokens:', error)
      throw error
    }
  }

  // 10. Clear stored credentials
  public async clearCredentials(): Promise<void> {
    try {
      await fs.unlink(CREDS_PATH)
      console.log('Credentials cleared')
    } catch (error) {
      // File doesn't exist, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  // 11. Check if credentials exist
  public async hasCredentials(): Promise<boolean> {
    const creds = await this.loadCredentials()
    return creds !== null
  }
}

// Create singleton instance
export const createAnthropicOAuth = (): AnthropicOAuth => {
  return new AnthropicOAuth()
}
