import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

describe('session boundary composition', () => {
  it('reuses one default LegacyChatImportService across startup and skill repair', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const compositionSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/app/composition.ts'),
      'utf8'
    )

    expect(compositionSource.match(/new LegacyChatImportService\(/g)).toHaveLength(1)
    expect(compositionSource).toMatch(
      /new LegacyChatImportService\([^)]*memoryDatabase,\s*sessionData\.tapeStore/
    )
    expect(compositionSource).toContain(
      'legacyChatImportService.repairImportedLegacySessionSkills(conversationId)'
    )
    expect(compositionSource).toContain('legacyChatImportService.start(false)')
  })

  it('keeps hooks notifications on one instance with lazy projection dependencies', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const compositionSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/app/composition.ts'),
      'utf8'
    )

    expect(compositionSource.match(/new HookService\(/g)).toHaveLength(1)
    expect(compositionSource).toContain(
      'getSession: (sessionId) => sessionQuery.getSession(sessionId)'
    )
    expect(compositionSource).toContain(
      'getMessage: (messageId) => sessionQuery.getMessage(messageId)'
    )
  })

  it('constructs Scheduler once after Remote with complete execution dependencies', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const compositionSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/app/composition.ts'),
      'utf8'
    )

    expect(compositionSource.match(/new SchedulerService\(/g)).toHaveLength(1)
    expect(compositionSource.indexOf('new RemoteService(')).toBeLessThan(
      compositionSource.indexOf('new SchedulerService(')
    )
    expect(compositionSource).toContain('runSessionStarter: createCronJobRunSessionStarter({')
    expect(compositionSource).toContain('remoteDeliveryPort: remoteService')
    expect(compositionSource).not.toContain('.setRunSessionStarter(')
    expect(compositionSource).not.toContain('.setRemoteDeliveryPort(')
  })

  it('finishes config migration before connecting module settings', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const mainProcessSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/app/mainProcess.ts'),
      'utf8'
    )

    const migration = mainProcessSource.indexOf('migrateConfigStorage({')
    const settingsConnection = mainProcessSource.indexOf('settingsStore.attachDatabase(')
    const mcpConnection = mainProcessSource.indexOf('mcpSettings.connectDatabase(')
    const providerCreation = mainProcessSource.indexOf('previousAppVersion:')

    expect(migration).toBeGreaterThanOrEqual(0)
    expect(migration).toBeLessThan(settingsConnection)
    expect(settingsConnection).toBeLessThan(mcpConnection)
    expect(mcpConnection).toBeLessThan(providerCreation)
    expect(mainProcessSource).not.toContain('providerSettings.attachDatabase(')
  })

  it('has no late Provider runtime connection or ready fallback', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const compositionSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/app/composition.ts'),
      'utf8'
    )
    const providerSettingsSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/provider/settings.ts'),
      'utf8'
    )

    expect(compositionSource).not.toContain('.startRuntime(')
    expect(providerSettingsSource).not.toContain('providerRuntimeReady')
    expect(providerSettingsSource).not.toContain('runtimeEffects')
  })

  it('keeps the Provider settings port inside the Provider module', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const providerSettingsSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/provider/settings.ts'),
      'utf8'
    )

    expect(providerSettingsSource).toContain('export interface ProviderSettingsPort')
  })

  it('keeps provider-specific config routes inside the Provider module', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const providerRoutesSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/provider/routes.ts'),
      'utf8'
    )

    expect(providerRoutesSource).toContain('configRefreshProviderDbRoute.name')
    expect(providerRoutesSource).toContain('configGetVoiceAiConfigRoute.name')
  })

  it('keeps agent-specific config routes inside the Agent module', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const agentRoutesSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/agent/routes.ts'),
      'utf8'
    )

    expect(agentRoutesSource).toContain('configGetAcpStateRoute.name')
    expect(agentRoutesSource).toContain('configListAgentsRoute.name')
  })

  it('keeps MCP config routes inside the MCP module', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const mcpRoutesSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/mcp/routes.ts'),
      'utf8'
    )

    expect(mcpRoutesSource).toContain('configGetMcpServersRoute.name')
  })

  it('keeps skill config routes inside the Skill module', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const skillRoutesSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/skill/routes.ts'),
      'utf8'
    )

    expect(skillRoutesSource).toContain('configGetSkillDraftSuggestionsRoute.name')
  })

  it('keeps knowledge config routes inside the Knowledge module', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const knowledgeRoutesSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/knowledge/routes.ts'),
      'utf8'
    )

    expect(knowledgeRoutesSource).toContain('configGetKnowledgeConfigsRoute.name')
  })

  it('keeps prompt config routes inside the Agent module', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const promptRoutesSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/agent/promptRoutes.ts'),
      'utf8'
    )

    expect(promptRoutesSource).toContain('configListCustomPromptsRoute.name')
    expect(promptRoutesSource).toContain('configGetSystemPromptsRoute.name')
  })

  it('keeps desktop config routes inside the Desktop module', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const desktopRoutesSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/desktop/routes.ts'),
      'utf8'
    )

    expect(desktopRoutesSource).toContain('configGetLanguageRoute.name')
    expect(desktopRoutesSource).toContain('configGetShortcutKeysRoute.name')
  })

  it('keeps cross-module settings routes in App composition', async () => {
    const { existsSync, readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const configRoutesPath = path.resolve(process.cwd(), 'src/main/config/routes.ts')
    const configHandlerPath = path.resolve(process.cwd(), 'src/main/config/configRouteHandler.ts')
    const appSettingsRoutesSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/app/settingsRoutes.ts'),
      'utf8'
    )

    expect(existsSync(configRoutesPath)).toBe(false)
    expect(existsSync(configHandlerPath)).toBe(false)
    expect(appSettingsRoutesSource).toContain('settingsUpdateRoute.name')
    expect(appSettingsRoutesSource).toContain('configGetEntriesRoute.name')
  })

  it('owns one idempotent shutdown path and rejects routes after shutdown starts', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const compositionSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/app/composition.ts'),
      'utf8'
    )

    expect(compositionSource).toContain('if (stopPromise) return stopPromise')
    expect(compositionSource).toContain("appLifecycleState = 'stopping'")
    expect(compositionSource).toContain("appLifecycleState = 'stopped'")
    expect(compositionSource).toContain('throw new Error(`App lifecycle is ${appLifecycleState}`)')
  })

  it('stops entry points and sessions before owned infrastructure', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const compositionSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/app/composition.ts'),
      'utf8'
    )
    const destroyStart = compositionSource.indexOf('async function destroy(): Promise<void>')
    const destroyEnd = compositionSource.indexOf('async function runDestroyStep', destroyStart)
    const destroySource = compositionSource.slice(destroyStart, destroyEnd)

    expect(destroySource.indexOf("'remoteService.destroy'")).toBeLessThan(
      destroySource.indexOf("'sessionRuntimes.suspend'")
    )
    expect(destroySource.indexOf("'sessionRuntimes.suspend'")).toBeLessThan(
      destroySource.indexOf("'pluginService.shutdown'")
    )
    expect(destroySource).toContain("'yoBrowserPresenter.shutdown'")
    expect(destroySource).toContain("'tabPresenter.destroy'")
    expect(destroySource).toContain("'backgroundExecSessionManager.shutdown'")
    expect(destroySource.indexOf("'windowPresenter.destroyWindows'")).toBeLessThan(
      destroySource.indexOf("'mainDatabase.close'")
    )
  })

  it('starts background module work only after migration and the initial window', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const compositionSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/app/composition.ts'),
      'utf8'
    )
    const startupStart = compositionSource.lastIndexOf('dependencies.bindControl(control)')
    const startupSource = compositionSource.slice(startupStart)

    expect(startupSource.indexOf('await runAcpRegistryMigration()')).toBeLessThan(
      startupSource.indexOf('init(dependencies.startupRunId)')
    )
    expect(
      startupSource.indexOf('await runBuiltinMcpAllowlistCompatibilityMigration(')
    ).toBeLessThan(startupSource.indexOf("createAppWindow({ initialRoute: 'chat' })"))
    expect(startupSource.indexOf("createAppWindow({ initialRoute: 'chat' })")).toBeLessThan(
      startupSource.indexOf('init(dependencies.startupRunId)')
    )
  })

  it('routes restart requests through App shutdown', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const deviceRoutesSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/device/routes.ts'),
      'utf8'
    )

    expect(deviceRoutesSource).toContain('await deps.restartApplication()')
    expect(deviceRoutesSource).not.toContain('await deps.device.restartApp()')
  })

  it('publishes runtime updates through the Session boundary', async () => {
    const { existsSync, readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const retiredEventsPath = path.resolve(
      process.cwd(),
      'src/main/agent/deepchat/runtime/internalSessionEvents.ts'
    )
    const schedulerSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/scheduler/runExecutor.ts'),
      'utf8'
    )
    const toolPortSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/tool/runtimePorts.ts'),
      'utf8'
    )
    const compositionSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/app/composition.ts'),
      'utf8'
    )

    expect(existsSync(retiredEventsPath)).toBe(false)
    expect(schedulerSource).toContain("from '@/session/runtimeEvents'")
    expect(schedulerSource).not.toContain("from '@/agent/")
    expect(toolPortSource).toContain("from '@/session/runtimeEvents'")
    expect(toolPortSource).not.toContain('DeepChatInternalSessionUpdate')
    expect(compositionSource).toContain('const sessionRuntimeEvents = new SessionRuntimeEvents()')
  })

  it('keeps Remote behind App-owned catalog, workspace, Session, and desktop ports', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const remoteSources = [
      'src/main/remote/ports.ts',
      'src/main/remote/index.ts',
      'src/main/remote/conversation/runner.ts'
    ]
      .map((file) => readFileSync(path.resolve(process.cwd(), file), 'utf8'))
      .join('\n')

    expect(remoteSources).not.toMatch(/from ['"]@\/agent\/(manager|settings)/)
    expect(remoteSources).not.toMatch(/from ['"]@\/provider/)
    expect(remoteSources).not.toContain("from '@shared/types/desktop'")
    expect(remoteSources).not.toMatch(/from ['"]\.\.\/scheduler/)
  })

  it('gives built-in Tool handlers required capability-specific ports', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const runtimePortsSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/tool/runtimePorts.ts'),
      'utf8'
    )
    const toolSources = [
      'src/main/tool/index.ts',
      'src/main/tool/runtimePorts.ts',
      'src/main/tool/agentTools/agentToolManager.ts'
    ]
      .map((file) => readFileSync(path.resolve(process.cwd(), file), 'utf8'))
      .join('\n')

    expect(runtimePortsSource).not.toContain('AgentToolRuntimePort')
    expect(runtimePortsSource).not.toMatch(/^\s+\w+\?\(/m)
    expect(toolSources).not.toMatch(/from ['"].*desktop/)
  })
})
