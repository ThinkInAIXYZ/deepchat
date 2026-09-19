import { app, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import type { SettingsStore } from '@/config/settingsStore'
import type { DeepchatEventPublisher } from '@shared/contracts/events'

export class LoggingService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly restartApp: () => void,
    private readonly publishEvent: DeepchatEventPublisher,
    private readonly setMainPersistenceEnabled: (enabled: boolean) => void
  ) {}

  getEnabled(): boolean {
    return this.settings.get<boolean>('loggingEnabled') ?? false
  }

  setEnabled(enabled: boolean): void {
    const value = Boolean(enabled)
    this.settings.set('loggingEnabled', value)
    this.setMainPersistenceEnabled(value)
    this.publishEvent('settings.changed', {
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
