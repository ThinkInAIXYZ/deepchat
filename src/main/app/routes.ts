import { app } from 'electron'
import type { ConfigServicePort, ISQLitePresenter } from '@shared/presenter'
import {
  databaseSecurityChangePasswordRoute,
  databaseSecurityDisableRoute,
  databaseSecurityEnableRoute,
  databaseSecurityGetStatusRoute,
  databaseSecurityRepairSchemaRoute,
  debugCreateMockChatSessionRoute,
  startupGetBootstrapRoute,
  type DatabaseSecurityStatus,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import type { DatabaseSecurityService } from './databaseSecurity'
import type { StartupWorkloadCoordinator } from '@/app/startupWorkloadCoordinator'
import type { SessionQuery } from '@/session/query'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import { createDebugMockChatSession } from './debug/createMockChatSession'
import type { ProjectService } from '@/project'

export function createAppRoutes(deps: {
  config: Pick<ConfigServicePort, 'listAgents' | 'getAcpEnabled'>
  projects: Pick<ProjectService, 'getDefaultProjectPath'>
  databaseSecurity: Pick<DatabaseSecurityService, 'getStatus'>
  database: Pick<ISQLitePresenter, 'repairSchema' | 'getDatabase'>
  startupSession: Pick<SessionQuery, 'getLightweightByIds'>
  desktopSession: { getActiveId(webContentsId: number): string | null }
  startup: Pick<StartupWorkloadCoordinator, 'scheduleTask' | 'getRunId' | 'replayTarget'>
  ensureDefaultWorkspace(): Promise<string | null>
  enableDatabaseEncryption(password: string): Promise<DatabaseSecurityStatus>
  changeDatabasePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<DatabaseSecurityStatus>
  disableDatabaseEncryption(currentPassword: string): Promise<DatabaseSecurityStatus>
  recordActivity(input: SettingsActivityInput): void
  publishSessionsUpdated(sessionIds: string[]): void
}): DeepchatRouteMap {
  const recordEncryptionActivity = (action: 'enabled' | 'updated' | 'disabled', key: string) => {
    deps.recordActivity({
      category: 'privacy',
      action,
      targetType: 'database-encryption',
      targetId: 'agent.db',
      targetLabel: 'SQLite database encryption',
      routeName: 'settings-database',
      summaryKey: 'settings.controlCenter.activity.settingUpdated',
      summaryParams: { key }
    })
  }

  return createRouteMap([
    [
      databaseSecurityGetStatusRoute.name,
      async (rawInput) => {
        databaseSecurityGetStatusRoute.input.parse(rawInput)
        return databaseSecurityGetStatusRoute.output.parse({
          status: deps.databaseSecurity.getStatus()
        })
      }
    ],
    [
      databaseSecurityEnableRoute.name,
      async (rawInput) => {
        const input = databaseSecurityEnableRoute.input.parse(rawInput)
        const status = await deps.enableDatabaseEncryption(input.password)
        recordEncryptionActivity('enabled', 'databaseEncryption')
        return databaseSecurityEnableRoute.output.parse({ status })
      }
    ],
    [
      databaseSecurityChangePasswordRoute.name,
      async (rawInput) => {
        const input = databaseSecurityChangePasswordRoute.input.parse(rawInput)
        const status = await deps.changeDatabasePassword(input.currentPassword, input.newPassword)
        recordEncryptionActivity('updated', 'databaseEncryptionPassword')
        return databaseSecurityChangePasswordRoute.output.parse({ status })
      }
    ],
    [
      databaseSecurityDisableRoute.name,
      async (rawInput) => {
        const input = databaseSecurityDisableRoute.input.parse(rawInput)
        const status = await deps.disableDatabaseEncryption(input.currentPassword)
        recordEncryptionActivity('disabled', 'databaseEncryption')
        return databaseSecurityDisableRoute.output.parse({ status })
      }
    ],
    [
      databaseSecurityRepairSchemaRoute.name,
      async (rawInput) => {
        databaseSecurityRepairSchemaRoute.input.parse(rawInput)
        return databaseSecurityRepairSchemaRoute.output.parse({
          report: await deps.database.repairSchema()
        })
      }
    ],
    [
      startupGetBootstrapRoute.name,
      async (rawInput, context) => {
        startupGetBootstrapRoute.input.parse(rawInput)
        return await deps.startup.scheduleTask({
          id: 'main.bootstrap:route',
          target: 'main',
          phase: 'interactive',
          resource: 'io',
          labelKey: 'startup.main.bootstrap',
          visibleId: 'main.bootstrap',
          dedupeKey: 'main.bootstrap:route',
          runId: deps.startup.getRunId('main'),
          run: async () => {
            const activeSessionId = deps.desktopSession.getActiveId(context.webContentsId)
            const activeSession = activeSessionId
              ? ((await deps.startupSession.getLightweightByIds([activeSessionId]))[0] ?? null)
              : null
            const [agents, acpEnabled, defaultChatWorkspacePath] = await Promise.all([
              deps.config.listAgents(),
              deps.config.getAcpEnabled(),
              deps.ensureDefaultWorkspace()
            ])
            const bootstrap = {
              startupRunId: deps.startup.getRunId('main'),
              activeSessionId,
              activeSession,
              agents: agents
                .filter((agent) => agent.type === 'deepchat' || acpEnabled)
                .map((agent) => ({
                  id: agent.id,
                  name: agent.name,
                  type: agent.type,
                  agentType: agent.agentType,
                  enabled: agent.enabled,
                  protected: agent.protected,
                  icon: agent.icon,
                  description: agent.description,
                  source: agent.source,
                  avatar: agent.avatar
                })),
              defaultProjectPath: deps.projects.getDefaultProjectPath(),
              defaultChatWorkspacePath
            }
            deps.startup.replayTarget('main')
            return startupGetBootstrapRoute.output.parse({ bootstrap })
          }
        })
      }
    ],
    [
      debugCreateMockChatSessionRoute.name,
      async (rawInput) => {
        debugCreateMockChatSessionRoute.input.parse(rawInput)
        if (!import.meta.env.DEV || app.isPackaged) {
          return debugCreateMockChatSessionRoute.output.parse({
            created: false,
            sessionId: null,
            title: null,
            messageCount: 0
          })
        }
        const result = createDebugMockChatSession(deps.database.getDatabase())
        if (result.sessionId) deps.publishSessionsUpdated([result.sessionId])
        return debugCreateMockChatSessionRoute.output.parse(result)
      }
    ]
  ])
}
