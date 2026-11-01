import type { initializeCoreProfile } from '@/app/profileStartup'
import type { DatabaseSecurityMigrationDatabasePort } from '@/app/databaseSecurity'
import type { DatabaseSecurityStatus } from '@shared/contracts/routes'
import type { DatabaseRepairReport } from '@shared/types/databaseSchema'
import type { SyncImportDatabasePort, SyncImportResult } from '@/sync'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { DatabaseRequestGate } from '@/app/databaseRequestGate'
import type { StartupWorkloadCoordinator } from '@/app/startupWorkloadCoordinator'
import type { createCoreData } from './data'
import type { createCoreProviders } from './providers'
import type { createCoreRuntime } from './runtime'
import type { createCoreSettings } from './settings'

export type CoreMaintenanceNative = {
  configurationHost: {
    pause(): Promise<void>
    resume(): Promise<void>
    stopWrites(): Promise<void>
    drainWrites(): Promise<void>
    startWrites(): Promise<void>
  }
  remoteAuthWindows: { closeAll(): Promise<void> }
}

type ApplicationDatabaseMaintenancePort = SyncImportDatabasePort &
  DatabaseSecurityMigrationDatabasePort

export type DatabaseImportCommand =
  | { kind: 'import-backup-file'; filePath: string; mode: 'increment' | 'overwrite' }
  | { kind: 'import-backup'; fileName: string; mode: 'increment' | 'overwrite' }

export type DatabaseEncryptionCommand =
  | { kind: 'enable-encryption'; password: string }
  | { kind: 'change-password'; currentPassword: string; newPassword: string }
  | { kind: 'disable-encryption'; currentPassword: string }

export type DatabaseRepairCommand = { kind: 'repair-schema' }
type DatabaseMaintenanceCommand =
  | DatabaseImportCommand
  | DatabaseEncryptionCommand
  | DatabaseRepairCommand
type DatabaseMaintenanceResult = SyncImportResult | DatabaseSecurityStatus | DatabaseRepairReport

