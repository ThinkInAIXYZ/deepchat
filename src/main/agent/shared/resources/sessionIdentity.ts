import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { SessionResourceRegistryPort as SessionScopeRegistry } from './resourceRegistry'
import type { SessionResourceReadPort } from '@/session/data/contracts'
import type { SessionKind } from '@shared/types/agent-interface'

export interface SessionIdentityServiceDependencies {
  registry: SessionScopeRegistry
  sessions: Pick<SessionResourceReadPort, 'getIdentity'>
}

export class SessionIdentityService {
  constructor(private readonly deps: SessionIdentityServiceDependencies) {}

  getAgentId(sessionId: string): string | undefined {
    const instance = this.deps.registry.getHydratedScope(toAppSessionId(sessionId))?.instance
    const cached = instance?.getAgentId()?.trim()
    if (cached) {
      return cached
    }

    const persisted = this.deps.sessions.getIdentity(sessionId)?.agentId
    if (persisted) {
      instance?.setAgentId(persisted)
      return persisted
    }

    return undefined
  }

  getParentSessionId(sessionId: string): string | undefined {
    return this.deps.sessions.getIdentity(sessionId)?.parentSessionId ?? undefined
  }

  getSessionKind(sessionId: string): SessionKind | null {
    return this.deps.sessions.getIdentity(sessionId)?.kind ?? null
  }

  isAcpBackedSubagentSession(sessionId: string, providerId?: string): boolean {
    const session = this.deps.sessions.getIdentity(sessionId)
    if (!session || session.kind !== 'subagent') {
      return false
    }

    const resolvedProviderId =
      providerId?.trim() ||
      this.deps.registry.getHydratedScope(toAppSessionId(sessionId))?.state()?.providerId?.trim() ||
      ''
    return resolvedProviderId === 'acp'
  }
}
