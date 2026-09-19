import { toAppSessionId } from '../collab/agent-shared/agentSessionIds.js'
import type { SessionScopeRegistry } from '../instance/deepChatAgentRuntime.js'
import type { SessionAgentRowPort } from '../contracts/sessionAgentRow.js'
import type { SessionKind } from '../shared/types/agent-interface.js'

export interface SessionIdentityServiceDependencies {
  registry: SessionScopeRegistry
  database: SessionAgentRowPort
}

export class SessionIdentityService {
  constructor(private readonly deps: SessionIdentityServiceDependencies) {}

  getAgentId(sessionId: string): string | undefined {
    const instance = this.deps.registry.getHydratedScope(toAppSessionId(sessionId))?.instance
    const cached = instance?.getAgentId()?.trim()
    if (cached) {
      return cached
    }

    const persisted = this.deps.database.newSessionsTable?.get(sessionId)?.agent_id?.trim()
    if (persisted) {
      instance?.setAgentId(persisted)
      return persisted
    }

    return undefined
  }

  getParentSessionId(sessionId: string): string | undefined {
    return this.deps.database.newSessionsTable?.get(sessionId)?.parent_session_id ?? undefined
  }

  getSessionKind(sessionId: string): SessionKind | null {
    return this.deps.database.newSessionsTable?.get(sessionId)?.session_kind ?? null
  }

  isAcpBackedSubagentSession(sessionId: string, providerId?: string): boolean {
    const sessionRow = this.deps.database.newSessionsTable?.get(sessionId)
    if (!sessionRow || sessionRow.session_kind !== 'subagent') {
      return false
    }

    const resolvedProviderId =
      providerId?.trim() ||
      this.deps.registry.getHydratedScope(toAppSessionId(sessionId))?.state()?.providerId?.trim() ||
      ''
    return resolvedProviderId === 'acp'
  }
}
