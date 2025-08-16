import { BrowserWindow, shell } from 'electron'
import { exec } from 'child_process'
import { presenter } from '@/presenter'

const GITHUB_DEVICE_URL = 'https://github.com/login/device'

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
    try {
      // Step 1: 获取设备验证码
      const deviceCodeResponse = await this.requestDeviceCode()

      // Step 2: 显示用户验证码并打开浏览器
      await this.showUserCodeAndOpenBrowser(deviceCodeResponse)

      // Step 3: 轮询获取访问令牌
      const accessToken = await this.pollForAccessToken(deviceCodeResponse)

      return accessToken
    } catch (error) {
      console.error('Failed to start device flow', error)
      throw new Error('Failed to start device flow')
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

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'DeepChat/1.0.0'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      throw new Error(`Failed to request device code: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as DeviceCodeResponse

    return data
  }

  /**
   * Step 2: 显示用户验证码并打开浏览器
   */
  private async showUserCodeAndOpenBrowser(deviceCodeResponse: DeviceCodeResponse): Promise<void> {
    return new Promise((resolve) => {
      // 创建一个窗口显示用户验证码
      const instructionWindow = new BrowserWindow({
        width: 340,
        height: 320,
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
              padding: 16px;
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
              border-radius: 10px;
              padding: 16px 12px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.10);
              text-align: center;
              max-width: 320px;
              width: 100%;
            }
            .logo {
              width: 36px;
              height: 36px;
              margin: 0 auto 12px;
              background: #24292f;
              border-radius: 8px;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 18px;
              font-weight: bold;
            }
            h1 {
              color: #24292f;
              margin: 0 0 8px;
              font-size: 18px;
              font-weight: 600;
            }
            .user-code {
              font-size: 24px;
              font-weight: bold;
              color: #0969da;
              background: #f6f8fa;
              padding: 8px;
              border-radius: 6px;
              margin: 12px 0;
              letter-spacing: 2px;
              font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
              word-break: break-all;
            }
            .instructions {
              color: #656d76;
              margin: 8px 0;
              line-height: 1.4;
              font-size: 14px;
            }
            .button {
              background: #0969da;
              color: white;
              border: none;
              padding: 8px 16px;
              border-radius: 5px;
              font-size: 13px;
              font-weight: 500;
              cursor: pointer;
              text-decoration: none;
              display: inline-block;
              margin: 8px 4px 4px;
              transition: background-color 0.2s;
            }
            .button.secondary {
              background: #f6f8fa;
              color: #24292f;
              border: 1px solid #d0d7de;
            }
            .footer {
              margin-top: 10px;
              font-size: 11px;
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
              若未自动打开浏览器 请手动访问: https://github.com/login/device
            </p>
            <div class="user-code">${deviceCodeResponse.user_code}</div>
            <a href="#" class="button" onclick="openBrowser()">打开 GitHub 认证页面</a>
            <button class="button secondary" onclick="copyCode()">复制验证码</button>
            <p class="footer">
              验证码将在 ${Math.floor(deviceCodeResponse.expires_in / 60)} 分钟后过期
            </p>
          </div>

          <script>
            async function openBrowser() {
              try {
                const githubUrl = GITHUB_DEVICE_URL;
                // 尝试复制链接到剪贴板
                await window.electronAPI.copyToClipboard(githubUrl);
                
                // 尝试打开浏览器
                window.electronAPI.openExternal(githubUrl);
                
                // 显示备用提示
                setTimeout(() => {
                  const msg = document.createElement('div');
                  msg.style.fontSize = '12px';
                  msg.style.color = '#0969da';
                  msg.style.marginTop = '8px';
                  msg.innerHTML = '如果浏览器没有自动打开，链接已复制到剪贴板，请手动粘贴到浏览器地址栏访问。';
                  document.querySelector('.footer').appendChild(msg);
                }, 2000);
              } catch (error) {
                console.error('Failed to handle browser open:', error);
                alert('请手动访问: ${GITHUB_DEVICE_URL}');
              }
            }

            function copyCode() {
              window.electronAPI.copyToClipboard('${deviceCodeResponse.user_code}');
              const button = event.target;
              const originalText = button.textContent;
              button.textContent = '已复制!';
              button.style.background = '#28a745';
              setTimeout(() => {
                button.textContent = originalText;
                button.style.background = '';
              }, 2000);
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
              // 通过 console.log 发送消息，主进程通过 console-message 事件接收
              console.log(JSON.stringify({ type: 'open-external', url }));
            },
            copyToClipboard: (text) => {
              // 通过 console.log 发送消息，主进程通过 console-message 事件接收
              console.log(JSON.stringify({ type: 'copy-to-clipboard', text }));
            },
          };
        `)
      })

      // 处理消息
      instructionWindow.webContents.on('ipc-message', (_event, channel, ...args) => {
        if (channel === 'open-external') {
          shell.openExternal(args[0])
        }
      })

      // 监听页面消息
      instructionWindow.webContents.on('console-message', (_event, _level, message) => {
        try {
          const msg = typeof message === 'string' ? JSON.parse(message) : message
          if (msg.type === 'open-external') {
            shell.openExternal(msg.url)
          } else if (msg.type === 'copy-to-clipboard') {
            const mainWindow = presenter.windowPresenter.mainWindow
            if (mainWindow) {
              mainWindow.webContents.executeJavaScript(`window.api.copyText('${msg.text}')`)
            }
          }
        } catch {
          // ignore
        }
      })

      instructionWindow.show()

      // 自动打开浏览器
      setTimeout(async () => {
        try {
          // 使用固定的GitHub设备激活页面
          const url = GITHUB_DEVICE_URL
          console.log('Attempting to open URL:', url)

          if (process.platform === 'win32') {
            // 先尝试使用explorer命令
            exec(`explorer "${url}"`, (error) => {
              if (error) {
                console.error('Explorer command failed:', error)
                // 如果explorer失败，尝试使用start命令
                exec(`start "" "${url}"`, (startError) => {
                  if (startError) {
                    console.error('Start command failed:', startError)
                    // 使用更安全的方式处理剪贴板操作
                    instructionWindow.webContents.executeJavaScript(`
                      const shouldCopy = confirm('无法自动打开浏览器。是否复制链接到剪贴板？');
                      if (shouldCopy) {
                        // use the exposed Electron API for clipboard access
                        window.electronAPI.copyToClipboard('${url}');
                        alert('链接已复制到剪贴板，请手动粘贴到浏览器地址栏访问。');
                      } else {
                        alert('请手动访问: ${url}');
                      }
                    `)
                  }
                })
              }
            })
          } else {
            // 非Windows系统使用默认的shell.openExternal
            await shell.openExternal(url)
          }
        } catch (error) {
          console.error('Failed to open browser:', error)
          instructionWindow.webContents.executeJavaScript(`
            alert('无法自动打开浏览器，请手动访问: ${GITHUB_DEVICE_URL}');
          `)
        }
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
      const expiresAt = startTime + deviceCodeResponse.expires_in * 1000
      let pollCount = 0

      const poll = async () => {
        pollCount++
        if (pollCount > 50) {
          reject(new Error('Poll count exceeded'))
          return
        }

        // 检查是否超时
        if (Date.now() >= expiresAt) {
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
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'DeepChat/1.0.0'
            },
            body: JSON.stringify({
              client_id: this.config.clientId,
              device_code: deviceCodeResponse.device_code,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
            })
          })

          if (!response.ok) {
            return // 继续轮询
          }

          const data = (await response.json()) as AccessTokenResponse

          if (data.error) {
            switch (data.error) {
              case 'authorization_pending':
                return // 继续轮询

              case 'slow_down':
                // 增加轮询间隔
                if (this.pollingInterval) {
                  clearInterval(this.pollingInterval)
                  this.pollingInterval = setInterval(poll, (deviceCodeResponse.interval + 5) * 1000)
                }
                return

              case 'expired_token':
                if (this.pollingInterval) {
                  clearInterval(this.pollingInterval)
                  this.pollingInterval = null
                }
                reject(new Error('Device code expired'))
                return

              case 'access_denied':
                if (this.pollingInterval) {
                  clearInterval(this.pollingInterval)
                  this.pollingInterval = null
                }
                reject(new Error('User denied access'))
                return

              default:
                reject(new Error(`OAuth error: ${data.error_description || data.error}`))
                return
            }
          }

          if (data.access_token) {
            if (this.pollingInterval) {
              clearInterval(this.pollingInterval)
              this.pollingInterval = null
            }
            resolve(data.access_token)
            return
          }
        } catch {
          // ignore
        }
      }

      // 开始轮询
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
    }
  }
}

// GitHub Copilot Device Flow 配置
export function createGitHubCopilotDeviceFlow(): GitHubCopilotDeviceFlow {
  // 从环境变量读取 GitHub OAuth 配置
  const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID

  if (!clientId) {
    throw new Error(
      'VITE_GITHUB_CLIENT_ID environment variable is required. Please create a .env file with your GitHub OAuth Client ID.'
    )
  }

  const config: DeviceFlowConfig = {
    clientId,
    scope: 'read:user read:org'
  }

  return new GitHubCopilotDeviceFlow(config)
}
