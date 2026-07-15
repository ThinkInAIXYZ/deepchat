import type {
  AcpAgentDescriptor,
  AgentDescriptor,
  DeepChatAgentDescriptor
} from '@/agent/shared/agentDescriptors'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { DeepChatSessionState, SessionRecord } from '@shared/types/agent-interface'
import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'
import type { DirectAcpSessionBackend } from './directAcpAgentBackend'
import type { DeepChatAgentBackend } from './deepChatAgentBackend'
import type {
  AgentActiveGeneration,
  AgentSubagentFacet,
  AgentTransferSourceFacet,
  DirectAcpSessionHandle,
  DeepChatSessionHandle,
  DeepChatTransferTargetFacet
} from './sessionHandles'

export interface ExecutableAgentCatalog {
  resolveExecutableDescriptor(agentId: string): AgentDescriptor
}

export interface AppSessionLookupPort {
  get(sessionId: AppSessionId): SessionRecord | null
}

export interface AgentManagerGenerationPort {
  getActiveGeneration(sessionId: AppSessionId): AgentActiveGeneration | null
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

export interface AgentBackendSet {
  readonly deepchat: DeepChatAgentBackend
  readonly acp: DirectAcpSessionBackend
}

export type ResolvedAgentBackend =
  | {
      kind: 'deepchat'
      descriptor: DeepChatAgentDescriptor
      backend: DeepChatAgentBackend
    }
  | { kind: 'acp'; descriptor: AcpAgentDescriptor; backend: DirectAcpSessionBackend }

export type ResolvedAgentSession =
  | { kind: 'deepchat'; descriptor: DeepChatAgentDescriptor; handle: DeepChatSessionHandle }
  | { kind: 'acp'; descriptor: AcpAgentDescriptor; handle: DirectAcpSessionHandle }

export interface ResolvedTransferSource {
  descriptor: AgentDescriptor
  handle: DeepChatSessionHandle | DirectAcpSessionHandle
  facet: AgentTransferSourceFacet
  closeRuntime?: () => Promise<void>
}

export interface ResolvedDeepChatTransferTarget {
  descriptor: DeepChatAgentDescriptor
  facet: DeepChatTransferTargetFacet
}

export type ResolvedSubagentFacet =
  | { kind: 'deepchat'; descriptor: DeepChatAgentDescriptor; facet: AgentSubagentFacet }
  | { kind: 'acp'; descriptor: AcpAgentDescriptor; facet: AgentSubagentFacet }

export class AgentManager implements AgentManagerGenerationPort {
  constructor(
    private readonly catalog: ExecutableAgentCatalog,
    private readonly appSessions: AppSessionLookupPort,
    private readonly backends: AgentBackendSet
  ) {}

  resolveBackend(agentId: string): ResolvedAgentBackend {
    const descriptor = this.catalog.resolveExecutableDescriptor(resolveAcpAgentAlias(agentId))
    return descriptor.kind === 'deepchat'
      ? { kind: descriptor.kind, descriptor, backend: this.backends.deepchat }
      : { kind: descriptor.kind, descriptor, backend: this.backends.acp }
  }

  resolveSessionBackend(sessionId: AppSessionId): ResolvedAgentBackend {
    const session = this.appSessions.get(sessionId)
    if (!session) throw new AppSessionNotFoundError(sessionId)
    return this.resolveBackend(session.agentId)
  }

  resolveSessionHandle(sessionId: AppSessionId): ResolvedAgentSession {
    const resolved = this.resolveSessionBackend(sessionId)
    if (resolved.kind === 'deepchat') {
      return {
        kind: resolved.kind,
        descriptor: resolved.descriptor,
        handle: resolved.backend.open(sessionId)
      }
    }
    const handle = resolved.backend.open(sessionId, resolved.descriptor)
    return { kind: resolved.kind, descriptor: resolved.descriptor, handle }
  }

  async snapshotIfHydrated(sessionId: AppSessionId): Promise<DeepChatSessionState | null> {
    const resolved = this.resolveSessionBackend(sessionId)
    return resolved.kind === 'deepchat'
      ? await resolved.backend.snapshotIfHydrated(sessionId)
      : await resolved.backend.snapshotIfHydrated(sessionId, resolved.descriptor)
  }

  getActiveGeneration(sessionId: AppSessionId): AgentActiveGeneration | null {
    return this.resolveSessionBackend(sessionId).backend.generationControl.getActiveGeneration(
      sessionId
    )
  }

  async cancelGenerationByEventId(sessionId: AppSessionId, eventId: string): Promise<boolean> {
    return await this.resolveSessionBackend(
      sessionId
    ).backend.generationControl.cancelGenerationByEventId(sessionId, eventId)
  }

  async cleanupSessionBackends(sessionId: AppSessionId): Promise<void> {
    const results = await Promise.allSettled([
      this.backends.deepchat.cleanupSession(sessionId),
      this.backends.acp.cleanupSession(sessionId)
    ])
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (failure) throw failure.reason
  }

  resolveTransferSource(sessionId: AppSessionId): ResolvedTransferSource {
    const resolved = this.resolveSessionBackend(sessionId)
    const session = this.resolveSessionHandle(sessionId)
    let closeRuntime: (() => Promise<void>) | undefined
    if (session.handle.kind === 'acp') {
      const directHandle = session.handle
      closeRuntime = () => directHandle.acp.closeRuntime()
    }
    return {
      descriptor: resolved.descriptor,
      handle: session.handle,
      facet: resolved.backend.transferSource,
      ...(closeRuntime ? { closeRuntime } : {})
    }
  }

  resolveDeepChatTransferTarget(agentId: string): ResolvedDeepChatTransferTarget {
    const resolved = this.resolveBackend(agentId)
    if (resolved.kind !== 'deepchat') {
      throw new AgentCapabilityUnavailableError(resolved.descriptor.id, 'transfer-target')
    }
    return { descriptor: resolved.descriptor, facet: resolved.backend.transferTarget }
  }

  resolveSubagentFacet(sessionId: AppSessionId): ResolvedSubagentFacet {
    const resolved = this.resolveSessionBackend(sessionId)
    return resolved.kind === 'deepchat'
      ? { kind: resolved.kind, descriptor: resolved.descriptor, facet: resolved.backend.subagent }
      : { kind: resolved.kind, descriptor: resolved.descriptor, facet: resolved.backend.subagent }
  }
}
