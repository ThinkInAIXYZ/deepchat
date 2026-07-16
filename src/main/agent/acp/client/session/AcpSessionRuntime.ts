import type { AgentSettingsPort } from '@/agent/settings'
import { AcpSessionManager, AcpSessionPersistence } from '@/agent/acp/runtime'
import type { AcpProcessManager } from '@/agent/acp/runtime'
import type { McpSettings } from '@/mcp/settings'

export class AcpSessionRuntime {
  readonly sessionManager: AcpSessionManager

  constructor(input: {
    providerId: string
    processManager: AcpProcessManager
    sessionPersistence: AcpSessionPersistence
    agentSettings: AgentSettingsPort
    mcpSettings: McpSettings
  }) {
    this.sessionManager = new AcpSessionManager(input)
  }
}
