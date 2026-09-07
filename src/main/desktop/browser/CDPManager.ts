import type { Debugger, WebContents } from 'electron'
import { ScreenshotOptions } from '@shared/types/browser'

export class CDPManager {
  async createSession(webContents: WebContents): Promise<Debugger> {
    const session = webContents.debugger
    if (!session.isAttached()) {
      session.attach('1.3')
      await session.sendCommand('Page.enable')
      await session.sendCommand('DOM.enable')
      await session.sendCommand('Runtime.enable')
    }
    return session
  }

  async navigate(session: Debugger, url: string): Promise<void> {
    await session.sendCommand('Page.navigate', { url })
  }

  async evaluateScript(session: Debugger, script: string): Promise<unknown> {
    const response = await session.sendCommand('Runtime.evaluate', {
      expression: script,
      returnByValue: true
    })
    if (response?.result?.value !== undefined) {
      return response.result.value
    }
    return response?.result ?? null
  }

  async captureScreenshot(session: Debugger, options?: ScreenshotOptions): Promise<string> {
    const params: Record<string, unknown> = { format: 'png' }
    if (options?.quality !== undefined) {
      params.quality = options.quality
    }
    if (options?.clip) {
      params.clip = { ...options.clip, scale: 1 }
    }
    const result = await session.sendCommand('Page.captureScreenshot', params)
    return (result?.data as string) || ''
  }

  async getDOM(session: Debugger, selector?: string): Promise<string> {
    const expression = selector
      ? `(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return '';
        return node.outerHTML;
      })()`
      : 'document.documentElement.outerHTML'

    const result = await session.sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true
    })

    if (result?.result?.value !== undefined) {
      return String(result.result.value)
    }

    return ''
  }
}
