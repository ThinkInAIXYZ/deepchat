import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import * as crypto from 'crypto'
import { shell } from 'electron'

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

  // 8. Complete OAuth flow
  public async completeOAuthFlow(): Promise<string> {
    // Try to get existing valid token
    const existingToken = await this.getValidAccessToken()
    if (existingToken) return existingToken

    // Otherwise, go through auth flow
    const pkce = this.generatePKCE()
    const authUrl = this.getAuthorizationURL(pkce)

    console.log('Claude Code OAuth authentication required.')
    console.log('Opening browser for authentication...')

    try {
      // Use Electron's shell.openExternal instead of child_process.exec
      await shell.openExternal(authUrl)
    } catch (err) {
      console.log('Could not open browser automatically:', err)
      console.log('Please open this URL in your browser:')
      console.log(authUrl)
    }

    console.log('\nIf browser did not open, visit:')
    console.log(authUrl)
    console.log('\nPaste the authorization code here:')

    // In a real Electron app, you might want to use a different input method
    // For now, we'll return a promise that resolves when credentials are obtained
    return new Promise((resolve, reject) => {
      // This would be replaced with proper UI interaction in the actual implementation
      // For now, we'll simulate the flow by checking for saved credentials periodically
      const checkInterval = setInterval(async () => {
        try {
          const token = await this.getValidAccessToken()
          if (token) {
            clearInterval(checkInterval)
            resolve(token)
          }
        } catch (error) {
          clearInterval(checkInterval)
          reject(error)
        }
      }, 1000)

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(checkInterval)
        reject(new Error('OAuth flow timeout'))
      }, 300000)
    })
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
