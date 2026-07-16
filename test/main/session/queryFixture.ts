import type { ProviderSettingsPort } from '@/provider/settings'
import type { AgentManager } from '@/agent/manager/agentManager'
import type { SessionTapePort, SessionTranscriptReadPort } from '@/session/data/contracts'
import type { AppSessionService } from '@/agent/shared/appSessionService'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { ProviderRuntimePort } from '@shared/types/provider'
import type { DeepchatEventPayload } from '@shared/contracts/events'
import type { MainDatabase } from '@/data/mainDatabase'
import { SessionQuery } from '@/session/query'

export const createSessionQueryFixture = (input: {
  agentManager: AgentManager
  appSessionService: AppSessionService
  providerRuntime: ProviderRuntimePort
  providerSettings: ProviderSettingsPort
  sqlitePresenter: MainDatabase
  sharedData: {
    transcript: SessionTranscriptReadPort
    tape: SessionTapePort
  }
  publishSessionsUpdated(payload: DeepchatEventPayload<'sessions.updated'>): void
  sessionUiPort?: { refreshSessionUi(): void }
}): SessionQuery =>
  new SessionQuery({
    sessions: input.appSessionService,
    runtime: {
      getAgentKind: (agentId) => input.agentManager.resolveBackend(agentId).kind,
      snapshot: async (sessionId, options) =>
        await input.agentManager
          .resolveSessionHandle(toAppSessionId(sessionId))
          .handle.snapshot(options),
      snapshotIfHydrated: async (sessionId) =>
        await input.agentManager.snapshotIfHydrated(toAppSessionId(sessionId)),
      waitForFirstTurnReady: async (sessionId, options) =>
        await input.agentManager
          .resolveSessionHandle(toAppSessionId(sessionId))
          .handle.waitForFirstTurnReady(options)
    },
    transcript: input.sharedData.transcript,
    tape: input.sharedData.tape,
    messages: input.sqlitePresenter.deepchatMessagesTable,
    searchResults: input.sqlitePresenter.deepchatMessageSearchResultsTable,
    traces: input.sqlitePresenter.deepchatMessageTracesTable,
    titles: input.providerRuntime,
    agentConfig: {
      getAssistantModel: async (agentId) => {
        if (typeof input.providerSettings.resolveDeepChatAgentConfig !== 'function') return null
        return (
          (await input.providerSettings.resolveDeepChatAgentConfig(agentId))?.assistantModel ?? null
        )
      }
    },
    events: {
      publish: input.publishSessionsUpdated
    },
    ui: input.sessionUiPort ?? { refreshSessionUi: () => undefined }
  })
