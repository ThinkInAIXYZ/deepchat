import type { SettingsStore } from '@/config/settingsStore'
import type { AgentTraceSettingsPort } from '@/agent/deepchat/contracts/agentTraceSettings'

export type { AgentTraceSettingsPort } from '@/agent/deepchat/contracts/agentTraceSettings'

export class AgentTraceSettings implements AgentTraceSettingsPort {
  constructor(private readonly settings: SettingsStore) {}

  isEnabled(): boolean {
    return this.settings.get<boolean>('traceDebugEnabled') ?? false
  }

  setEnabled(enabled: boolean): void {
    this.settings.set('traceDebugEnabled', Boolean(enabled))
  }
}
