import { app, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import type { SettingsStore } from '@/config/settingsStore'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'

export class LoggingService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly restartApp: () => void
  ) {}

  getEnabled(): boolean {
    return this.settings.get<boolean>('loggingEnabled') ?? false
  }

  setEnabled(enabled: boolean): void {
    const value = Boolean(enabled)
    this.settings.set('loggingEnabled', value)
    publishDeepchatEvent('settings.changed', {
      changedKeys: ['loggingEnabled'],
      version: Date.now(),
      values: { loggingEnabled: value }
    })
    setTimeout(() => this.restartApp(), 1000)
  }

  async openFolder(): Promise<void> {
    const loggingFolderPath = path.join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(loggingFolderPath)) {
      fs.mkdirSync(loggingFolderPath, { recursive: true })
    }
    await shell.openPath(loggingFolderPath)
  }
}
