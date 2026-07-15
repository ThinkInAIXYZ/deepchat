import type { AgentManager } from '@/agent/manager/agentManager'
import type { SessionTapePort, SessionTranscriptReadPort } from '@/session/data/contracts'
import type { AppSessionService } from '@/agent/shared/appSessionService'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { IConfigPresenter, ILlmProviderPresenter } from '@shared/presenter'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import type { SQLitePresenter } from '@/presenter/sqlitePresenter'
import { SessionQuery } from '@/session/query'

export const createSessionQueryFixture = (input: {
  agentManager: AgentManager
  appSessionService: AppSessionService
  llmProviderPresenter: ILlmProviderPresenter
  configPresenter: IConfigPresenter
  sqlitePresenter: SQLitePresenter
  sharedData: {
    transcript: SessionTranscriptReadPort
    tape: SessionTapePort
  }
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
    titles: input.llmProviderPresenter,
    agentConfig: {
      getAssistantModel: async (agentId) => {
        if (typeof input.configPresenter.resolveDeepChatAgentConfig !== 'function') return null
        return (
          (await input.configPresenter.resolveDeepChatAgentConfig(agentId))?.assistantModel ?? null
        )
      }
    },
    events: {
      publish: (payload) => publishDeepchatEvent('sessions.updated', payload)
    },
    ui: input.sessionUiPort ?? { refreshSessionUi: () => undefined }
  })