export function createCoreMaintenance(options: {
  profile: Pick<
    Awaited<ReturnType<typeof initializeCoreProfile>>,
    'database' | 'secretStore' | 'databaseSecurityService'
  >
  data: Pick<
    ReturnType<typeof createCoreData>,
    'appSessionService' | 'providerSettings' | 'legacyChatImportService'
  >
  providers: Pick<ReturnType<typeof createCoreProviders>, 'providerRuntime' | 'agentSettings'>
  settings: Pick<ReturnType<typeof createCoreSettings>, 'appSettingsService'>
  runtime: Pick<
    Awaited<ReturnType<typeof createCoreRuntime>>,
    | 'execution'
    | 'syncService'
    | 'replicaEndpoint'
    | 'automaticSync'
    | 'memoryService'
    | 'cronJobs'
    | 'remoteService'
    | 'hookService'
    | 'pluginService'
    | 'syncReplica'
    | 'mcpApps'
    | 'scheduleBackgroundWork'
  >
  databaseRequests: DatabaseRequestGate
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  native: CoreMaintenanceNative
  isStopping(): boolean
  stopForCleanup(): Promise<void>
}) {
  const {
    profile,
    data,
    providers,
    settings,
    runtime,
    databaseRequests,
    startupWorkloadCoordinator,
    native
  } = options
  const { database: mainDatabase, databaseSecurityService } = profile
  const { appSessionService, providerSettings, legacyChatImportService } = data
  const { providerRuntime, agentSettings } = providers
  const { appSettingsService } = settings
  const {
    execution,
    syncService,
    replicaEndpoint,
    automaticSync,
    memoryService,
    cronJobs,
    remoteService,
    hookService,
    pluginService,
    syncReplica
  } = runtime
  const { deepChatAgentHarness, acpAgentRuntime, memoryIngestionObserver } = execution
  function runDatabaseMaintenance(command: DatabaseImportCommand): Promise<SyncImportResult>
  function runDatabaseMaintenance(
    command: DatabaseEncryptionCommand
  ): Promise<DatabaseSecurityStatus>
  function runDatabaseMaintenance(command: DatabaseRepairCommand): Promise<DatabaseRepairReport>
  async function runDatabaseMaintenance(
    command: DatabaseMaintenanceCommand
  ): Promise<DatabaseMaintenanceResult> {
    if (options.isStopping()) {
      throw new Error('App database owner is stopping')
    }
    const maintenanceState = databaseRequests.state
    if (maintenanceState !== 'running') {
      throw new Error(`App database maintenance is ${maintenanceState}`)
    }
    if (syncService.isBackupInProgress()) throw new Error('sync.tunnel.error.busy')
    try {
      return await databaseRequests.runMaintenance(() => performDatabaseMaintenance(command))
    } catch (error) {
      if (databaseRequests.state === 'failed' && !options.isStopping())
        await options.stopForCleanup()
      throw error
    }
  }

  async function performDatabaseMaintenance(
    command: DatabaseMaintenanceCommand
  ): Promise<DatabaseMaintenanceResult> {
    profile.secretStore.pause()
    runtime.mcpApps.clear()
    try {
      await native.configurationHost.pause()
    } catch (error) {
      databaseRequests.fail()
      throw error
    }
    try {
      await providerRuntime.invalidateGitHubCopilotSignIns()
      await startupWorkloadCoordinator.cancelAndDrainTarget('main')
      await agentSettings.cancelAndDrainAcpWork()
      if (options.isStopping()) {
        throw new Error('App database owner is stopping')
      }
    } catch (error) {
      if (databaseRequests.state === 'maintenance') {
        try {
          await native.configurationHost.resume()
          if (options.isStopping() || databaseRequests.state !== 'maintenance') {
            throw new Error('App database owner is stopping')
          }
          profile.secretStore.resume()
          databaseRequests.resume()
        } catch (resumeError) {
          if (!options.isStopping()) databaseRequests.fail()
          throw new AggregateError([error, resumeError], 'Native configuration did not resume')
        }
        agentSettings.notifyAgentCatalogChanged()
      }
      throw error
    }

    let operationResult: DatabaseMaintenanceResult | undefined
    let operationError: unknown
    try {
      await native.configurationHost.stopWrites()
      await appSettingsService.stop()
      await native.configurationHost.drainWrites()
      replicaEndpoint.stop()
      await automaticSync?.pause()
      memoryService.stopBackgroundMaintenance()
      await execution.liveDelegationService.stop()
      await cronJobs.stop()
      await remoteService.destroy()
      await native.remoteAuthWindows.closeAll()
      await hookService.stop()
      await pluginService.contextHooks?.stop()
      const drain = await memoryIngestionObserver.drainAndFence()
      if (drain.timedOut) {
        throw new Error(
          `Memory ingestion did not drain for sessions: ${drain.pendingSessions.join(', ')}`
        )
      }
      const pendingMaintenanceAgents = await memoryService.drainBackgroundMaintenance()
      if (pendingMaintenanceAgents.length > 0) {
        throw new Error(
          `Memory maintenance did not drain for agents: ${pendingMaintenanceAgents.join(', ')}`
        )
      }
      await suspendSessionRuntimes()
      await databaseRequests.drain()
      if (options.isStopping()) {
        throw new Error('App database owner is stopping')
      }
      const database: ApplicationDatabaseMaintenancePort = {
        getDatabasePath: () => mainDatabase.getDatabasePath(),
        checkpointAndClose: () => {
          const database = mainDatabase.getDatabase()
          if (database.open) {
            database.pragma('wal_checkpoint(TRUNCATE)')
          }
          mainDatabase.close()
        },
        close: () => mainDatabase.close(),
        reopen: () => reopenApplicationDatabase(),
        reopenWithPassword: (password) => {
          mainDatabase.reopenWithPassword(password)
        },
        isOpen: () => mainDatabase.getDatabase().open,
        importLegacyChatDb: (sourceDbPath, mode) =>
          legacyChatImportService.importFromSourceDb(sourceDbPath, mode)
      }
      switch (command.kind) {
        case 'import-backup-file':
          operationResult = await syncService.importBackupFile(
            command.filePath,
            command.mode,
            database
          )
          break
        case 'import-backup':
          operationResult = await syncService.importFromSync(
            command.fileName,
            command.mode,
            database
          )
          break
        case 'enable-encryption':
          operationResult = await databaseSecurityService.enableEncryption({
            password: command.password,
            database,
            providerSettings
          })
          break
        case 'change-password':
          operationResult = await databaseSecurityService.changePassword({
            currentPassword: command.currentPassword,
            newPassword: command.newPassword,
            database,
            providerSettings
          })
          break
        case 'disable-encryption':
          operationResult = await databaseSecurityService.disableEncryption({
            currentPassword: command.currentPassword,
            database,
            providerSettings
          })
          break
        case 'repair-schema':
          operationResult = await mainDatabase.repairSchema()
          break
        default:
          throw new Error('Unsupported database maintenance command')
      }
    } catch (error) {
      operationError = error
    }

    try {
      if (options.isStopping()) {
        throw new Error('App database owner is stopping')
      }
      if (!mainDatabase.getDatabase().open) {
        reopenApplicationDatabase()
      }
      deepChatAgentHarness.reconcileAfterDatabaseReopen()
      profile.secretStore.resume()
      memoryIngestionObserver.resumeIngestion()
      memoryService.startBackgroundMaintenance()
      pluginService.contextHooks?.start()
      hookService.start()
      cronJobs.start()
      await remoteService.initialize()
      if (options.isStopping()) {
        await remoteService.destroy()
        await native.remoteAuthWindows.closeAll()
        throw new Error('App database owner is stopping')
      }
      execution.createLiveDelegationService().start()
      const startupRunId = startupWorkloadCoordinator.createRun('main')
      runtime.scheduleBackgroundWork(startupRunId)
      appSettingsService.start()
      databaseRequests.resume()
      await appSettingsService.publishSnapshot()
      await appSettingsService.observeSystemTheme()
      await native.configurationHost.startWrites()
      agentSettings.notifyAgentCatalogChanged()
      syncReplica?.wake()
      await automaticSync?.start()
      await native.configurationHost.resume()
    } catch (error) {
      if (!options.isStopping()) databaseRequests.fail()
      throw error
    }

    if (operationError) throw operationError
    if (operationResult === undefined) throw new Error('Database maintenance returned no result')
    return operationResult
  }

  function reopenApplicationDatabase(): void {
    mainDatabase.reopen()
  }

  async function suspendSessionRuntimes(): Promise<void> {
    const results = await Promise.allSettled(
      appSessionService.list({ includeSubagents: true }).flatMap((session) => {
        const sessionId = toAppSessionId(session.id)
        return [
          deepChatAgentHarness.cleanupSession(sessionId),
          acpAgentRuntime.cleanupSession(sessionId)
        ]
      })
    )
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (failure) throw failure.reason
  }

  async function pullLatestBackupFromCloud(importMode: 'increment' | 'overwrite' = 'increment') {
    const download = await syncService.downloadLatestBackupFromCloud()
    if (!download.success || !download.fileName) return download
    const backupFileName = download.fileName
    const result = await runDatabaseMaintenance({
      kind: 'import-backup',
      fileName: backupFileName,
      mode: importMode
    })
    return { ...result, fileName: backupFileName }
  }

  return { run: runDatabaseMaintenance, pullLatestBackupFromCloud, suspendSessionRuntimes }
}
