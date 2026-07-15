import { BrowserWindow } from 'electron'
import path from 'node:path'
import type { PluginSettingsWindowPort } from '@/plugin'

export class PluginSettingsWindow implements PluginSettingsWindowPort {
  private readonly windows = new Map<string, BrowserWindow>()

  async open(input: { pluginId: string; title: string; entry: string }): Promise<void> {
    const existing = this.windows.get(input.pluginId)
    if (existing && !existing.isDestroyed()) {
      existing.show()
      existing.focus()
      return
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
        sandbox: false
      }
    })

    this.windows.set(input.pluginId, settingsWindow)
    settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    settingsWindow.on('ready-to-show', () => {
      if (!settingsWindow.isDestroyed()) {
        settingsWindow.show()
      }
    })
    settingsWindow.on('closed', () => {
      this.windows.delete(input.pluginId)
    })

    await settingsWindow.loadFile(input.entry, {
      query: {
        pluginId: input.pluginId
      }
    })
  }

  close(pluginId: string): void {
    const settingsWindow = this.windows.get(pluginId)
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close()
    }
    this.windows.delete(pluginId)
  }

  closeAll(): void {
    for (const pluginId of Array.from(this.windows.keys())) {
      this.close(pluginId)
    }
  }
}
