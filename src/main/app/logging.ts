import type { SettingsStore } from '@/config/settingsStore'
import type { DeepchatEventPublisher } from '@shared/contracts/events'

export interface LoggingHost {
  applyLogging(enabled: boolean): Promise<void>
  openLoggingFolder(): Promise<void>
}

export class LoggingService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly host: LoggingHost,
    private readonly publishEvent: DeepchatEventPublisher
  ) {}

  getEnabled(): boolean {
    return this.settings.get<boolean>('loggingEnabled') ?? false
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const value = Boolean(enabled)
    this.settings.set('loggingEnabled', value)
    await this.host.applyLogging(value)
    this.publishEvent('settings.changed', {
      changedKeys: ['loggingEnabled'],
      version: Date.now(),
      values: { loggingEnabled: value }
    })
  }

  async openFolder(): Promise<void> {
    await this.host.openLoggingFolder()
  }
}
