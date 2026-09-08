import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { SessionScopeRegistry } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { SessionDatabase } from '@/session/data/database'
import type { SessionKind } from '@shared/types/agent-interface'

export interface SessionIdentityServiceDependencies {
  registry: SessionScopeRegistry
  database: Pick<SessionDatabase, 'newSessionsTable'>
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
