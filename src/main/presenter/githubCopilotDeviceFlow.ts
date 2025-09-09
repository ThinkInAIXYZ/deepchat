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
   * Start Device Flow authentication process
   */
  async startDeviceFlow(): Promise<string> {
    try {
      // Step 1: Request device code
      const deviceCodeResponse = await this.requestDeviceCode()

      // Step 2: Show user code and open browser
      await this.showUserCodeAndOpenBrowser(deviceCodeResponse)

      // Step 3: Poll for access token
      const accessToken = await this.pollForAccessToken(deviceCodeResponse)

      return accessToken
    } catch (error) {
      console.error('Failed to start device flow', error)
      throw new Error('Failed to start device flow')
    }
  }

  /**
   * Step 1: Request device code
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
   * Step 2: Show user code and open browser
   */
  private async showUserCodeAndOpenBrowser(deviceCodeResponse: DeviceCodeResponse): Promise<void> {
    return new Promise((resolve) => {
      // Create a window to display user code
      const instructionWindow = new BrowserWindow({
        width: 340,
        height: 320,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        },
        autoHideMenuBar: true,
        title: 'GitHub Copilot Device Authentication',
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
          <title>GitHub Copilot Device Authentication</title>
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
            <h1>GitHub Copilot Authentication</h1>
            <p class="instructions">
              Please visit the following address in your browser and enter the verification code:
              If the browser doesn't open automatically, please manually visit: https://github.com/login/device
            </p>
            <div class="user-code">${deviceCodeResponse.user_code}</div>
            <a href="#" class="button" onclick="openBrowser()">Open GitHub Authentication Page</a>
            <button class="button secondary" onclick="copyCode()">Copy Verification Code</button>
            <p class="footer">
              Verification code will expire in ${Math.floor(deviceCodeResponse.expires_in / 60)} minutes
            </p>
          </div>

          <script>
            async function openBrowser() {
              try {
                const githubUrl = GITHUB_DEVICE_URL;
                // Try to copy link to clipboard
                await window.electronAPI.copyToClipboard(githubUrl);

                // Try to open browser
                window.electronAPI.openExternal(githubUrl);

                // Show fallback message
                setTimeout(() => {
                  const msg = document.createElement('div');
                  msg.style.fontSize = '12px';
                  msg.style.color = '#0969da';
                  msg.style.marginTop = '8px';
                  msg.innerHTML = 'If the browser did not open automatically, the link has been copied to clipboard. Please paste it into your browser address bar.';
                  document.querySelector('.footer').appendChild(msg);
                }, 2000);
              } catch (error) {
                console.error('Failed to handle browser open:', error);
                alert('Please manually visit: ${GITHUB_DEVICE_URL}');
              }
            }

            function copyCode() {
              window.electronAPI.copyToClipboard('${deviceCodeResponse.user_code}');
              const button = event.target;
              const originalText = button.textContent;
              button.textContent = 'Copied!';
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

      // Load HTML content
      instructionWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`)

      // Inject API
      instructionWindow.webContents.on('dom-ready', () => {
        instructionWindow.webContents.executeJavaScript(`
          window.electronAPI = {
            openExternal: (url) => {
              // Send message via console.log, main process receives via console-message event
              console.log(JSON.stringify({ type: 'open-external', url }));
            },
            copyToClipboard: (text) => {
              // Send message via console.log, main process receives via console-message event
              console.log(JSON.stringify({ type: 'copy-to-clipboard', text }));
            },
          };
        `)
      })

      // Handle messages
      instructionWindow.webContents.on('ipc-message', (_event, channel, ...args) => {
        if (channel === 'open-external') {
          shell.openExternal(args[0])
        }
      })

      // Listen to page messages
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

      // Automatically open browser
      setTimeout(async () => {
        try {
          // Use fixed GitHub device activation page
          const url = GITHUB_DEVICE_URL
          console.log('Attempting to open URL:', url)

          if (process.platform === 'win32') {
            // First try using explorer command
            exec(`explorer "${url}"`, (error) => {
              if (error) {
                console.error('Explorer command failed:', error)
                // If explorer fails, try using start command
                exec(`start "" "${url}"`, (startError) => {
                  if (startError) {
                    console.error('Start command failed:', startError)
                    // Use a safer method for clipboard operations
                    instructionWindow.webContents.executeJavaScript(`
                      const shouldCopy = confirm('Cannot automatically open browser. Copy link to clipboard?');
                      if (shouldCopy) {
                        // use the exposed Electron API for clipboard access
                        window.electronAPI.copyToClipboard('${url}');
                        alert('Link copied to clipboard. Please paste it into your browser address bar.');
                      } else {
                        alert('Please manually visit: ${url}');
                      }
                    `)
                  }
                })
              }
            })
          } else {
            // Non-Windows systems use default shell.openExternal
            await shell.openExternal(url)
          }
        } catch (error) {
          console.error('Failed to open browser:', error)
          instructionWindow.webContents.executeJavaScript(`
            alert('Cannot automatically open browser. Please manually visit: ${GITHUB_DEVICE_URL}');
          `)
        }
      }, 1000)

      // Set timeout to close window
      setTimeout(() => {
        if (!instructionWindow.isDestroyed()) {
          instructionWindow.close()
        }
        resolve()
      }, 30000) // Auto close after 30 seconds

      // Handle window close
      instructionWindow.on('closed', () => {
        resolve()
      })
    })
  }

  /**
   * Step 3: Poll for access token
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

        // Check if timed out
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
            return // Continue polling
          }

          const data = (await response.json()) as AccessTokenResponse

          if (data.error) {
            switch (data.error) {
              case 'authorization_pending':
                return // Continue polling

              case 'slow_down':
                // Increase polling interval
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

      // Start polling
      this.pollingInterval = setInterval(poll, deviceCodeResponse.interval * 1000)

      // Execute first poll immediately
      poll()
    })
  }

  /**
   * Stop polling
   */
  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
  }
}

// GitHub Copilot Device Flow configuration
export function createGitHubCopilotDeviceFlow(): GitHubCopilotDeviceFlow {
  // Read GitHub OAuth configuration from environment variables
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
