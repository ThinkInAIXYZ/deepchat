import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { SessionDatabase } from '@/session/data/database'
import type { DesktopSessionState } from '@/session/desktopSessionState'
import type { DeepChatOutputPort, SessionStatusPublisherPorts } from '@/agent/shared/output'
import type { SessionEventPublisher } from '@/events/sessionEventRouter'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import { TranscriptProjectionApplier } from '@/session/data/transcriptProjection'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimModelCatalog } from './modelCatalog'
import type { DimLegacySource } from './legacySource'
import type { DimEvent } from './sessionConnection'
import { DimAgentProfiles } from './agentProfiles'
import { DimContent } from './content'
import { DimContext } from './context'
import { DimSessionControls } from './sessionControls'
import { DimSessionSettings } from './sessionSettings'
import { DimSessionRuntime } from './sessionRuntime'
import { DimDesktopProjection } from './desktopProjection'
import { DimLegacyMigration } from './legacyMigration'
import { DimScopeTransitions } from './scopeTransitions'
import { DimInteractions } from './interactions'
import { DimQueue } from './queue'
import { DimTranscriptMutations } from './transcriptMutations'
import { DimMcp, type DimMcpServer } from './mcp'
import { createDimSessionBackend, type DimBackendOptions } from './backend'

interface DimAgentOptions {
  database: SessionDatabase
  host: DimRuntimeSupervisor
  state: DesktopSessionState
  models: DimModelCatalog
  legacy: DimLegacySource
  identity: ConstructorParameters<typeof DimSessionSettings>[0]['identity']
  prepareInput: DimBackendOptions['prepareInput']
  output: DeepChatOutputPort
  publishStatus: SessionStatusPublisherPorts['publishStatus']
  publishEvent: SessionEventPublisher
  completed(sessionId: string): void
  committed(sessionId: string, event: DimEvent): void
  failed(sessionId: string, error: unknown): void
  refreshTools(binding: DimSessionBinding): Promise<void>
  mcpServers(binding: DimSessionBinding): Promise<Record<string, DimMcpServer>>
  closed(sessionId: string): void
  invalidateHistory(sessionId: string, fromOrderSeq: number): void | Promise<void>
  beginDestroy(sessionId: string): void | Promise<void>
  finishDestroy(sessionId: string): void
  deleteLegacyMetadata(sessionId: string): void
}

