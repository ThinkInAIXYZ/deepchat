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
    const providerCreation = mainProcessSource.indexOf('new ProviderSettings(')

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
    const sharedPresenterSource = readFileSync(
      path.resolve(process.cwd(), 'src/shared/types/presenters/core.presenter.d.ts'),
      'utf8'
    )
    const providerSettingsSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/provider/settings.ts'),
      'utf8'
    )

    expect(sharedPresenterSource).not.toContain('interface ProviderSettingsPort')
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
})
