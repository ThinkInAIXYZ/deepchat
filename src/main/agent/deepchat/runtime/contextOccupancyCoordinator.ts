import type { SessionContextOccupancySnapshot } from '@shared/types/agent-interface'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { SessionTape } from '@/tape/application/sessionTape'
import type { SessionSettingsCoordinator } from './sessionSettingsCoordinator'
import type { SessionStateResolver } from './sessionStateResolver'
import { resolveEffectiveContextBudget } from './contextBudget'

type ContextOccupancyDependencies = {
  runtime: Pick<DeepChatAgentRuntime, 'getOrHydrateScope'>
  sessionState: Pick<SessionStateResolver, 'getSummary'>
  sessionSettings: Pick<SessionSettingsCoordinator, 'getEffectiveGenerationSettings'>
  tape: Pick<SessionTape, 'getContextOccupancyEvidence'>
}

export function unavailableContextOccupancy(): SessionContextOccupancySnapshot {
  return {
    freshness: 'unavailable',
    source: null,
    occupiedTokens: null,
    contextWindowTokens: null,
    requestSeq: null,
    manifestEntryId: null,
    providerAttemptEntryId: null,
    measuredAt: null
  }
}

function checkedTokenSum(left: number, right: number): number | null {
  if (
    !Number.isSafeInteger(left) ||
    left < 0 ||
    !Number.isSafeInteger(right) ||
    right < 0
  ) {
    return null
  }
  const total = left + right
  return Number.isSafeInteger(total) ? total : null
}

export class ContextOccupancyCoordinator {
  constructor(private readonly deps: ContextOccupancyDependencies) {}

  async getSnapshot(sessionId: string): Promise<SessionContextOccupancySnapshot> {
    const scope = this.deps.runtime.getOrHydrateScope(toAppSessionId(sessionId))
    let state = scope.state()
    if (!state) {
      try {
        state = (await this.deps.sessionState.getSummary(sessionId)) ?? undefined
      } catch {
        return unavailableContextOccupancy()
      }
      if (!scope.isCurrent() || !state) return unavailableContextOccupancy()
    }

    let configuredContextLength: number
    try {
      const settings = await this.deps.sessionSettings.getEffectiveGenerationSettings(
        sessionId,
        scope.instance
      )
      if (!scope.isCurrent()) return unavailableContextOccupancy()
      configuredContextLength = settings.contextLength
    } catch {
      return unavailableContextOccupancy()
    }

    const latestState = scope.state()
    if (!latestState) return unavailableContextOccupancy()
    const evidence = this.deps.tape.getContextOccupancyEvidence(sessionId)
    const manifestRecord = evidence.manifest
    if (!manifestRecord || manifestRecord.integrity !== 'valid') {
      return unavailableContextOccupancy()
    }

    const { manifest } = manifestRecord
    const observation = scope.instance.getContextWindowObservation(
      latestState.providerId,
      latestState.modelId
    )
    const effectiveContextLength = resolveEffectiveContextBudget({
      configuredContextLength,
      requestedMaxTokens: manifest.tokenBudget.requestedMaxTokens,
      providerContextLimitTokens: observation?.providerContextLimitTokens,
      providerPromptLimitTokens: observation?.providerPromptLimitTokens
    }).contextLength
    const contextWindowTokens = manifest.tokenBudget.contextLength
    if (!Number.isSafeInteger(contextWindowTokens) || contextWindowTokens <= 0) {
      return unavailableContextOccupancy()
    }

    const providerAttempt = evidence.providerAttempt
    const providerMeasurement =
      providerAttempt &&
      providerAttempt.attempt.status === 'completed' &&
      providerAttempt.attempt.messageId === manifest.messageId &&
      providerAttempt.attempt.requestSeq === manifest.requestSeq &&
      providerAttempt.attempt.providerId === manifest.meta.providerId &&
      providerAttempt.attempt.modelId === manifest.meta.modelId &&
      providerAttempt.attempt.usage
        ? {
            inputTokens: providerAttempt.attempt.usage.inputTokens,
            entryId: providerAttempt.entryId,
            createdAt: providerAttempt.createdAt
          }
        : null
    const estimatedTokens = checkedTokenSum(
      manifest.tokenBudget.estimatedPromptTokens,
      manifest.tokenBudget.toolReserveTokens
    )
    const occupiedTokens = providerMeasurement?.inputTokens ?? estimatedTokens
    if (occupiedTokens === null) return unavailableContextOccupancy()

    const reconstructionAnchorEntryId = manifest.reconstructionAnchorEntryId ?? null
    const freshness =
      manifest.meta.providerId === latestState.providerId &&
      manifest.meta.modelId === latestState.modelId &&
      contextWindowTokens === effectiveContextLength &&
      reconstructionAnchorEntryId === evidence.latestReconstructionAnchorEntryId
        ? 'current'
        : 'stale'

    return {
      freshness,
      source: providerMeasurement ? 'provider' : 'estimated',
      occupiedTokens,
      contextWindowTokens,
      requestSeq: manifest.requestSeq,
      manifestEntryId: manifestRecord.entryId,
      providerAttemptEntryId: providerMeasurement?.entryId ?? null,
      measuredAt: providerMeasurement?.createdAt ?? manifestRecord.createdAt
    }
  }
}