/** One composition of native owners behind the existing desktop backend contract. */
export function createDimAgent(options: DimAgentOptions) {
  const { database, host, state } = options
  if (!host.usesNativePlugins)
    throw new Error('The built-in backend requires the native dim plugin host')
  const controls = new DimSessionControls(host)
  const content = new DimContent(host)
  const profiles = new DimAgentProfiles(host)
  const mcp = new DimMcp({
    host,
    isCurrent: (binding) => {
      const current = database.dimSessionBindingsTable.get(binding.sessionId)
      return (
        current?.dimSessionId === binding.dimSessionId &&
        current.branchId === binding.branchId &&
        current.generation === binding.generation
      )
    },
    resolve: options.mcpServers,
    failed: options.failed
  })
  const settings = new DimSessionSettings({
    database,
    state,
    models: options.models,
    profiles,
    controls,
    identity: options.identity,
    // The next admission compares the actual immutable native creation identity. No second
    // desktop CWD or tool-mount authority is maintained.
    configurationChanged: async () => {}
  })
  const migration = new DimLegacyMigration({
    database,
    host,
    snapshot: (binding) => options.legacy.snapshot(binding.sessionId)
  })
  const views = new DimDesktopProjection({
    output: options.output,
    publishEvent: options.publishEvent,
    publishStatus: options.publishStatus,
    completed: options.completed,
    committed: (id, event) => {
      context.observe(id, event)
      options.committed(id, event)
    },
    reset: (id) => context.forget(id)
  })
  const runtime = new DimSessionRuntime({
    database,
    host,
    launch: (id) => settings.launch(id, true),
    // A reader can hydrate and convert historical content without granting model execution.
    prepare: (binding) => migration.prepare(binding),
    projected: (_id, projection) => views.apply(projection),
    failed: options.failed
  })
  const installed = (binding: DimSessionBinding, messages: ChatMessageRecord[]) => {
    views.apply({ binding, messages, resetTranscript: true })
    options.publishEvent('sessions.updated', { sessionIds: [binding.sessionId], reason: 'updated' })
  }
  const transitions = new DimScopeTransitions({ database, host, runtime, installed })
  const prepareHistory = async (sessionId: string): Promise<void> => {
    await transitions.recover(sessionId)
    await runtime.open(sessionId)
  }
  const prepareNative = async (sessionId: string): Promise<void> => {
    await prepareHistory(sessionId)
    const binding = await transitions.ensureCreation(sessionId, await settings.creation(sessionId))
    // This is the inference admission check. History-only model registration above cannot skip it.
    await settings.prepare(binding)
    await mcp.refresh(binding)
    await options.refreshTools(binding)
    await runtime.open(sessionId)
  }
  const context = new DimContext({
    database,
    content,
    controls,
    output: options.output,
    prepareNative
  })
  const queue = new DimQueue({
    database,
    host,
    runtime,
    prepareNative,
    setProjectDir: (id, directory) => settings.setSessionProjectDir(id, directory),
    prepareInput: options.prepareInput
  })
  const interactions = new DimInteractions(database, controls)
  const mutations = new DimTranscriptMutations({
    database,
    host,
    settings,
    transitions,
    prepareHistory,
    projectDir: (id) => database.newSessionsTable.get(id)?.project_dir ?? null,
    invalidate: options.invalidateHistory
  })
  const forget = async (sessionId: string) => {
    await mcp.close(sessionId)
    views.forget(sessionId)
    context.forget(sessionId)
    options.closed(sessionId)
  }
  const destroy = async (sessionId: string): Promise<void> => {
    await options.beginDestroy(sessionId)
    await mcp.close(sessionId)
    await runtime.close(sessionId)
    const pending = database.dimScopeChangesTable.get(sessionId)
    const binding = database.dimSessionBindingsTable.get(sessionId)
    const owned = new Set([
      ...database.dimSessionScopesTable.list(sessionId).map((scope) => scope.dimSessionId),
      ...database.dimSessionImportsTable.list(sessionId).map((scope) => scope.dimSessionId),
      ...(binding ? [binding.dimSessionId] : []),
      ...(pending?.targetSessionId ? [pending.targetSessionId] : []),
      ...(pending ? [pending.source.dimSessionId] : [])
    ])
    if (owned.size) {
      const client = await host.start()
      for (const id of owned) await client.call('deepchat.host.delete', { sessionId: id })
    }
    database.getDatabase().transaction(() => {
      new TranscriptProjectionApplier(database).applyRetractions(
        database.deepchatMessagesTable.getIdsBySession(sessionId)
      )
      database.dimInputProjectionTable.deleteBySession(sessionId)
      database.dimInputIntentsTable.deleteBySession(sessionId)
      database.dimSessionImportsTable.deleteBySession(sessionId)
      database.dimSessionBindingsTable.delete(sessionId)
      database.dimSessionScopesTable.delete(sessionId)
      if (pending) database.dimScopeChangesTable.finish(pending)
      options.deleteLegacyMetadata(sessionId)
      database.deepchatSessionsTable.delete(sessionId)
    })()
    await forget(sessionId)
    options.finishDestroy(sessionId)
  }
  const backend = createDimSessionBackend({
    database,
    state,
    runtime,
    prepareInput: options.prepareInput,
    prepareNative,
    closed: forget,
    controllers: {
      initSession: (id, config) => settings.initSession(id, config),
      destroySession: destroy,
      listPendingInputs: queue.listPendingInputs,
      isPendingQueueResumeAvailable: queue.isPendingQueueResumeAvailable,
      resumePendingQueue: queue.resumePendingQueue,
      retryPendingQueueInput: queue.retryPendingQueueInput,
      queuePendingInput: queue.queuePendingInput,
      updateQueuedInput: queue.updateQueuedInput,
      moveQueuedInput: queue.moveQueuedInput,
      steerPendingInput: queue.steerPendingInput,
      resolveBlockedPendingInput: queue.resolveBlockedPendingInput,
      deletePendingInput: queue.deletePendingInput,
      getPermissionMode: (id) => settings.getPermissionMode(id),
      setPermissionMode: (id, mode) => settings.setPermissionMode(id, mode),
      getGenerationSettings: (id) => settings.getGenerationSettings(id),
      updateGenerationSettings: (id, patch) => settings.updateGenerationSettings(id, patch),
      setSessionProjectDir: (id, directory) => settings.setSessionProjectDir(id, directory),
      setSessionAgentContext: (id, config) => settings.setSessionAgentContext(id, config),
      setSessionModel: (id, providerId, modelId) =>
        settings.setSessionModel(id, providerId, modelId),
      respondToolInteraction: interactions.respondToolInteraction,
      dismissToolInteraction: interactions.dismissToolInteraction,
      getSessionCompactionSnapshot: context.getSessionCompactionSnapshot,
      getSessionContextOccupancy: context.getSessionContextOccupancy,
      compactSession: context.compactSession
    }
  })
  return { backend, runtime, settings, mutations, transitions, mcp, prepareNative, prepareHistory }
}
