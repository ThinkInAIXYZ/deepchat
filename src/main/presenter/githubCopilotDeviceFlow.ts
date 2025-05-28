import { BrowserWindow, shell } from 'electron'

export interface DeviceFlowConfig {
  clientId: string
  scope: string
}

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export interface AccessTokenResponse {
  access_token?: string
  token_type?: string
  scope?: string
  error?: string
  error_description?: string
}

export class GitHubCopilotDeviceFlow {
  private config: DeviceFlowConfig
  private pollingInterval: NodeJS.Timeout | null = null

  constructor(config: DeviceFlowConfig) {
    this.config = config
  }

  /**
   * 启动 Device Flow 认证流程
   */
  async startDeviceFlow(): Promise<string> {
    console.log('🚀 [GitHub Copilot Device Flow] Starting Device Flow authentication...')
    console.log(`   Client ID: ${this.config.clientId || 'NOT SET'}`)
    console.log(`   Scope: ${this.config.scope}`)

    // 检查 Client ID 是否配置
    if (!this.config.clientId || this.config.clientId.trim() === '') {
      throw new Error(
        'GitHub Client ID is not configured. To use GitHub Copilot, please:\n' +
        '1. Create a GitHub OAuth App at https://github.com/settings/applications/new\n' +
        '2. Set the Client ID in environment variables:\n' +
        '   - GITHUB_CLIENT_ID=your_client_id_here\n' +
        '   OR\n' +
        '   - VITE_GITHUB_CLIENT_ID=your_client_id_here\n' +
        '3. Restart the application\n\n' +
        'Note: GitHub Copilot requires OAuth authentication to access the API.'
      )
    }

    try {
      // Step 1: 获取设备验证码
      console.log('📋 [GitHub Copilot Device Flow] Step 1: Requesting device code...')
      const deviceCodeResponse = await this.requestDeviceCode()
      
      console.log('✅ [GitHub Copilot Device Flow] Device code received:')
      console.log(`   User Code: ${deviceCodeResponse.user_code}`)
      console.log(`   Verification URI: ${deviceCodeResponse.verification_uri}`)
      console.log(`   Expires in: ${deviceCodeResponse.expires_in} seconds`)
      console.log(`   Polling interval: ${deviceCodeResponse.interval} seconds`)
      
      // Step 2: 显示用户验证码并打开浏览器
      console.log('🌐 [GitHub Copilot Device Flow] Step 2: Showing user code and opening browser...')
      await this.showUserCodeAndOpenBrowser(deviceCodeResponse)
      
      // Step 3: 轮询获取访问令牌
      console.log('🔄 [GitHub Copilot Device Flow] Step 3: Polling for access token...')
      const accessToken = await this.pollForAccessToken(deviceCodeResponse)
      
      console.log('✅ [GitHub Copilot Device Flow] Device flow completed successfully!')
      return accessToken
      
    } catch (error) {
      console.error('❌ [GitHub Copilot Device Flow] Device flow failed:', error)
      throw error
    } finally {
      // 确保清理轮询
      this.stopPolling()
    }
  }

  /**
   * Step 1: 请求设备验证码
   */
  private async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const url = 'https://github.com/login/device/code'
    const body = {
      client_id: this.config.clientId,
      scope: this.config.scope
    }

