import { BrowserWindow } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PluginSettingsWindowPort } from '@/plugin'

export class PluginSettingsWindow implements PluginSettingsWindowPort {
  private readonly windows = new Map<
    string,
    {
      window: BrowserWindow
      webContentsId: number
      closing: boolean
      closed: Promise<void>
      loading: Promise<void>
      finishClose: () => void
    }
  >()
  private readonly pluginIdByWebContentsId = new Map<number, string>()
  private accepting = true

  async open(input: { pluginId: string; title: string; entry: string }): Promise<void> {
    if (!this.accepting) throw new Error('Plugin settings windows are closed')
    const existing = this.windows.get(input.pluginId)
    if (existing) {
      if (existing.closing) {
        await existing.closed
        return this.open(input)
      }
      if (!existing.window.isDestroyed()) {
        existing.window.show()
        existing.window.focus()
        return existing.loading
      }
    }

    const settingsWindow = new BrowserWindow({
      width: 760,
      height: 620,
      show: false,
      autoHideMenuBar: true,
      title: input.title,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload/pluginSettings.mjs'),
        sandbox: false,
        additionalArguments: [`--deepchat-plugin-id=${encodeURIComponent(input.pluginId)}`]
      }
    })

    const webContentsId = settingsWindow.webContents.id
    const entryPath = pathToFileURL(input.entry).pathname
    let finishClose!: () => void
    const closed = new Promise<void>((resolve) => {
      finishClose = resolve
    })
    const record = {
      window: settingsWindow,
      webContentsId,
      closing: false,
      closed,
      loading: Promise.resolve(),
      finishClose
    }
    this.windows.set(input.pluginId, record)
    this.pluginIdByWebContentsId.set(webContentsId, input.pluginId)
    settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    settingsWindow.webContents.on('will-navigate', (event, url) => {
      const target = new URL(url)
      if (target.protocol !== 'file:' || target.pathname !== entryPath) {
        event.preventDefault()
      }
    })
    settingsWindow.on('ready-to-show', () => {
      if (!record.closing && !settingsWindow.isDestroyed()) {
        settingsWindow.show()
      }
    })
    settingsWindow.on('close', () => {
      record.closing = true
    })
    settingsWindow.on('closed', () => {
      this.pluginIdByWebContentsId.delete(webContentsId)
      if (this.windows.get(input.pluginId) === record) {
        this.windows.delete(input.pluginId)
      }
      finishClose()
    })
    settingsWindow.webContents.on('will-prevent-unload', (event) => event.preventDefault())

    record.loading = (async () => {
      try {
        await settingsWindow.loadFile(input.entry, {
          query: { pluginId: input.pluginId }
        })
      } catch (error) {
        if (record.closing || settingsWindow.isDestroyed()) {
          await closed
          return
        }
        await this.close(input.pluginId)
        throw error
      }
    })()
    await record.loading
  }

  getPluginIdForWebContents(webContentsId: number): string | null {
    return this.pluginIdByWebContentsId.get(webContentsId) ?? null
  }

  async close(pluginId: string): Promise<void> {
    const record = this.windows.get(pluginId)
    if (!record) return
    if (!record.closing) {
      record.closing = true
      if (!record.window.isDestroyed()) record.window.destroy()
      else {
        this.pluginIdByWebContentsId.delete(record.webContentsId)
        this.windows.delete(pluginId)
        record.finishClose()
      }
    }
    await record.closed
  }

  async closeAll(): Promise<void> {
    this.accepting = false
    await Promise.all(Array.from(this.windows.keys(), (pluginId) => this.close(pluginId)))
  }
}
