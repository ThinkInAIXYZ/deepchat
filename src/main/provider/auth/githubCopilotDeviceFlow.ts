import { BrowserWindow, clipboard, shell } from 'electron'
import logger from '@shared/logger'
import { z } from 'zod'
import { setTimeout as delay } from 'node:timers/promises'
import { readAuthResponse } from './responseBody'

const GITHUB_DEVICE_URL = 'https://github.com/login/device'
const GITHUB_COPILOT_DEVICE_FLOW_CLIENT_ID = 'Iv1.b507a08c87ecfe98'

export interface DeviceFlowConfig {
  clientId: string
  scope: string
}

const seconds = z
  .number()
  .int()
  .positive()
  .max(Math.floor(2 ** 31 / 1000))
const DeviceCodeSchema = z.object({
  device_code: z.string().min(1).max(4096),
  user_code: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9-]+$/),
  verification_uri: z.literal(GITHUB_DEVICE_URL),
  expires_in: seconds,
  interval: seconds
})
type DeviceCodeResponse = z.infer<typeof DeviceCodeSchema>
const AccessTokenSchema = z.object({
  access_token: z
    .string()
    .regex(/^[\x21-\x7e]+$/)
    .optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
  interval: seconds.optional()
})

export class GitHubCopilotDeviceFlow {
  constructor(private readonly config: DeviceFlowConfig) {}

