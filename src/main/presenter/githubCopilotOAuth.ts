import { BrowserWindow } from 'electron'
import { randomBytes } from 'crypto'

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
   * 启动GitHub OAuth登录流程
   */
  async startLogin(): Promise<string> {
    return new Promise((resolve, reject) => {
      // 生成随机state用于安全验证
      this.state = randomBytes(16).toString('hex')

      // 构建授权URL
      const authUrl = this.buildAuthUrl()
      console.log('Starting GitHub OAuth with URL:', authUrl)

      // 创建授权窗口
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
        title: 'GitHub Copilot 授权'
      })

      // 监听URL变化以捕获授权回调
      this.authWindow.webContents.on('will-redirect', (_event, url) => {
        console.log('Redirecting to:', url)
        this.handleCallback(url, resolve, reject)
      })

      // 注意：did-get-redirect-request 在新版本Electron中已废弃
      // this.authWindow.webContents.on('did-get-redirect-request', (event, oldUrl, newUrl) => {
      //   console.log('Redirect request:', oldUrl, '->', newUrl)
      //   this.handleCallback(newUrl, resolve, reject)
      // })

      // 监听导航事件
      this.authWindow.webContents.on('did-navigate', (_event, url) => {
        console.log('Navigated to:', url)
        this.handleCallback(url, resolve, reject)
      })

      // 监听新窗口事件（GitHub可能在新窗口中打开）
      this.authWindow.webContents.setWindowOpenHandler(({ url }) => {
        console.log('New window requested for:', url)
        this.handleCallback(url, resolve, reject)
        return { action: 'deny' }
      })

      // 处理窗口关闭
      this.authWindow.on('closed', () => {
        this.authWindow = null
        reject(new Error('用户取消了授权'))
      })

      // 加载授权页面
      this.authWindow.loadURL(authUrl)
      this.authWindow.show()

      // 设置超时
      setTimeout(() => {
        if (this.authWindow) {
          this.closeWindow()
          reject(new Error('授权超时'))
        }
      }, 300000) // 5分钟超时
    })
  }

  /**
   * 构建GitHub OAuth授权URL
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
   * 处理OAuth回调
   */
  private handleCallback(
    url: string,
    resolve: (code: string) => void,
    reject: (error: Error) => void
  ): void {
    try {
      const urlObj = new URL(url)

      // 检查是否是我们的回调URL
      if (url.startsWith(this.config.redirectUri)) {
        const code = urlObj.searchParams.get('code')
        const error = urlObj.searchParams.get('error')
        const returnedState = urlObj.searchParams.get('state')

        // 验证state参数
        if (returnedState !== this.state) {
          console.error('State mismatch:', returnedState, 'vs', this.state)
          this.closeWindow()
          reject(new Error('安全验证失败：state参数不匹配'))
          return
        }

        if (error) {
          console.error('OAuth error:', error)
          this.closeWindow()
          reject(new Error(`GitHub授权失败: ${error}`))
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
      reject(new Error('解析回调URL失败'))
    }
  }

  /**
   * 用授权码交换访问令牌
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
   * 验证访问令牌
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
   * 关闭授权窗口
   */
  private closeWindow(): void {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.close()
      this.authWindow = null
    }
  }
}

// GitHub Copilot OAuth配置
export function createGitHubCopilotOAuth(): GitHubCopilotOAuth {
  // 从环境变量读取 GitHub OAuth 配置
  const clientId = process.env.GITHUB_CLIENT_ID || process.env.VITE_GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET || process.env.VITE_GITHUB_CLIENT_SECRET
  const redirectUri =
    process.env.GITHUB_REDIRECT_URI || process.env.VITE_GITHUB_REDIRECT_URI || 'https://deepchatai.cn/auth/github/callback'

  console.log('GitHub OAuth Configuration:')
  console.log('- Client ID configured:', clientId ? '✅' : '❌')
  console.log('- Client Secret configured:', clientSecret ? '✅' : '❌')
  console.log('- Redirect URI:', redirectUri)
  console.log('- Environment variables check:')
  console.log('  - process.env.GITHUB_CLIENT_ID:', process.env.GITHUB_CLIENT_ID ? 'EXISTS' : 'NOT SET')
  console.log('  - process.env.VITE_GITHUB_CLIENT_ID:', process.env.VITE_GITHUB_CLIENT_ID ? 'EXISTS' : 'NOT SET')
  console.log('  - process.env.GITHUB_CLIENT_SECRET:', process.env.GITHUB_CLIENT_SECRET ? 'EXISTS' : 'NOT SET')
  console.log('  - process.env.VITE_GITHUB_CLIENT_SECRET:', process.env.VITE_GITHUB_CLIENT_SECRET ? 'EXISTS' : 'NOT SET')

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

  console.log('Final OAuth config:', {
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scope: config.scope,
    clientSecretLength: config.clientSecret.length
  })

  return new GitHubCopilotOAuth(config)
}
