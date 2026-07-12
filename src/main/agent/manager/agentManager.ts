import type {
  AcpAgentDescriptor,
  AgentDescriptor,
  DeepChatAgentDescriptor
} from '@/agent/shared/agentDescriptors'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { SessionRecord } from '@shared/types/agent-interface'
import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'
import type {
  LegacyAcpSubagentFacet,
  LegacyAgentBackendSet,
  LegacyActiveGeneration,
  LegacyAgentSessionBackend,
  LegacyAgentSessionHandle,
  LegacyDeepChatSubagentFacet,
  LegacyDeepChatTransferTargetFacet,
  LegacyTransferSourceFacet
} from './legacyAgentBackends'

export interface ExecutableAgentCatalog {
  resolveExecutableDescriptor(agentId: string): AgentDescriptor
}

export interface AppSessionLookupPort {
  get(sessionId: AppSessionId): SessionRecord | null
}

export interface AgentManagerGenerationPort {
  getActiveGeneration(sessionId: AppSessionId): LegacyActiveGeneration | null
  cancelGenerationByEventId(sessionId: AppSessionId, eventId: string): Promise<boolean>
}

export class AppSessionNotFoundError extends Error {
  readonly code = 'APP_SESSION_NOT_FOUND'

  constructor(readonly sessionId: AppSessionId) {
    super(`Session not found: ${sessionId}`)
    this.name = 'AppSessionNotFoundError'
  }
}

export class AgentCapabilityUnavailableError extends Error {
  readonly code = 'AGENT_CAPABILITY_UNAVAILABLE'

  constructor(
    readonly agentId: string,
    readonly capability: 'transfer-target'
  ) {
    super(`Agent "${agentId}" does not support capability: ${capability}`)
    this.name = 'AgentCapabilityUnavailableError'
  }
}

export interface ResolvedLegacyAgentBackend {
  descriptor: AgentDescriptor
  backend: LegacyAgentSessionBackend
}

export interface ResolvedLegacyAgentSession {
  descriptor: AgentDescriptor
  handle: LegacyAgentSessionHandle
}

export interface ResolvedTransferSource extends ResolvedLegacyAgentSession {
  facet: LegacyTransferSourceFacet
}

export interface ResolvedDeepChatTransferTarget {
  descriptor: DeepChatAgentDescriptor
  facet: LegacyDeepChatTransferTargetFacet
}

export type ResolvedSubagentFacet =
  | {
      kind: 'deepchat'
      descriptor: DeepChatAgentDescriptor
      facet: LegacyDeepChatSubagentFacet
    }
  | {
      kind: 'acp'
      descriptor: AcpAgentDescriptor
      facet: LegacyAcpSubagentFacet
    }

export class AgentManager implements AgentManagerGenerationPort {
  constructor(
    private readonly catalog: ExecutableAgentCatalog,
    private readonly appSessions: AppSessionLookupPort,
    private readonly backends: LegacyAgentBackendSet
  ) {}

  resolveBackend(agentId: string): ResolvedLegacyAgentBackend {
    const descriptor = this.catalog.resolveExecutableDescriptor(resolveAcpAgentAlias(agentId))
    switch (descriptor.kind) {
      case 'deepchat':
        return { descriptor, backend: this.backends.deepchat }
      case 'acp':
        return { descriptor, backend: this.backends.acp }
    }
  }

  resolveSessionBackend(sessionId: AppSessionId): ResolvedLegacyAgentBackend {
    const session = this.appSessions.get(sessionId)
    if (!session) {
      throw new AppSessionNotFoundError(sessionId)
    }
    return this.resolveBackend(session.agentId)
  }

  resolveSessionHandle(sessionId: AppSessionId): ResolvedLegacyAgentSession {
    const { descriptor, backend } = this.resolveSessionBackend(sessionId)
    return { descriptor, handle: backend.open(sessionId) }
  }

  getActiveGeneration(sessionId: AppSessionId): LegacyActiveGeneration | null {
    return this.resolveSessionBackend(sessionId).backend.generationControl.getActiveGeneration(
      sessionId
    )
  }

  async cancelGenerationByEventId(sessionId: AppSessionId, eventId: string): Promise<boolean> {
    const { backend } = this.resolveSessionBackend(sessionId)
    return await backend.generationControl.cancelGenerationByEventId(sessionId, eventId)
  }

  resolveTransferSource(sessionId: AppSessionId): ResolvedTransferSource {
    const { descriptor, backend } = this.resolveSessionBackend(sessionId)
    return {
      descriptor,
      handle: backend.open(sessionId),
      facet: backend.transferSource
    }
  }

  resolveDeepChatTransferTarget(agentId: string): ResolvedDeepChatTransferTarget {
    const { descriptor, backend } = this.resolveBackend(agentId)
    if (descriptor.kind !== 'deepchat' || backend.kind !== 'deepchat') {
      throw new AgentCapabilityUnavailableError(descriptor.id, 'transfer-target')
    }
    return { descriptor, facet: backend.transferTarget }
  }

  resolveSubagentFacet(sessionId: AppSessionId): ResolvedSubagentFacet {
    const { descriptor, backend } = this.resolveSessionBackend(sessionId)
    if (descriptor.kind === 'deepchat' && backend.kind === 'deepchat') {
      return { kind: 'deepchat', descriptor, facet: backend.subagent }
    }
    if (descriptor.kind === 'acp' && backend.kind === 'acp') {
      return { kind: 'acp', descriptor, facet: backend.subagent }
    }
    throw new Error(`Agent backend kind mismatch for "${descriptor.id}"`)
  }
}
