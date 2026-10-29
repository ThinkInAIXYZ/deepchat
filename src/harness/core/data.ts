import path from 'node:path'
import logger from '@shared/logger'
import type { DeepchatEventName } from '@shared/contracts/events'
import type { initializeCoreProfile } from '@/app/profileStartup'
import type { ProviderDbBootstrap } from '@/provider/providerDbLoader'
import { ProviderSettings } from '@/provider/settings'
import { createSessionData } from '@/session/data'
import { MemoryDatabase } from '@/memory/data/database'
import { AgentRepository } from '@/agent/repository'
import { AgentLifecycleGate } from '@/agent/lifecycleGate'
import { SessionDeletionGate } from '@/session/deletionGate'
import { ProjectDatabase } from '@/project/data/database'
import { SchedulerDatabase } from '@/scheduler/data/database'
import { AppDatabase } from '@/app/data/database'
import { AppSessionService } from '@/agent/shared/appSessionService'
import { PromptSettings } from '@/agent/promptSettings'
import { TaskContractService } from '@/tape/application/taskContractService'
import { TaskEvaluationService } from '@/tape/application/taskEvaluationService'
import { LiveDelegationDatabase } from '@/orchestration/data/database'
import { LiveDelegationRepository } from '@/orchestration/liveDelegationRepository'
import { SessionRuntimeEvents } from '@/session/runtimeEvents'
import {
  TapeInspectorHeadWatcher,
  type TapeInspectorHeadWatcherOptions
} from '@/tape/application/traceInspectorHeadWatcher'
import { LegacyChatImportService } from '@/app/startupMigrations/legacyChatImportService'
import { UsageStatsService } from '@/session/usageStatsService'
import type { SessionDataMigrationSQLitePort } from '@/app/startupMigrations/sessionDataMigrations'

type CoreProfile = Awaited<ReturnType<typeof initializeCoreProfile>>

