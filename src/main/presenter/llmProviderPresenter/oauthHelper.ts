import { BrowserWindow } from 'electron'
import { eventBus, SendTarget } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'

export interface OAuthConfig {
  authUrl: string
  redirectUri: string
  clientId: string
  scope: string
  responseType: string
}

export class OAuthHelper {
  private authWindow: BrowserWindow | null = null

  constructor(private config: OAuthConfig) {}

  /**
   * 开始OAuth登录流程
   */
  async startLogin(): Promise<string> {
    return new Promise((resolve, reject) => {
      // 发送登录开始事件
      eventBus.send(CONFIG_EVENTS.OAUTH_LOGIN_START, SendTarget.ALL_WINDOWS)

      // 创建授权窗口
      this.authWindow = new BrowserWindow({
        width: 400,
        height: 600,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        },
        autoHideMenuBar: true,
        title: '登录 GitHub Copilot'
      })

      // 构建授权URL
      const authUrl = this.buildAuthUrl()

      // 加载授权页面
      this.authWindow.loadURL(authUrl)
      this.authWindow.show()

      // 监听URL变化
      this.authWindow.webContents.on('will-redirect', (_event, navigationUrl) => {
        this.handleCallback(navigationUrl, resolve, reject)
      })

      this.authWindow.webContents.on('did-navigate', (_event, navigationUrl) => {
        this.handleCallback(navigationUrl, resolve, reject)
      })

      // 处理窗口关闭
      this.authWindow.on('closed', () => {
        this.authWindow = null
        if (!resolve) {
          reject(new Error('用户取消了登录'))
        }
      })

      // 处理加载错误
      this.authWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        console.error('OAuth page load failed:', errorCode, errorDescription)
        this.closeAuthWindow()
        reject(new Error(`加载授权页面失败: ${errorDescription}`))
      })
    })
  }

  /**
   * 构建授权URL
   */
  private buildAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: this.config.responseType,
      scope: this.config.scope
    })

    return `${this.config.authUrl}?${params.toString()}`
  }

  /**
   * 处理回调
   */
  private handleCallback(
    url: string,
    resolve: (value: string) => void,
    reject: (reason?: Error) => void
  ): void {
    if (url.startsWith(this.config.redirectUri)) {
      try {
        const urlObj = new URL(url)
        const code = urlObj.searchParams.get('code')
        const error = urlObj.searchParams.get('error')

        if (error) {
          console.error('OAuth error:', error)
          eventBus.send(CONFIG_EVENTS.OAUTH_LOGIN_ERROR, SendTarget.ALL_WINDOWS, error)
          reject(new Error(`OAuth授权失败: ${error}`))
        } else if (code) {
          console.log('OAuth success, received authorization code')
          eventBus.send(CONFIG_EVENTS.OAUTH_LOGIN_SUCCESS, SendTarget.ALL_WINDOWS, code)
          resolve(code)
        } else {
          reject(new Error('未收到授权码'))
        }
      } catch (error) {
        console.error('Error parsing callback URL:', error)
        reject(new Error('解析回调URL失败'))
      }

      this.closeAuthWindow()
    }
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
  scope: 'read:user read:org',
  responseType: 'code'
}
