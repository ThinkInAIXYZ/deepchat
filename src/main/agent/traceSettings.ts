import type { SettingsStore } from '@/config/settingsStore'
import type { AgentTraceSettingsPort } from '@deepchat/agent-kernel/contracts/agentTraceSettings'

export type { AgentTraceSettingsPort } from '@deepchat/agent-kernel/contracts/agentTraceSettings'

export class AgentTraceSettings implements AgentTraceSettingsPort {
  constructor(private readonly settings: SettingsStore) {}

  isEnabled(): boolean {
    return this.settings.get<boolean>('traceDebugEnabled') ?? false
  }

  setEnabled(enabled: boolean): void {
    this.settings.set('traceDebugEnabled', Boolean(enabled))
  }
}