export function createCoreData(options: {
  profile: Pick<
    CoreProfile,
    | 'database'
    | 'settingsStore'
    | 'privacySettings'
    | 'providerDatabase'
    | 'agentDatabase'
    | 'settingsDatabase'
    | 'currentAppVersion'
    | 'previousAppVersion'
  >
  profileDirectory: string
  providerCatalogBootstrap: ProviderDbBootstrap
  publishEvent(name: DeepchatEventName, payload: unknown): void
  emitTapeHead: TapeInspectorHeadWatcherOptions['emit']
  onRendererDestroyed: TapeInspectorHeadWatcherOptions['watchRendererDestroyed']
  projectEnvironmentChanged(): void
}) {
  const { profile, publishEvent: publishDeepchatEvent } = options
  const providerSettings = new ProviderSettings(
    profile.settingsStore,
    profile.privacySettings,
    profile.providerDatabase,
    publishDeepchatEvent,
    profile.currentAppVersion,
    options.providerCatalogBootstrap,
    profile.previousAppVersion
  )

  const memoryDatabase = new MemoryDatabase(profile.database)
  const sessionData = createSessionData(
    profile.database,
    () => memoryDatabase.ingestionProjectionTable,
    {
      publishPendingInputsChanged: (sessionId) =>
        publishDeepchatEvent('sessions.pendingInputs.changed', {
          sessionId,
          version: Date.now()
        }),
      publishMessagesChanged: (sessionId, messages) =>
        publishDeepchatEvent('sessions.messages.changed', {
          sessionId,
          messages,
          version: Date.now()
        })
    }
  )
  const tapeInspectorHeadWatcher = new TapeInspectorHeadWatcher({
    readHead: (sessionId) => sessionData.tapeStore.getTapeInspectorHead(sessionId),
    emit: options.emitTapeHead,
    watchRendererDestroyed: options.onRendererDestroyed,
    onError: (error, sessionId) => {
      logger.warn('[TapeInspectorHeadWatcher] Failed to read committed head', {
        sessionId,
        error
      })
    }
  })
  const taskContractService = new TaskContractService(
    () => sessionData.database.deepchatContractStore
  )
  const taskEvaluationService = new TaskEvaluationService(
    () => sessionData.database.deepchatContractStore
  )
  const liveDelegationRepository = new LiveDelegationRepository(
    new LiveDelegationDatabase(profile.database),
    taskContractService,
    taskEvaluationService
  )
  const sessionRuntimeEvents = new SessionRuntimeEvents()
  const projectDatabase = new ProjectDatabase(profile.database)
  const agentDatabase = profile.agentDatabase
  const settingsDatabase = profile.settingsDatabase
  const providerDatabase = profile.providerDatabase
  const schedulerDatabase = new SchedulerDatabase(profile.database)
  const appDatabase = new AppDatabase(profile.database)
  const agentRepository = new AgentRepository(agentDatabase, sessionData.database, memoryDatabase)
  const agentLifecycle = new AgentLifecycleGate()
  const sessionDeletionGate = new SessionDeletionGate()
  const promptSettings = new PromptSettings(profile.settingsStore, {
    publishCustomPromptsChanged: (prompts) =>
      publishDeepchatEvent('config.customPrompts.changed', {
        prompts,
        version: Date.now()
      }),
    publishSystemPromptsChanged: (state) =>
      publishDeepchatEvent('config.systemPrompts.changed', {
        ...state,
        version: Date.now()
      })
  })
  const appSessionService = new AppSessionService(
    projectDatabase,
    sessionData.database,
    options.projectEnvironmentChanged
  )
  const resolveSessionRunId = (sessionId: string) => {
    const visited = new Set<string>()
    let currentSessionId: string | null = sessionId
    while (currentSessionId && visited.size < 32 && !visited.has(currentSessionId)) {
      visited.add(currentSessionId)
      const session = appSessionService.get(currentSessionId)
      if (!session) return undefined
      if (session.metadata?.source === 'cli_run') return session.id
      currentSessionId = session.parentSessionId ?? null
    }
    return currentSessionId ? undefined : null
  }
  const sessionDataMigrationSQLite: SessionDataMigrationSQLitePort = {
    get appSettingsTable() {
      return settingsDatabase.appSettingsTable
    },
    getDatabase: () => sessionData.database.getDatabase(),
    get newSessionsTable() {
      return sessionData.database.newSessionsTable
    },
    get newSessionActiveSkillsTable() {
      return sessionData.database.newSessionActiveSkillsTable
    },
    get newSessionDisabledAgentToolsTable() {
      return sessionData.database.newSessionDisabledAgentToolsTable
    },
    get deepchatSearchDocumentsTable() {
      return sessionData.database.deepchatSearchDocumentsTable
    },
    get deepchatUserMessagesTable() {
      return sessionData.database.deepchatUserMessagesTable
    },
    get deepchatUserMessageFilesTable() {
      return sessionData.database.deepchatUserMessageFilesTable
    },
    get deepchatUserMessageLinksTable() {
      return sessionData.database.deepchatUserMessageLinksTable
    },
    get deepchatAssistantBlocksTable() {
      return sessionData.database.deepchatAssistantBlocksTable
    }
  }
  const legacyChatImportService = new LegacyChatImportService(
    appDatabase,
    sessionData.database,
    projectDatabase,
    memoryDatabase,
    sessionData.tapeStore,
    path.join(options.profileDirectory, 'app_db', 'chat.db'),
    options.projectEnvironmentChanged
  )
  const usageStatsService = new UsageStatsService(
    sessionData.database,
    providerSettings,
    profile.settingsStore,
    sessionData.tapeStore
  )
  return {
    providerSettings,
    memoryDatabase,
    sessionData,
    tapeInspectorHeadWatcher,
    liveDelegationRepository,
    sessionRuntimeEvents,
    projectDatabase,
    agentDatabase,
    settingsDatabase,
    providerDatabase,
    schedulerDatabase,
    agentRepository,
    agentLifecycle,
    sessionDeletionGate,
    promptSettings,
    appSessionService,
    resolveSessionRunId,
    sessionDataMigrationSQLite,
    legacyChatImportService,
    usageStatsService
  }
}
