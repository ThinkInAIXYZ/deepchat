import type { SettingsStore } from '@/config/settingsStore'

export interface AgentTraceSettingsPort {
  isEnabled(): boolean
  setEnabled(enabled: boolean): void
}

export class AgentTraceSettings implements AgentTraceSettingsPort {
  constructor(private readonly settings: SettingsStore) {}

  isEnabled(): boolean {
    return this.settings.get<boolean>('traceDebugEnabled') ?? false
  }

  setEnabled(enabled: boolean): void {
    this.settings.set('traceDebugEnabled', Boolean(enabled))
  }
}
