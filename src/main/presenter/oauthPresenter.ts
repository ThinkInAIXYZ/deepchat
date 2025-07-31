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
   * 验证GitHub访问令牌
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
   * 开始GitHub Copilot Device Flow登录流程（推荐）
   */
  async startGitHubCopilotDeviceFlowLogin(providerId: string): Promise<boolean> {
    try {
      console.log('Starting GitHub Copilot Device Flow login for provider:', providerId)

      // 使用专门的GitHub Copilot Device Flow实现
      console.log('Creating GitHub Device Flow instance...')
      const githubDeviceFlow = createGitHubCopilotDeviceFlow()

      // 开始Device Flow登录
      console.log('Starting Device Flow login...')
      const accessToken = await githubDeviceFlow.startDeviceFlow()
      console.log('Received access token:', accessToken ? 'SUCCESS' : 'FAILED')

      // 验证令牌
      console.log('Validating access token...')
      const isValid = await this.validateGitHubAccessToken(accessToken)
      console.log('Token validation result:', isValid)

      if (!isValid) {
        throw new Error('获取的访问令牌无效')
      }

      // 保存访问令牌到provider配置
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
   * 开始GitHub Copilot OAuth登录流程（传统方式）
   */
  async startGitHubCopilotLogin(providerId: string): Promise<boolean> {
    try {
      console.log('Starting GitHub Copilot OAuth login for provider:', providerId)

      // 使用专门的GitHub Copilot OAuth实现
      console.log('Creating GitHub OAuth instance...')
      const githubOAuth = createGitHubCopilotOAuth()

      // 开始OAuth登录
      console.log('Starting OAuth login flow...')
      const authCode = await githubOAuth.startLogin()
      console.log('Received auth code:', authCode ? 'SUCCESS' : 'FAILED')

      // 用授权码交换访问令牌
      console.log('Exchanging auth code for access token...')
      const accessToken = await githubOAuth.exchangeCodeForToken(authCode)
      console.log('Received access token:', accessToken ? 'SUCCESS' : 'FAILED')

      // 验证令牌
      console.log('Validating access token...')
      const isValid = await githubOAuth.validateToken(accessToken)
      console.log('Token validation result:', isValid)

      if (!isValid) {
        throw new Error('获取的访问令牌无效')
      }

      // 保存访问令牌到provider配置
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
   * 检查Anthropic OAuth凭据是否存在
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
   * 获取有效的Anthropic访问令牌
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
   * 清除Anthropic OAuth凭据
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
   * 启动Anthropic OAuth流程（外部浏览器）
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
   * 完成Anthropic OAuth流程（使用用户输入的code）
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
   * 取消Anthropic OAuth流程
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
   * 开始OAuth登录流程（通用方法）
   */
  async startOAuthLogin(providerId: string, config: OAuthConfig): Promise<boolean> {
    try {
      // 启动回调服务器
      await this.startCallbackServer()

      // 开始OAuth登录
      const authCode = await this.startOAuthFlow(config)

      // 停止回调服务器
      this.stopCallbackServer()

      // 用授权码交换访问令牌
      const accessToken = await this.exchangeCodeForToken(authCode, config)

      // 保存访问令牌到provider配置
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
   * 启动回调服务器
   */
  private async startCallbackServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.callbackServer = http.createServer((req, res) => {
        const url = new URL(req.url!, `http://localhost:${this.callbackPort}`)

        console.log('Callback server received request:', url.href)

        // 设置CORS头
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (url.pathname === '/auth/callback') {
          const code = url.searchParams.get('code')
          const error = url.searchParams.get('error')

          if (code) {
            // 成功页面
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <title>授权成功</title>
                <style>
                  body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                  .success { color: #28a745; }
                </style>
              </head>
              <body>
                <h1 class="success">✅ 授权成功</h1>
                <p>您已成功授权 GitHub Copilot 访问权限。</p>
                <p>您可以关闭此窗口了。</p>
                <script>
                  // 3秒后自动关闭窗口
                  setTimeout(() => {
                    window.close();
                  }, 3000);
                </script>
              </body>
              </html>
            `)

            // 触发回调处理
            this.handleServerCallback(code, null)
          } else if (error) {
            // 错误页面
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <title>授权失败</title>
                <style>
                  body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                  .error { color: #dc3545; }
                </style>
              </head>
              <body>
                <h1 class="error">❌ 授权失败</h1>
                <p>授权过程中发生错误：${error}</p>
                <p>您可以关闭此窗口并重试。</p>
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
   * 停止回调服务器
   */
  private stopCallbackServer(): void {
    if (this.callbackServer) {
      this.callbackServer.close()
      this.callbackServer = null
      console.log('OAuth callback server stopped')
    }
  }

  // 回调处理的resolve和reject函数
  private callbackResolve: ((value: string) => void) | null = null
  private callbackReject: ((reason?: Error) => void) | null = null

  /**
   * 处理服务器回调
   */
  private handleServerCallback(code: string | null, error: string | null): void {
    if (error) {
      console.error('OAuth server callback error:', error)
      this.callbackReject?.(new Error(`OAuth授权失败: ${error}`))
    } else if (code) {
      console.log('OAuth server callback success, received code:', code)
      this.callbackResolve?.(code)
    }

    // 清理回调函数
    this.callbackResolve = null
    this.callbackReject = null
  }

  /**
   * 开始OAuth流程
   */
  private async startOAuthFlow(config: OAuthConfig): Promise<string> {
    return new Promise((resolve, reject) => {
      // 保存回调函数
      this.callbackResolve = resolve
      this.callbackReject = reject

      // 创建授权窗口
      this.authWindow = new BrowserWindow({
        width: 500,
        height: 700,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        },
        autoHideMenuBar: true,
        title: 'GitHub 授权登录'
      })

      // 构建授权URL
      const authUrl = this.buildAuthUrl(config)
      console.log('Opening OAuth URL:', authUrl)

      // 加载授权页面
      this.authWindow.loadURL(authUrl)
      this.authWindow.show()

      // 处理窗口关闭
      this.authWindow.on('closed', () => {
        this.authWindow = null
        if (this.callbackReject) {
          this.callbackReject(new Error('用户取消了登录'))
          this.callbackReject = null
          this.callbackResolve = null
        }
      })

      // 处理加载错误
      this.authWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        console.error('OAuth page load failed:', errorCode, errorDescription)
        this.closeAuthWindow()
        if (this.callbackReject) {
          this.callbackReject(new Error(`加载授权页面失败: ${errorDescription}`))
          this.callbackReject = null
          this.callbackResolve = null
        }
      })

      // 监听页面导航，检查是否到达了回调页面
      this.authWindow.webContents.on('did-navigate', (_event, navigationUrl) => {
        console.log('OAuth window navigated to:', navigationUrl)
        // 如果导航到了我们的回调页面，说明授权流程已经完成
        if (navigationUrl.includes('deepchatai.cn/auth/github/callback')) {
          // 关闭授权窗口，因为回调服务器会处理剩余的逻辑
          setTimeout(() => {
            this.closeAuthWindow()
          }, 2000) // 2秒后关闭，让用户看到成功页面
        }
      })
    })
  }

  /**
   * 构建授权URL
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
   * 用授权码交换访问令牌
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
   * 关闭授权窗口
   */
  private closeAuthWindow(): void {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.close()
      this.authWindow = null
    }
  }
}

// GitHub Copilot的OAuth配置
export const GITHUB_COPILOT_OAUTH_CONFIG: OAuthConfig = {
  authUrl: 'https://github.com/login/oauth/authorize',
  redirectUri:
    import.meta.env.VITE_GITHUB_REDIRECT_URI || 'https://deepchatai.cn/auth/github/callback',
  clientId: import.meta.env.VITE_GITHUB_CLIENT_ID,
  clientSecret: import.meta.env.VITE_GITHUB_CLIENT_SECRET,
  scope: 'read:user read:org',
  responseType: 'code'
}