    console.log('📤 [GitHub Copilot Device Flow] Requesting device code from GitHub...')
    console.log(`   URL: ${url}`)
    console.log(`   Client ID: ${this.config.clientId}`)
    console.log(`   Scope: ${this.config.scope}`)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'DeepChat/1.0.0'
      },
      body: JSON.stringify(body)
    })

    console.log('📥 [GitHub Copilot Device Flow] Device code response:')
    console.log(`   Status: ${response.status} ${response.statusText}`)

    if (!response.ok) {
      const errorText = await response.text()
      console.log(`   Error body: ${errorText}`)
      throw new Error(`Failed to request device code: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as DeviceCodeResponse
    console.log('📊 [GitHub Copilot Device Flow] Device code data:')
    console.log(`   Device code: ${data.device_code ? data.device_code.substring(0, 20) + '...' : 'NOT PRESENT'}`)
    console.log(`   User code: ${data.user_code}`)
    console.log(`   Verification URI: ${data.verification_uri}`)
    console.log(`   Expires in: ${data.expires_in}`)
    console.log(`   Interval: ${data.interval}`)

    return data
  }

  /**
   * Step 2: 显示用户验证码并打开浏览器
   */
  private async showUserCodeAndOpenBrowser(deviceCodeResponse: DeviceCodeResponse): Promise<void> {
    return new Promise((resolve) => {
      // 创建一个窗口显示用户验证码
      const instructionWindow = new BrowserWindow({
        width: 500,
        height: 400,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        },
        autoHideMenuBar: true,
        title: 'GitHub Copilot 设备认证',
        resizable: false,
        minimizable: false,
        maximizable: false
      })

      // 创建HTML内容
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>GitHub Copilot 设备认证</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              margin: 0;
              padding: 40px;
              background: #f6f8fa;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              box-sizing: border-box;
            }
            .container {
              background: white;
              border-radius: 12px;
              padding: 32px;
              box-shadow: 0 8px 24px rgba(0,0,0,0.12);
              text-align: center;
              max-width: 400px;
              width: 100%;
            }
            .logo {
              width: 48px;
              height: 48px;
              margin: 0 auto 24px;
              background: #24292f;
              border-radius: 12px;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 24px;
              font-weight: bold;
            }
            h1 {
              color: #24292f;
              margin: 0 0 16px;
              font-size: 24px;
              font-weight: 600;
            }
            .user-code {
              font-size: 32px;
              font-weight: bold;
              color: #0969da;
              background: #f6f8fa;
              padding: 16px;
              border-radius: 8px;
              margin: 24px 0;
              letter-spacing: 4px;
              font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            }
            .instructions {
              color: #656d76;
              margin: 16px 0;
              line-height: 1.5;
            }
            .button {
              background: #0969da;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 6px;
              font-size: 14px;
              font-weight: 500;
              cursor: pointer;
              text-decoration: none;
              display: inline-block;
              margin: 16px 8px 8px;
              transition: background-color 0.2s;
            }
            .button:hover {
              background: #0860ca;
            }
            .button.secondary {
              background: #f6f8fa;
              color: #24292f;
              border: 1px solid #d0d7de;
            }
            .button.secondary:hover {
              background: #f3f4f6;
            }
            .footer {
              margin-top: 24px;
              font-size: 12px;
              color: #656d76;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo">🤖</div>
            <h1>GitHub Copilot 认证</h1>
            <p class="instructions">
              请在浏览器中访问以下地址，并输入验证码：
            </p>
            <div class="user-code">${deviceCodeResponse.user_code}</div>
            <a href="#" class="button" onclick="openBrowser()">打开 GitHub 认证页面</a>
            <button class="button secondary" onclick="copyCode()">复制验证码</button>
            <p class="footer">
              验证码将在 ${Math.floor(deviceCodeResponse.expires_in / 60)} 分钟后过期
            </p>
          </div>
          
          <script>
            function openBrowser() {
              window.electronAPI.openExternal('${deviceCodeResponse.verification_uri}');
            }
            
            function copyCode() {
              navigator.clipboard.writeText('${deviceCodeResponse.user_code}').then(() => {
                const button = event.target;
                const originalText = button.textContent;
                button.textContent = '已复制!';
                button.style.background = '#28a745';
                setTimeout(() => {
                  button.textContent = originalText;
                  button.style.background = '';
                }, 2000);
              });
            }
          </script>
        </body>
        </html>
      `

      // 加载HTML内容
      instructionWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`)
      
      // 注入API
      instructionWindow.webContents.on('dom-ready', () => {
        instructionWindow.webContents.executeJavaScript(`
          window.electronAPI = {
            openExternal: (url) => {
              window.postMessage({ type: 'open-external', url }, '*');
            }
          };
        `)
      })

      // 监听来自渲染进程的消息
      instructionWindow.webContents.on('ipc-message', (_event, channel, ...args) => {
        if (channel === 'open-external') {
          shell.openExternal(args[0])
        }
      })

      // 监听页面消息
      instructionWindow.webContents.on('console-message', (_event, _level, message) => {
        if (message.includes('open-external')) {
          shell.openExternal(deviceCodeResponse.verification_uri)
        }
      })

      instructionWindow.show()

      // 自动打开浏览器
      setTimeout(() => {
        shell.openExternal(deviceCodeResponse.verification_uri)
      }, 1000)

      // 设置超时关闭窗口
      setTimeout(() => {
        if (!instructionWindow.isDestroyed()) {
          instructionWindow.close()
        }
        resolve()
      }, 30000) // 30秒后自动关闭

      // 处理窗口关闭
      instructionWindow.on('closed', () => {
        resolve()
      })
    })
  }

  /**
   * Step 3: 轮询获取访问令牌
   */
  private async pollForAccessToken(deviceCodeResponse: DeviceCodeResponse): Promise<string> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()
      const expiresAt = startTime + (deviceCodeResponse.expires_in * 1000)
      let pollCount = 0

      const poll = async () => {
        pollCount++
        console.log(`🔄 [GitHub Copilot Device Flow] Polling attempt ${pollCount}...`)

        // 检查是否超时
        if (Date.now() >= expiresAt) {
          console.log('⏰ [GitHub Copilot Device Flow] Device code expired')
          if (this.pollingInterval) {
            clearInterval(this.pollingInterval)
            this.pollingInterval = null
          }
          reject(new Error('Device code expired'))
          return
        }

        try {
          const response = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'DeepChat/1.0.0'
            },
            body: JSON.stringify({
              client_id: this.config.clientId,
              device_code: deviceCodeResponse.device_code,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
            })
          })

          console.log(`📥 [GitHub Copilot Device Flow] Poll response: ${response.status}`)

          if (!response.ok) {
            console.log(`❌ [GitHub Copilot Device Flow] Poll failed: ${response.status} ${response.statusText}`)
            return // 继续轮询
          }

          const data = await response.json() as AccessTokenResponse

          if (data.error) {
            console.log(`📊 [GitHub Copilot Device Flow] Poll error: ${data.error}`)
            
            switch (data.error) {
              case 'authorization_pending':
                console.log('⏳ [GitHub Copilot Device Flow] Authorization pending, continuing to poll...')
                return // 继续轮询
              
              case 'slow_down':
                console.log('🐌 [GitHub Copilot Device Flow] Rate limited, slowing down polling...')
                // 增加轮询间隔
                if (this.pollingInterval) {
                  clearInterval(this.pollingInterval)
                  this.pollingInterval = setInterval(poll, (deviceCodeResponse.interval + 5) * 1000)
                }
                return
              
              case 'expired_token':
                console.log('⏰ [GitHub Copilot Device Flow] Device code expired')
                if (this.pollingInterval) {
                  clearInterval(this.pollingInterval)
                  this.pollingInterval = null
                }
                reject(new Error('Device code expired'))
                return
              
              case 'access_denied':
                console.log('🚫 [GitHub Copilot Device Flow] User denied access')
                if (this.pollingInterval) {
                  clearInterval(this.pollingInterval)
                  this.pollingInterval = null
                }
                reject(new Error('User denied access'))
                return
              
              default:
                console.log(`❌ [GitHub Copilot Device Flow] Unknown error: ${data.error}`)
                if (this.pollingInterval) {
                  clearInterval(this.pollingInterval)
                  this.pollingInterval = null
                }
                reject(new Error(`OAuth error: ${data.error_description || data.error}`))
                return
            }
          }

          if (data.access_token) {
            console.log('✅ [GitHub Copilot Device Flow] Access token received!')
            console.log(`   Token type: ${data.token_type}`)
            console.log(`   Scope: ${data.scope}`)
            console.log(`   Access token: ${data.access_token.substring(0, 20)}...`)
            
            if (this.pollingInterval) {
              clearInterval(this.pollingInterval)
              this.pollingInterval = null
            }
            resolve(data.access_token)
            return
          }

          console.log('⚠️ [GitHub Copilot Device Flow] No access token in response, continuing to poll...')

        } catch (error) {
          console.error('💥 [GitHub Copilot Device Flow] Poll request failed:', error)
          // 继续轮询，不要因为网络错误而停止
        }
      }

      // 开始轮询
      console.log(`🔄 [GitHub Copilot Device Flow] Starting polling every ${deviceCodeResponse.interval} seconds...`)
      this.pollingInterval = setInterval(poll, deviceCodeResponse.interval * 1000)
      
      // 立即执行第一次轮询
      poll()
    })
  }

  /**
   * 停止轮询
   */
  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
      console.log('🛑 [GitHub Copilot Device Flow] Polling stopped')
    }
  }
}

// GitHub Copilot Device Flow 配置
export function createGitHubCopilotDeviceFlow(): GitHubCopilotDeviceFlow {
  // 从环境变量读取 GitHub OAuth 配置
  const clientId = process.env.GITHUB_CLIENT_ID || process.env.VITE_GITHUB_CLIENT_ID

  console.log('GitHub Copilot Device Flow Configuration:')
  console.log('- Client ID configured:', clientId ? '✅' : '❌')
  console.log('- Environment variables check:')
  console.log('  - process.env.GITHUB_CLIENT_ID:', process.env.GITHUB_CLIENT_ID ? 'EXISTS' : 'NOT SET')
  console.log('  - process.env.VITE_GITHUB_CLIENT_ID:', process.env.VITE_GITHUB_CLIENT_ID ? 'EXISTS' : 'NOT SET')

  // 如果没有配置 Client ID，使用空配置，错误将在实际使用时抛出
  const config: DeviceFlowConfig = {
    clientId: clientId || '', // 使用空字符串作为默认值
    scope: 'read:user read:org'
  }

  console.log('Final Device Flow config:', {
    clientId: config.clientId || 'NOT SET',
    scope: config.scope
  })

  return new GitHubCopilotDeviceFlow(config)
} 