  /**
   * Start Device Flow authentication process
   */
  async startDeviceFlow(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const expiration = new AbortController()
    const active = AbortSignal.any([signal, expiration.signal])
    let timer: NodeJS.Timeout | undefined
    try {
      const deviceCodeResponse = await this.requestDeviceCode(active)
      active.throwIfAborted()
      const receivedAt = Date.now()
      timer = setTimeout(
        () => expiration.abort(new Error('Device code expired')),
        deviceCodeResponse.expires_in * 1000
      )
      await this.showUserCodeAndOpenBrowser(deviceCodeResponse, active)
      active.throwIfAborted()
      return await this.pollForAccessToken(deviceCodeResponse, active, receivedAt)
    } catch (error) {
      active.throwIfAborted()
      throw new Error(
        `Device flow authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Step 1: Request device code
   */
  private async requestDeviceCode(signal: AbortSignal): Promise<DeviceCodeResponse> {
    const url = 'https://github.com/login/device/code'
    const body = {
      client_id: this.config.clientId,
      scope: this.config.scope
    }

    try {
      const response = await readAuthResponse(
        await fetch(url, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'DeepChat/1.0.0'
          },
          body: JSON.stringify(body),
          signal
        }),
        signal
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(
          `Failed to request device code: ${response.status} ${response.statusText} - ${errorText}`
        )
      }

      const parsed = DeviceCodeSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('Invalid GitHub device-code response')
      return parsed.data
    } catch (error) {
      signal.throwIfAborted()
      throw error
    }
  }

  /**
   * Step 2: Show user code and open browser
   */
  private async showUserCodeAndOpenBrowser(
    deviceCodeResponse: DeviceCodeResponse,
    signal: AbortSignal
  ): Promise<void> {
    signal.throwIfAborted()
    const result = Promise.withResolvers<void>()
    void result.promise.catch(() => {})
    const closed = Promise.withResolvers<void>()
    const effects = new Set<Promise<unknown>>()
    let active = true
    let opening: Promise<void> | undefined
    // Create a window to display user code
    const instructionWindow = new BrowserWindow({
      width: 340,
      height: 320,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true
      },
      autoHideMenuBar: true,
      title: 'GitHub Copilot Device Authentication',
      resizable: false,
      minimizable: false,
      maximizable: false
    })
    instructionWindow.once('closed', () => {
      closed.resolve()
      result.resolve()
    })
    const abort = () => result.reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    const run = (effect: () => Promise<unknown>): Promise<unknown> => {
      const operation = Promise.resolve().then(() => {
        if (active && !signal.aborted && !instructionWindow.isDestroyed()) return effect()
        return undefined
      })
      effects.add(operation)
      void operation.then(
        () => effects.delete(operation),
        () => effects.delete(operation)
      )
      return operation
    }
    // Destroyed frames can lose command replies; physical closure retires their local effects.
    const runWindow = (effect: () => Promise<unknown>) =>
      run(async () => await Promise.race([effect(), closed.promise]))
    const openBrowser = () => {
      if (!active || signal.aborted || instructionWindow.isDestroyed() || opening) return
      opening = run(async () => {
        try {
          await shell.openExternal(GITHUB_DEVICE_URL)
        } catch {
          if (active && !signal.aborted && !instructionWindow.isDestroyed())
            await runWindow(
              async () =>
                await instructionWindow.webContents.executeJavaScript(
                  `alert('Cannot automatically open browser. Please manually visit: ${GITHUB_DEVICE_URL}');`
                )
            ).catch(() => {})
        }
      })
        .then(() => undefined)
        .finally(() => {
          opening = undefined
        })
      void opening.catch(() => {})
    }
    const closeWindow = async () => {
      try {
        if (!instructionWindow.isDestroyed()) instructionWindow.destroy()
      } finally {
        await closed.promise
      }
    }

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
                const githubUrl = '${GITHUB_DEVICE_URL}';
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

    instructionWindow.webContents.on('dom-ready', () => {
      void runWindow(
        async () =>
          await instructionWindow.webContents.executeJavaScript(`
          window.electronAPI = {
            openExternal: () => console.log(JSON.stringify({ type: 'open-external' })),
            copyToClipboard: (text) => console.log(JSON.stringify({ type: 'copy-to-clipboard', text }))
          };
          void 0;
        `)
      ).catch(() => {})
    })
    instructionWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    instructionWindow.webContents.on('will-navigate', (event) => event.preventDefault())
    instructionWindow.webContents.on('console-message', (...args: unknown[]) => {
      if (!active || signal.aborted || instructionWindow.isDestroyed()) return
      const details = args[1]
      const message =
        typeof args[2] === 'string'
          ? args[2]
          : details && typeof details === 'object' && 'message' in details
            ? details.message
            : undefined
      if (typeof message !== 'string') return
      try {
        const value: unknown = JSON.parse(message)
        if (!value || typeof value !== 'object' || !('type' in value)) return
        if (value.type === 'open-external') openBrowser()
        else if (
          value.type === 'copy-to-clipboard' &&
          'text' in value &&
          (value.text === GITHUB_DEVICE_URL || value.text === deviceCodeResponse.user_code)
        )
          clipboard.writeText(value.text)
      } catch {
        // Ignore unrelated page diagnostics.
      }
    })
    const browserTimer = setTimeout(openBrowser, 1000)
    const windowTimer = setTimeout(() => {
      try {
        if (!instructionWindow.isDestroyed()) instructionWindow.destroy()
      } catch (error) {
        result.reject(error)
      }
    }, 30_000)
    try {
      if (signal.aborted) abort()
      else {
        void runWindow(
          async () =>
            await instructionWindow.loadURL(
              `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`
            )
        ).catch(result.reject)
        instructionWindow.show()
      }
      await result.promise
      signal.throwIfAborted()
    } finally {
      active = false
      clearTimeout(browserTimer)
      clearTimeout(windowTimer)
      signal.removeEventListener('abort', abort)
      try {
        await closeWindow()
      } finally {
        await Promise.allSettled(effects)
      }
    }
  }

  /**
   * Step 3: Poll for access token
   */
  private async pollForAccessToken(
    deviceCodeResponse: DeviceCodeResponse,
    signal: AbortSignal,
    receivedAt: number
  ): Promise<string> {
    const expiresAt = receivedAt + deviceCodeResponse.expires_in * 1000
    let interval = deviceCodeResponse.interval
    let nextPollAt = receivedAt + interval * 1000
    for (let attempt = 0; attempt < 100; attempt++) {
      signal.throwIfAborted()
      const remaining = expiresAt - Date.now()
      if (remaining <= 0) throw new Error('Device code expired')
      await delay(Math.max(0, Math.min(nextPollAt - Date.now(), remaining)), undefined, { signal })
      signal.throwIfAborted()
      if (Date.now() >= expiresAt) throw new Error('Device code expired')
      let response: Response
      try {
        response = await fetch('https://github.com/login/oauth/access_token', {
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
          }),
          signal
        })
      } catch {
        signal.throwIfAborted()
        nextPollAt = Date.now() + interval * 1000
        continue
      }
      const bounded = await readAuthResponse(response, signal)
      const body: unknown = await bounded.json().catch(() => null)
      signal.throwIfAborted()
      if (!bounded.ok && body === null) {
        nextPollAt = Date.now() + interval * 1000
        continue
      }
      const parsed = AccessTokenSchema.safeParse(body)
      if (!parsed.success) throw new Error('Invalid GitHub OAuth token response')
      const data = parsed.data
      if (data.error) {
        if (data.error === 'slow_down') interval = Math.max(interval + 5, data.interval ?? 0)
        else if (data.error !== 'authorization_pending')
          throw new Error(`OAuth error: ${data.error_description || data.error}`)
      } else if (bounded.ok && data.access_token) return data.access_token
      nextPollAt = Date.now() + interval * 1000
    }
    throw new Error('Maximum polling attempts exceeded')
  }
}

// GitHub Copilot Device Flow configuration
export function createGitHubCopilotDeviceFlow(clientIdOverride?: string): GitHubCopilotDeviceFlow {
  const clientId =
    clientIdOverride?.trim() ||
    import.meta.env.VITE_GITHUB_CLIENT_ID?.trim() ||
    GITHUB_COPILOT_DEVICE_FLOW_CLIENT_ID

  const config: DeviceFlowConfig = {
    clientId,
    scope: 'read:user read:org'
  }

  logger.info('[GitHub Copilot][DeviceFlow] Creating device flow with config:', {
    clientIdConfigured: !!clientId,
    scope: config.scope
  })

  return new GitHubCopilotDeviceFlow(config)
}
