import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import ElectronStore from 'electron-store'
import { unzipSync } from 'fflate'
import type { SkillServicePort } from '@shared/types/skill'
import type { McpServicePort, MCPServerConfig } from '@shared/types/mcp'
import type {
  DeepChatPluginManifest,
  PluginActionResult,
  PluginInstallationRecord,
  PluginListItem,
  PluginResourceRecord,
  PluginRuntimeManifest,
  PluginRuntimeStatus,
  PluginSettingsContribution,
  RuntimeDependencyRecord
} from '@shared/types/plugin'
import { CUA_PLUGIN_ID, OFFICIAL_PLUGIN_SOURCE } from '@shared/types/plugin'
import { registerPluginToolPolicy, unregisterPluginToolPolicies } from './toolPolicyStore'
import type {
  PluginRuntimeSafetyStore,
  PluginRuntimeSentinel,
  PluginRuntimeSupervisor
} from './runtimeSupervisor'
import { loadPluginToolCatalog, parsePluginToolCatalogJson } from './toolCatalog'
import type { McpSettings } from '@/mcp/settings'
import { CuaEmbeddedRuntimeAdapter } from './cuaEmbeddedAdapter'
import {
  CuaRuntimeIntegrityVerifier,
  parseCuaRuntimeIntegrityDescriptor,
  type CuaRuntimeIntegrityDescriptor
} from './cuaRuntimeIntegrity'

const execFileAsync = promisify(execFile)

const GITHUB_RELEASE_DOWNLOAD_PREFIX = 'https://github.com/ThinkInAIXYZ/deepchat/releases/download/'
const PLUGIN_PACKAGE_EXTENSION = '.dcplugin'
const CUA_RUNTIME_OWNERSHIP_MIGRATION = 'cua-runtime-ownership'
const CUA_RUNTIME_OWNERSHIP_MIGRATION_VERSION = 2
const MACOS_ACCESSIBILITY_SETTINGS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
const MACOS_SCREEN_CAPTURE_SETTINGS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

type PluginStoreShape = {
  installations: PluginInstallationRecord[]
  resources: PluginResourceRecord[]
  runtimes: RuntimeDependencyRecord[]
  migrations: Record<string, number>
  runtimeSentinels: Record<string, unknown>
}

type SkillContributionPort = Pick<
  SkillServicePort,
  'registerPluginSkill' | 'unregisterPluginSkillsByOwner'
>

export interface PluginSettingsWindowPort {
  open(input: { pluginId: string; title: string; entry: string }): Promise<void>
  close(pluginId: string): void
  closeAll(): void
}

type PluginServiceDeps = {
  mcpSettings: McpSettings
  mcpService: Pick<McpServicePort, 'isReady' | 'isServerRunning' | 'getServerLastError'> & {
    checkPluginRuntimePermissions(serverName: string): Promise<unknown>
    revokeMcpAppsByServer?(serverId: string): void
  }
  runtimeSupervisor: Pick<
    PluginRuntimeSupervisor,
    | 'registerServer'
    | 'attachSafetyStore'
    | 'commitPluginRegistration'
    | 'unregisterPlugin'
    | 'reconcilePlugin'
    | 'getState'
    | 'testRuntime'
    | 'retryRuntime'
  >
  skillService: SkillContributionPort
  settingsWindow: PluginSettingsWindowPort
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  appPath?: string
  isPackaged?: boolean
  resourcesPath?: string
}

type ResolvedOfficialPlugin = {
  manifest: DeepChatPluginManifest
  root: string
  sourcePath: string
  sourceType: 'directory' | 'package'
  integrityDescriptor?: CuaRuntimeIntegrityDescriptor
  integrityError?: string
}

type RuntimePermissionState = 'granted' | 'missing' | 'unknown'

type RuntimePermissionCheckResult = {
  platform: NodeJS.Platform
  accessibility: RuntimePermissionState
  screenRecording: RuntimePermissionState
  uia?: RuntimePermissionState
  postMessage?: RuntimePermissionState
  diagnostics?: Record<string, string | number | boolean | null>
  error?: string
  command?: string
  stdout?: string
  stderr?: string
}

export interface PluginServicePort {
  initialize(): Promise<void>
  shutdown(): Promise<void>
  listPlugins(): Promise<PluginListItem[]>
  getPlugin(pluginId: string): Promise<PluginListItem | undefined>
  enablePlugin(pluginId: string): Promise<PluginActionResult>
  disablePlugin(pluginId: string): Promise<PluginActionResult>
  invokeAction(pluginId: string, actionId: string, payload?: unknown): Promise<PluginActionResult>
}

export class PluginService implements PluginServicePort {
  private readonly mcpSettings: McpSettings
  private readonly mcpService: PluginServiceDeps['mcpService']
  private readonly skillService: SkillContributionPort
  private readonly settingsWindow: PluginSettingsWindowPort
  private readonly runtimeSupervisor: PluginServiceDeps['runtimeSupervisor']
  private readonly platform: NodeJS.Platform
  private readonly arch: NodeJS.Architecture
  private readonly appPath: string
  private readonly isPackaged: boolean
  private readonly resourcesPath: string
  private readonly store = new ElectronStore<PluginStoreShape>({
    name: 'plugin-settings',
    defaults: {
      installations: [],
      resources: [],
      runtimes: [],
      migrations: {},
      runtimeSentinels: {}
    }
  })
  private readonly runtimeSafetyStore: PluginRuntimeSafetyStore = {
    read: (key) => this.getRuntimeSentinelMap()[key],
    write: (key, sentinel) => {
      this.store.set('runtimeSentinels', {
        ...this.getRuntimeSentinelMap(),
        [key]: this.copyRuntimeSentinel(sentinel)
      })
    },
    remove: (key) => {
      const sentinels = this.getRuntimeSentinelMap()
      if (!(key in sentinels)) {
        return
      }
      const next = { ...sentinels }
      delete next[key]
      this.store.set('runtimeSentinels', next)
    }
  }
  private officialPlugins = new Map<string, ResolvedOfficialPlugin>()
  private readonly activationErrors = new Map<string, string>()

  constructor(deps: PluginServiceDeps) {
    this.mcpSettings = deps.mcpSettings
    this.mcpService = deps.mcpService
    this.skillService = deps.skillService
    this.settingsWindow = deps.settingsWindow
    this.runtimeSupervisor = deps.runtimeSupervisor
    this.platform = deps.platform ?? process.platform
    this.arch = deps.arch ?? process.arch
    this.appPath = deps.appPath ?? app.getAppPath()
    this.isPackaged = deps.isPackaged ?? app.isPackaged
    this.resourcesPath = deps.resourcesPath ?? process.resourcesPath ?? ''
    this.runtimeSupervisor.attachSafetyStore(this.runtimeSafetyStore)
  }

  async initialize(): Promise<void> {
    await this.loadOfficialPlugins()
    let cuaRuntimeMigrationFailed = false
    try {
      await this.applyRuntimeMigrations()
    } catch (error) {
      // Plugin-owned records are excluded from generic MCP autostart even when
      // this retryable cleanup fails. Keep CUA inactive for this launch so a
      // failed safe-side write cannot discard legacy disable intent, while
      // allowing unrelated plugins to initialize normally.
      cuaRuntimeMigrationFailed = true
      console.warn('[PluginHost] Runtime migration failed and will be retried:', error)
    }
    await this.repairMissingPluginResources()

    for (const installation of this.getInstallations()) {
      if (cuaRuntimeMigrationFailed && installation.pluginId === CUA_PLUGIN_ID) {
        console.warn('[PluginHost] Skipping CUA activation until its runtime migration succeeds')
        continue
      }
      if (installation.enabled) {
        try {
          await this.activatePlugin(installation.pluginId)
        } catch (error) {
          let cleanupError: unknown
          try {
            await this.disableByOwner(installation.pluginId)
          } catch (failedCleanup) {
            cleanupError = failedCleanup
          }
          console.warn('[PluginHost] Failed to activate installed plugin:', {
            pluginId: installation.pluginId,
            error,
            cleanupError
          })
        }
      }
    }
  }

  private async applyRuntimeMigrations(): Promise<void> {
    const migrations = this.store.get('migrations') ?? {}
    if (
      (migrations[CUA_RUNTIME_OWNERSHIP_MIGRATION] ?? 0) >= CUA_RUNTIME_OWNERSHIP_MIGRATION_VERSION
    ) {
      return
    }

    const servers = await this.mcpSettings.getMcpServers()
    const legacyCuaServer = servers['cua-driver']
    if (legacyCuaServer && this.isLegacyCuaServerConfig(legacyCuaServer)) {
      const installation = this.getInstallation(CUA_PLUGIN_ID)
      if (legacyCuaServer.enabled === false && installation?.enabled) {
        this.upsertInstallation({
          ...installation,
          enabled: false,
          updatedAt: Date.now()
        })
      }
      // A forced quit can leave the separately persisted policy behind. Clear
      // it before removing the legacy server; activation re-registers the
      // current policy later when installation intent remains enabled.
      unregisterPluginToolPolicies(CUA_PLUGIN_ID)
      await this.mcpSettings.removeMcpServer('cua-driver')
    }

    this.store.set('migrations', {
      ...migrations,
      [CUA_RUNTIME_OWNERSHIP_MIGRATION]: CUA_RUNTIME_OWNERSHIP_MIGRATION_VERSION
    })
  }

  async shutdown(): Promise<void> {
    const pluginIds = new Set(this.getInstallations().map((installation) => installation.pluginId))
    for (const pluginId of pluginIds) {
      unregisterPluginToolPolicies(pluginId)
    }

    this.settingsWindow.closeAll()
  }

  async listPlugins(): Promise<PluginListItem[]> {
    await this.loadOfficialPlugins()
    return await Promise.all(
      Array.from(this.officialPlugins.values()).map(async (plugin) => {
        return await this.buildPluginListItem(plugin.manifest.id)
      })
    )
  }

  async getPlugin(pluginId: string): Promise<PluginListItem | undefined> {
    await this.loadOfficialPlugins()
    if (!this.officialPlugins.has(pluginId)) {
      return undefined
    }
    return await this.buildPluginListItem(pluginId)
  }

  async enablePlugin(pluginId: string): Promise<PluginActionResult> {
    try {
      await this.loadOfficialPlugins()
      const plugin = this.getOfficialPluginOrThrow(pluginId)
      this.assertTrustedOfficialPlugin(plugin.manifest)
      this.assertPlatformSupported(plugin.manifest)
      const installation = this.ensureOfficialPluginInstallation(plugin)

      const nextInstallation: PluginInstallationRecord = {
        ...installation,
        enabled: true,
        updatedAt: Date.now()
      }
      this.upsertInstallation(nextInstallation)
      try {
        await this.activatePlugin(pluginId)
      } catch (error) {
        this.upsertInstallation({
          ...nextInstallation,
          enabled: false,
          updatedAt: Date.now()
        })
        try {
          await this.disableByOwner(pluginId)
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            `Plugin ${pluginId} activation failed and cleanup was incomplete`
          )
        }
        throw error
      }
      return { ok: true, status: await this.buildPluginListItem(pluginId) }
    } catch (error) {
      return this.errorResult(error)
    }
  }

  async disablePlugin(pluginId: string): Promise<PluginActionResult> {
    try {
      const installation = this.getInstallation(pluginId)
      if (!installation) {
        return { ok: true, status: await this.buildPluginListItem(pluginId) }
      }

      this.upsertInstallation({
        ...installation,
        enabled: false,
        updatedAt: Date.now()
      })
      this.activationErrors.delete(pluginId)
      await this.disableByOwner(pluginId)
      return { ok: true, status: await this.buildPluginListItem(pluginId) }
    } catch (error) {
      return this.errorResult(error)
    }
  }

  async invokeAction(
    pluginId: string,
    actionId: string,
    _payload?: unknown
  ): Promise<PluginActionResult> {
    try {
      if (actionId === 'settings.open') {
        await this.openPluginSettingsWindow(pluginId)
        return { ok: true }
      }

      switch (actionId) {
        case 'runtime.getStatus':
          return {
            ok: true,
            data: (await this.refreshRuntime(pluginId)) as unknown as PluginActionResult['data']
          }
        case 'runtime.checkPermissions':
          return {
            ok: true,
            data: (await this.checkRuntimePermissions(pluginId)) as PluginActionResult['data']
          }
        case 'runtime.test': {
          const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)
          if (!this.getInstallation(pluginId)?.enabled) {
            throw new Error(`Plugin ${pluginId} must be enabled before testing its runtime`)
          }
          const serverName = this.getRuntimeActionServerName(plugin)
          await this.runtimeSupervisor.testRuntime(pluginId, serverName)
          return { ok: true, status: await this.buildPluginListItem(pluginId) }
        }
        case 'runtime.retry': {
          const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)
          if (!this.getInstallation(pluginId)?.enabled) {
            throw new Error(`Plugin ${pluginId} must be enabled before retrying its runtime`)
          }
          const serverName = this.getRuntimeActionServerName(plugin)
          await this.runtimeSupervisor.retryRuntime(pluginId, serverName)
          return { ok: true, status: await this.buildPluginListItem(pluginId) }
        }
        case 'runtime.openPermissionGuide':
          await this.openRuntimeGuide(pluginId)
          return { ok: true }
        case 'runtime.openProject':
          await shell.openExternal('https://github.com/trycua/cua')
          return { ok: true }
        case 'runtime.uninstallHelper':
          return {
            ok: false,
            error:
              'Helper uninstall is not implemented for this runtime. Use the helper provider uninstall flow.'
          }
        case 'config.get': {
          const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)
          const configPath = path.join(plugin.root, 'config.json')
          if (!fs.existsSync(configPath)) {
            return { ok: true, data: {} }
          }
          const raw = fs.readFileSync(configPath, 'utf-8')
          return { ok: true, data: JSON.parse(raw) }
        }
        case 'config.set': {
          const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)
          const payload = (_payload ?? {}) as Record<string, unknown>
          const configPath = path.join(plugin.root, 'config.json')
          fs.writeFileSync(configPath, JSON.stringify(payload, null, 2), 'utf-8')
          return { ok: true }
        }
        default:
          throw new Error(`Unsupported plugin action: ${actionId}`)
      }
    } catch (error) {
      console.warn('[PluginHost] Plugin action failed:', {
        pluginId,
        actionId,
        error
      })
      return this.errorResult(error)
    }
  }

  private async activatePlugin(pluginId: string): Promise<void> {
    this.activationErrors.delete(pluginId)
    try {
      await this.activatePluginResources(pluginId)
    } catch (error) {
      this.activationErrors.set(pluginId, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  private getRuntimeActionServerName(plugin: ResolvedOfficialPlugin): string {
    const runtimeId = plugin.manifest.runtime?.id
    const server = runtimeId
      ? plugin.manifest.mcpServers?.find((candidate) => candidate.id === runtimeId)
      : undefined
    if (!runtimeId || !server) {
      throw new Error(`Plugin ${plugin.manifest.id} does not declare a matching runtime MCP server`)
    }
    if (server.startMode !== 'onDemand') {
      throw new Error(`Plugin runtime server "${server.id}" is not an on-demand runtime`)
    }
    return server.id
  }

  private async activatePluginResources(pluginId: string): Promise<void> {
    const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)
    this.assertTrustedOfficialPlugin(plugin.manifest)
    this.assertPlatformSupported(plugin.manifest)
    this.applyDeclaredExecutablePermissions(plugin.manifest, plugin.root)

    await this.disableByOwner(pluginId)

    let runtime: PluginRuntimeStatus | undefined
    if (plugin.manifest.runtime) {
      runtime = await this.refreshRuntime(pluginId)
      this.upsertResource({
        pluginId,
        kind: 'runtime',
        key: runtime.runtimeId,
        payload: this.toJsonPayload(runtime),
        enabled: true
      })
    }

    this.registerSettingsContributions(plugin)

    if (runtime && runtime.state !== 'installed' && runtime.state !== 'running') {
      return
    }

    const registeredServerNames = await this.registerMcpServers(plugin, runtime)
    await this.registerSkills(plugin)
    this.registerToolPolicies(plugin)
    this.runtimeSupervisor.commitPluginRegistration(plugin.manifest.id)
    if (registeredServerNames.length > 0 && this.mcpService.isReady()) {
      try {
        await this.runtimeSupervisor.reconcilePlugin(pluginId)
      } catch (error) {
        console.warn('[PluginHost] Failed to start eager plugin runtime:', {
          pluginId,
          error
        })
      }
    }
  }

  private async disableByOwner(pluginId: string): Promise<void> {
    let runtimeStopError: unknown
    try {
      await this.runtimeSupervisor.unregisterPlugin(pluginId)
    } catch (error) {
      runtimeStopError = error
      console.warn('[PluginHost] Failed to stop plugin-owned runtime during disable:', {
        pluginId,
        error
      })
    }

    const servers = await this.mcpSettings.getMcpServers()
    for (const [serverName, serverConfig] of Object.entries(servers)) {
      if (this.isServerOwnedByPlugin(serverConfig, pluginId)) {
        if (serverConfig.serverId) {
          this.mcpService.revokeMcpAppsByServer?.(serverConfig.serverId)
        }
        await this.mcpSettings.removeMcpServer(serverName)
      }
    }

    await this.skillService.unregisterPluginSkillsByOwner(pluginId)
    unregisterPluginToolPolicies(pluginId)
    this.settingsWindow.close(pluginId)
    this.removeResourceRecordsByOwner(pluginId)
    if (runtimeStopError) {
      throw runtimeStopError
    }
  }

  private isServerOwnedByPlugin(serverConfig: MCPServerConfig, pluginId: string): boolean {
    return (
      serverConfig.ownerPluginId === pluginId ||
      (serverConfig.source === 'plugin' && serverConfig.sourceId === pluginId)
    )
  }

  private isLegacyCuaServerConfig(serverConfig: MCPServerConfig): boolean {
    const environment = serverConfig.env ?? {}
    return (
      this.isServerOwnedByPlugin(serverConfig, CUA_PLUGIN_ID) &&
      (serverConfig.args?.includes('--no-daemon-relaunch') ||
        Object.hasOwn(environment, 'CUA_DRIVER_MCP_MODE') ||
        Object.hasOwn(environment, 'CUA_DRIVER_RS_MCP_NO_RELAUNCH'))
    )
  }

  private async removePersistedInstallation(pluginId: string): Promise<void> {
    await this.disableByOwner(pluginId)
    this.removeInstallationRecord(pluginId)
    this.removeRuntimeRecordsByOwner(pluginId)
  }

  private async registerMcpServers(
    plugin: ResolvedOfficialPlugin,
    runtime?: PluginRuntimeStatus
  ): Promise<string[]> {
    const servers = plugin.manifest.mcpServers ?? []
    const existingServers = await this.mcpSettings.getMcpServers()
    const registeredServerNames: string[] = []
    for (const server of servers) {
      const command = this.resolvePluginTemplate(server.command, plugin, runtime)
      const serverName = server.id
      const startMode = server.startMode ?? 'eager'
      const surfaces = server.surfaces ?? ['tools', 'prompts', 'resources']
      const toolCatalogPath = server.toolCatalog
        ? this.resolvePluginRelativePath(plugin.root, server.toolCatalog)
        : undefined
      if (toolCatalogPath && !fs.statSync(toolCatalogPath, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`Plugin MCP tool catalog is missing: ${server.toolCatalog}`)
      }
      const existing = existingServers[serverName]
      if (existing && existing.ownerPluginId !== plugin.manifest.id) {
        throw new Error(`MCP server "${serverName}" already exists and is not owned by this plugin`)
      }

      const cuaIntegrityVerifier =
        plugin.manifest.runtime?.adapter === 'cua-embedded-v1'
          ? this.createCuaRuntimeIntegrityVerifier(plugin, command)
          : undefined
      const verifiedToolCatalogJson =
        toolCatalogPath && cuaIntegrityVerifier
          ? await cuaIntegrityVerifier.verifyCatalog(toolCatalogPath)
          : undefined
      const toolCatalog = toolCatalogPath
        ? verifiedToolCatalogJson !== undefined
          ? parsePluginToolCatalogJson(verifiedToolCatalogJson, toolCatalogPath)
          : loadPluginToolCatalog(toolCatalogPath)
        : undefined
      const serverEnv = this.resolvePluginTemplateRecord(server.env ?? {}, plugin, runtime)
      const config: MCPServerConfig = {
        type: 'stdio',
        command,
        args: server.args.map((arg) => this.resolvePluginTemplate(arg, plugin, runtime)),
        env: {
          ...serverEnv,
          DEEPCHAT_PLUGIN_ID: plugin.manifest.id
        },
        descriptions: server.displayName,
        icons: 'plugin',
        enabled: false,
        disable: false,
        source: 'plugin',
        sourceId: plugin.manifest.id,
        ownerPluginId: plugin.manifest.id,
        inheritEnv: server.inheritEnv ?? 'legacy'
      }
      const adapter =
        plugin.manifest.runtime?.adapter === 'cua-embedded-v1'
          ? new CuaEmbeddedRuntimeAdapter({
              binaryPath: command,
              platform: this.platform,
              contract: plugin.manifest.runtime.adapterContract!,
              environment: Object.fromEntries(
                Object.entries(config.env).map(([key, value]) => [key, String(value)])
              )
            })
          : undefined
      const launchGuard =
        plugin.manifest.runtime?.adapter === 'cua-embedded-v1' ? cuaIntegrityVerifier : undefined

      this.runtimeSupervisor.registerServer(
        {
          pluginId: plugin.manifest.id,
          serverName,
          displayName: server.displayName,
          runtimeId: runtime?.runtimeId,
          startMode,
          surfaces,
          toolCatalogPath,
          toolCatalog,
          adapter,
          launchGuard
        },
        { ready: false }
      )

      if (existing) {
        if (existing.serverId) {
          this.mcpService.revokeMcpAppsByServer?.(existing.serverId)
        }
        await this.mcpSettings.updateMcpServer(serverName, config)
      } else {
        await this.mcpSettings.addMcpServer(serverName, config)
      }

      this.upsertResource({
        pluginId: plugin.manifest.id,
        kind: 'mcpServer',
        key: serverName,
        payload: this.toJsonPayload(config),
        enabled: true
      })
      registeredServerNames.push(serverName)
    }
    return registeredServerNames
  }

  private createCuaRuntimeIntegrityVerifier(
    plugin: ResolvedOfficialPlugin,
    binaryPath: string
  ): CuaRuntimeIntegrityVerifier {
    if (plugin.integrityError) {
      throw new Error(
        `CUA runtime integrity descriptor is unavailable: ${plugin.integrityError}. Reinstall DeepChat or the CUA plugin.`
      )
    }
    const descriptor = plugin.integrityDescriptor
    const runtime = plugin.manifest.runtime
    if (!descriptor || !runtime?.adapterContract) {
      throw new Error(
        'CUA runtime integrity descriptor is missing. Reinstall DeepChat or the CUA plugin.'
      )
    }
    const descriptorPath = runtime.integrityDescriptor!
    const expectedRuntimeRoot = path.posix.dirname(descriptorPath.replaceAll('\\', '/'))
    if (descriptor.runtimeRoot !== expectedRuntimeRoot) {
      throw new Error(
        `CUA runtime integrity root mismatch: expected ${expectedRuntimeRoot}, received ${descriptor.runtimeRoot}`
      )
    }
    const appHelperCandidate = runtime.detect.find((candidate) =>
      candidate.startsWith('app-helper:')
    )
    const externalBinaryPath = appHelperCandidate
      ? (this.resolveRuntimeCandidate(appHelperCandidate, plugin.root) ?? undefined)
      : undefined
    return new CuaRuntimeIntegrityVerifier({
      pluginRoot: plugin.root,
      binaryPath,
      externalBinaryPath,
      platform: this.platform,
      arch: this.arch,
      runtimeVersion: runtime.adapterContract.driverVersion,
      descriptor
    })
  }

  private async registerSkills(plugin: ResolvedOfficialPlugin): Promise<void> {
    for (const skill of plugin.manifest.skills ?? []) {
      const skillPath = this.resolvePluginRelativePath(plugin.root, skill.path)
      const skillRoot = path.dirname(skillPath)
      if (!fs.existsSync(skillPath)) {
        throw new Error(`Plugin skill file is missing: ${skill.path}`)
      }

      await this.skillService.registerPluginSkill({
        ownerPluginId: plugin.manifest.id,
        id: skill.id,
        skillRoot,
        pluginRoot: plugin.root
      })
      this.upsertResource({
        pluginId: plugin.manifest.id,
        kind: 'skill',
        key: skill.id,
        payload: { path: skillPath },
        enabled: true
      })
    }
  }

  private registerSettingsContributions(plugin: ResolvedOfficialPlugin): void {
    for (const contribution of plugin.manifest.settingsContributions ?? []) {
      const entry = this.resolvePluginRelativePath(plugin.root, contribution.entry)
      const preloadTypes = this.resolvePluginRelativePath(plugin.root, contribution.preloadTypes)
      if (!fs.existsSync(entry)) {
        throw new Error(`Plugin settings entry is missing: ${contribution.entry}`)
      }
      if (!fs.existsSync(preloadTypes)) {
        throw new Error(`Plugin preload types are missing: ${contribution.preloadTypes}`)
      }
      const settings: PluginSettingsContribution = {
        id: contribution.id,
        ownerPluginId: plugin.manifest.id,
        title: contribution.title,
        placement: contribution.placement,
        entry,
        preloadTypes
      }
      this.upsertResource({
        pluginId: plugin.manifest.id,
        kind: 'settings',
        key: contribution.id,
        payload: this.toJsonPayload(settings),
        enabled: true
      })
    }
  }

  private async openPluginSettingsWindow(pluginId: string): Promise<void> {
    const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)

    const settings = this.getSettingsContribution(pluginId)
    if (!settings) {
      throw new Error(`Plugin ${pluginId} does not provide a settings contribution`)
    }

    await this.settingsWindow.open({
      pluginId,
      title: plugin.manifest.name,
      entry: settings.entry
    })
  }

  private registerToolPolicies(plugin: ResolvedOfficialPlugin): void {
    for (const policy of plugin.manifest.toolPolicies ?? []) {
      registerPluginToolPolicy({
        pluginId: plugin.manifest.id,
        serverId: policy.serverId,
        tools: policy.tools,
        enabled: true
      })
      this.upsertResource({
        pluginId: plugin.manifest.id,
        kind: 'toolPolicy',
        key: policy.serverId,
        payload: this.toJsonPayload(policy.tools),
        enabled: true
      })
    }
  }

  private async refreshRuntime(pluginId: string): Promise<PluginRuntimeStatus> {
    const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)
    const runtimeManifest = plugin.manifest.runtime
    if (!runtimeManifest) {
      throw new Error(`Plugin ${pluginId} does not declare a runtime`)
    }
    if (pluginId === CUA_PLUGIN_ID && runtimeManifest.adapter !== 'cua-embedded-v1') {
      throw new Error(
        'The installed CUA runtime uses an unsupported legacy lifecycle. Repair or reinstall DeepChat before enabling Computer Use.'
      )
    }

    const status = await this.detectRuntime(runtimeManifest, plugin.root)
    this.upsertRuntimeRecord({
      pluginId,
      runtimeId: runtimeManifest.id,
      provider: runtimeManifest.install?.provider ?? plugin.manifest.publisher,
      command: status.command,
      helperAppPath: status.helperAppPath,
      version: status.version,
      installSource: runtimeManifest.install?.strategy,
      state: status.state,
      lastError: status.lastError,
      checkedAt: status.checkedAt ?? Date.now()
    })
    return status
  }

  private async detectRuntime(
    runtime: PluginRuntimeManifest,
    pluginRoot: string
  ): Promise<PluginRuntimeStatus> {
    const checkedAt = Date.now()
    for (const candidate of runtime.detect) {
      const command = this.resolveRuntimeCandidate(candidate, pluginRoot)
      if (!command) {
        continue
      }

      if (path.isAbsolute(command) && !fs.existsSync(command)) {
        continue
      }

      if (runtime.adapter === 'cua-embedded-v1') {
        if (!path.isAbsolute(command)) {
          continue
        }
        const stat = fs.lstatSync(command, { throwIfNoEntry: false })
        const helperAppPath = this.resolveHelperAppPath(command)
        if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
          return {
            runtimeId: runtime.id,
            displayName: runtime.displayName,
            state: 'error',
            command,
            helperAppPath,
            lastError: `CUA runtime candidate must be a regular file: ${command}`,
            checkedAt
          }
        }
        return {
          runtimeId: runtime.id,
          displayName: runtime.displayName,
          state: 'installed',
          command,
          helperAppPath,
          version: runtime.adapterContract?.driverVersion,
          checkedAt
        }
      }

      try {
        const { stdout } = await execFileAsync(command, ['--version'], {
          timeout: 5000,
          windowsHide: true
        })
        const helperAppPath = this.resolveHelperAppPath(command)
        return {
          runtimeId: runtime.id,
          displayName: runtime.displayName,
          state: 'installed',
          command,
          helperAppPath,
          version: stdout.trim() || undefined,
          checkedAt
        }
      } catch (error) {
        if (path.isAbsolute(command)) {
          const helperAppPath = this.resolveHelperAppPath(command)
          return {
            runtimeId: runtime.id,
            displayName: runtime.displayName,
            state: 'error',
            command,
            helperAppPath,
            lastError: error instanceof Error ? error.message : String(error),
            checkedAt
          }
        }
      }
    }

    return {
      runtimeId: runtime.id,
      displayName: runtime.displayName,
      state: 'missing',
      checkedAt
    }
  }

  private async checkRuntimePermissions(pluginId: string): Promise<RuntimePermissionCheckResult> {
    const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)
    const runtime = await this.refreshRuntime(pluginId)
    if (!runtime.command) {
      console.warn('[PluginHost] Runtime permission check skipped because runtime is missing:', {
        pluginId,
        runtimeId: runtime.runtimeId,
        state: runtime.state,
        lastError: runtime.lastError
      })
      return {
        platform: this.platform,
        accessibility: 'unknown',
        screenRecording: 'unknown',
        error: runtime.lastError || 'Runtime is missing'
      }
    }

    if (plugin.manifest.runtime?.adapter === 'cua-embedded-v1') {
      try {
        const response = await this.mcpService.checkPluginRuntimePermissions(
          plugin.manifest.runtime.id
        )
        return this.parseRuntimePermissionMcpResult(runtime.command, response)
      } catch (error) {
        console.warn('[PluginHost] Supervised runtime permission check failed:', {
          pluginId,
          runtimeId: runtime.runtimeId,
          error
        })
        return {
          platform: this.platform,
          accessibility: 'unknown',
          screenRecording: 'unknown',
          command: runtime.command,
          error: `Permission check failed. ${this.describeError(error)}`
        }
      }
    }

    return await this.runRuntimePermissionTool(pluginId, runtime.command)
  }

  private parseRuntimePermissionMcpResult(
    command: string,
    response: unknown
  ): RuntimePermissionCheckResult {
    const record =
      response && typeof response === 'object' && !Array.isArray(response)
        ? (response as Record<string, unknown>)
        : {}
    const structured =
      record.structuredContent &&
      typeof record.structuredContent === 'object' &&
      !Array.isArray(record.structuredContent)
        ? (record.structuredContent as Record<string, unknown>)
        : undefined
    if (structured) {
      return this.parseRuntimePermissionToolResult(command, JSON.stringify(structured), '')
    }

    const content = Array.isArray(record.content)
      ? record.content
          .map((item) =>
            item &&
            typeof item === 'object' &&
            'text' in item &&
            typeof (item as { text?: unknown }).text === 'string'
              ? String((item as { text: string }).text)
              : ''
          )
          .filter(Boolean)
          .join('\n')
      : ''
    return this.parseRuntimePermissionToolResult(command, content, '')
  }

  private async runRuntimePermissionTool(
    pluginId: string,
    command: string
  ): Promise<RuntimePermissionCheckResult> {
    try {
      const { stdout, stderr } = await execFileAsync(command, this.runtimePermissionToolArgs(), {
        timeout: 10000,
        windowsHide: true
      })
      return this.parseRuntimePermissionToolResult(command, stdout, stderr)
    } catch (error) {
      console.warn('[PluginHost] Runtime permission fallback failed:', {
        pluginId,
        command,
        error
      })
      const stdout = this.extractRawExecOutput(error, 'stdout')
      const stderr = this.extractRawExecOutput(error, 'stderr')
      const parsed = this.parseRuntimePermissionToolResult(command, stdout, stderr)
      if (this.hasPermissionSignal(parsed)) {
        parsed.error = `Permission check returned a non-zero status. ${this.describeExecError(error)}`
        return parsed
      }
      return {
        platform: this.platform,
        accessibility: 'unknown',
        screenRecording: 'unknown',
        command,
        error: `Permission check failed. ${this.describeExecError(error)}`,
        stdout: this.extractExecOutput(error, 'stdout'),
        stderr: this.extractExecOutput(error, 'stderr')
      }
    }
  }

  private runtimePermissionToolArgs(): string[] {
    return ['check_permissions', JSON.stringify({ prompt: false })]
  }

  private parseRuntimePermissionToolResult(
    command: string,
    stdout: string,
    stderr: string
  ): RuntimePermissionCheckResult {
    const parsed =
      this.parsePermissionJson(stdout) ?? this.parsePermissionJson(`${stdout}\n${stderr}`)
    const result: RuntimePermissionCheckResult = {
      platform: this.platform,
      accessibility: 'unknown',
      screenRecording: 'unknown',
      command,
      stdout: this.truncateOutput(stdout),
      stderr: this.truncateOutput(stderr)
    }

    if (this.platform === 'win32' && parsed) {
      result.uia = this.toPermissionState(parsed.uia)
      result.postMessage = this.toPermissionState(parsed.post_message ?? parsed.postMessage)
      result.diagnostics = this.toRuntimePermissionDiagnostics(parsed)
      return result
    }

    if (this.platform === 'darwin' && parsed) {
      result.accessibility = this.toPermissionState(parsed.accessibility)
      result.screenRecording = this.toPermissionState(
        parsed.screen_recording ?? parsed.screenRecording
      )
      result.diagnostics = this.toRuntimePermissionDiagnostics(parsed)
      return result
    }

    const output = `${stdout}\n${stderr}`
    result.accessibility = this.parsePermissionState(output, 'Accessibility')
    result.screenRecording = this.parsePermissionState(output, 'Screen Recording')

    if (this.platform === 'linux' && parsed) {
      result.diagnostics = this.toRuntimePermissionDiagnostics(parsed)
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        result.error = parsed.error.trim()
      }
    }

    return result
  }

  private hasPermissionSignal(result: RuntimePermissionCheckResult): boolean {
    return (
      result.accessibility !== 'unknown' ||
      result.screenRecording !== 'unknown' ||
      result.uia !== undefined ||
      result.postMessage !== undefined
    )
  }

  private parsePermissionJson(output: string): Record<string, unknown> | undefined {
    const trimmed = output.trim()
    if (!trimmed) {
      return undefined
    }
    try {
      const parsed = JSON.parse(trimmed)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined
    } catch {
      return undefined
    }
  }

  private toRuntimePermissionDiagnostics(
    value: Record<string, unknown>
  ): Record<string, string | number | boolean | null> {
    const diagnostics: Record<string, string | number | boolean | null> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (
        typeof entry === 'string' ||
        typeof entry === 'number' ||
        typeof entry === 'boolean' ||
        entry === null
      ) {
        diagnostics[key] = entry
      }
    }
    return diagnostics
  }

  private toPermissionState(value: unknown): RuntimePermissionState {
    if (value === true) {
      return 'granted'
    }
    if (value === false) {
      return 'missing'
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (['granted', 'ok', 'true', 'available', 'enabled', 'yes'].includes(normalized)) {
        return 'granted'
      }
      if (
        ['missing', 'denied', 'deny', 'false', 'unavailable', 'disabled', 'no'].includes(normalized)
      ) {
        return 'missing'
      }
    }
    return 'unknown'
  }

  private describeError(error: unknown): string {
    return this.sanitizePermissionError(error instanceof Error ? error.message : String(error))
  }

  private describeExecError(error: unknown): string {
    const message = this.describeError(error)
    const stdout = this.extractExecOutput(error, 'stdout')
    const stderr = this.extractExecOutput(error, 'stderr')
    const parts = [message]
    if (stdout) {
      parts.push(`stdout: ${stdout}`)
    }
    if (stderr) {
      parts.push(`stderr: ${stderr}`)
    }
    return parts.join(' | ')
  }

  private extractExecOutput(error: unknown, key: 'stdout' | 'stderr'): string | undefined {
    const value = this.extractRawExecOutput(error, key)
    if (!value.trim()) {
      return undefined
    }
    return this.truncateOutput(value)
  }

  private extractRawExecOutput(error: unknown, key: 'stdout' | 'stderr'): string {
    if (!error || typeof error !== 'object') {
      return ''
    }
    const value = (error as { stdout?: unknown; stderr?: unknown })[key]
    if (typeof value !== 'string' || !value.trim()) {
      return ''
    }
    return this.sanitizePermissionError(value)
  }

  private truncateOutput(value: string): string {
    const normalized = this.sanitizePermissionError(value).trim()
    return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized
  }

  private sanitizePermissionError(value: string): string {
    return value.replace(/\s*hint:\s*PowerShell 5\.1[\s\S]*?(?=(?:\sFallback:|$))/i, ' ').trim()
  }

  private parsePermissionState(output: string, label: string): 'granted' | 'missing' | 'unknown' {
    const line = output
      .split(/\r?\n/)
      .find((candidate) => candidate.toLowerCase().includes(label.toLowerCase()))
    if (!line) {
      return 'unknown'
    }
    if (/not granted|missing|denied/i.test(line)) {
      return 'missing'
    }
    if (/granted/i.test(line)) {
      return 'granted'
    }
    return 'unknown'
  }

  private async openRuntimeGuide(pluginId: string): Promise<void> {
    const plugin = this.getInstalledOrOfficialPluginOrThrow(pluginId)
    let helperOpenError: string | undefined

    if (this.platform === 'darwin' && plugin.manifest.runtime?.adapter === 'cua-embedded-v1') {
      const permissions = await this.checkRuntimePermissions(pluginId)
      const settingsUrl =
        permissions.accessibility === 'granted'
          ? MACOS_SCREEN_CAPTURE_SETTINGS
          : MACOS_ACCESSIBILITY_SETTINGS
      await shell.openExternal(settingsUrl)
      return
    }

    if (this.platform === 'darwin' && plugin.manifest.runtime) {
      try {
        const runtime = await this.refreshRuntime(pluginId)
        if (runtime.helperAppPath) {
          const openError = await shell.openPath(runtime.helperAppPath)
          if (!openError) {
            return
          }
          helperOpenError = openError
          console.warn('[PluginHost] Runtime helper permission guide failed to open:', {
            pluginId,
            helperAppPath: runtime.helperAppPath,
            error: openError
          })
        }
      } catch (error) {
        helperOpenError = this.describeError(error)
        console.warn('[PluginHost] Runtime helper permission guide unavailable:', {
          pluginId,
          error
        })
      }
    }

    const guideUrl = plugin.manifest.runtime?.install?.guideUrl?.trim()
    if (!guideUrl) {
      if (helperOpenError) {
        throw new Error(
          `Failed to open runtime helper and plugin ${pluginId} does not declare a runtime guide URL. Helper: ${helperOpenError}`
        )
      }
      throw new Error(`Plugin ${pluginId} does not declare a runtime guide URL`)
    }
    await shell.openExternal(guideUrl)
  }

  private async loadOfficialPlugins(): Promise<void> {
    this.officialPlugins.clear()
    const packages = this.resolveOfficialPluginPackages()
    const directories = this.resolveOfficialPluginDirectories()
    const installRoot = path.resolve(this.getPluginInstallRoot())
    const installedDirectories = directories.filter((plugin) => {
      const relativePath = path.relative(installRoot, path.resolve(plugin.root))
      return (
        relativePath === '' ||
        (relativePath !== '..' &&
          !relativePath.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relativePath))
      )
    })
    const sourceDirectories = directories.filter((plugin) => !installedDirectories.includes(plugin))
    const plugins = this.isPackaged
      ? [...packages, ...installedDirectories]
      : [...sourceDirectories, ...packages, ...installedDirectories]
    const usablePluginIds = new Set<string>()

    for (const plugin of plugins) {
      if (!this.isPluginPlatformSupported(plugin.manifest)) {
        continue
      }
      try {
        this.assertTrustedOfficialPlugin(plugin.manifest)
        usablePluginIds.add(plugin.manifest.id)
      } catch {
        // The main discovery pass logs untrusted plugin details and performs cleanup.
      }
    }

    for (const plugin of plugins) {
      if (this.officialPlugins.has(plugin.manifest.id)) {
        continue
      }
      if (!this.isPluginPlatformSupported(plugin.manifest)) {
        console.info(`[PluginHost] Skipping plugin ${plugin.manifest.id}: platform not supported`)
        if (!usablePluginIds.has(plugin.manifest.id)) {
          await this.removePersistedInstallation(plugin.manifest.id)
        }
        continue
      }
      try {
        this.assertTrustedOfficialPlugin(plugin.manifest)
      } catch (error) {
        console.warn(`[PluginHost] Skipping untrusted plugin ${plugin.manifest.id}:`, error)
        if (!usablePluginIds.has(plugin.manifest.id)) {
          await this.removePersistedInstallation(plugin.manifest.id)
        }
        continue
      }
      console.info(`[PluginHost] Discovered plugin: ${plugin.manifest.id} at ${plugin.root}`)
      this.officialPlugins.set(plugin.manifest.id, plugin)
    }
  }

  private resolveOfficialPluginDirectories(): ResolvedOfficialPlugin[] {
    const sourceRoots = this.isPackaged
      ? [this.getPluginInstallRoot()]
      : [
          path.join(process.cwd(), 'plugins'),
          path.join(this.appPath, 'plugins'),
          this.getPluginInstallRoot()
        ]
    const pluginRoots = new Set<string>()

    for (const sourceRoot of sourceRoots) {
      if (!sourceRoot || !fs.existsSync(sourceRoot)) {
        continue
      }

      if (fs.existsSync(path.join(sourceRoot, 'plugin.json'))) {
        pluginRoots.add(sourceRoot)
        continue
      }

      for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue
        }
        const candidate = path.join(sourceRoot, entry.name)
        if (fs.existsSync(path.join(candidate, 'plugin.json'))) {
          pluginRoots.add(candidate)
        }
      }
    }

    return Array.from(pluginRoots).map((root) => {
      const manifest = this.readManifest(path.join(root, 'plugin.json'))
      const integrity = this.isPackaged ? {} : this.readDirectoryRuntimeIntegrity(manifest, root)
      return {
        manifest,
        root,
        sourcePath: root,
        sourceType: 'directory',
        ...integrity
      }
    })
  }

  private resolveOfficialPluginPackages(): ResolvedOfficialPlugin[] {
    const resourceRoots = this.resourcesPath
      ? [
          path.join(this.resourcesPath, 'app.asar.unpacked', 'plugins'),
          path.join(this.resourcesPath, 'plugins')
        ]
      : []
    const packageRoots = this.isPackaged
      ? resourceRoots
      : [
          path.join(process.cwd(), 'build', 'bundled-plugins'),
          path.join(this.appPath, 'build', 'bundled-plugins'),
          path.join(this.appPath, 'plugins'),
          ...resourceRoots
        ]
    const packagePaths = new Set<string>()

    for (const packageRoot of packageRoots) {
      if (!packageRoot || !fs.existsSync(packageRoot)) {
        continue
      }

      for (const entry of fs.readdirSync(packageRoot, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(PLUGIN_PACKAGE_EXTENSION)) {
          packagePaths.add(path.join(packageRoot, entry.name))
        }
      }
    }

    return Array.from(packagePaths).map((packagePath) => {
      const packageMetadata = this.readPackageMetadata(packagePath)
      return {
        ...packageMetadata,
        root: packagePath,
        sourcePath: packagePath,
        sourceType: 'package'
      }
    })
  }

  private readManifest(manifestPath: string): DeepChatPluginManifest {
    const parsed = this.hydrateManifestPlaceholders(
      JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as DeepChatPluginManifest
    )
    if (!parsed.id || !parsed.name || !parsed.version || !parsed.source) {
      throw new Error(`Invalid plugin manifest: ${manifestPath}`)
    }
    this.assertManifestLifecycleContract(parsed)
    return parsed
  }

  private readPackageMetadata(
    packagePath: string
  ): Pick<ResolvedOfficialPlugin, 'manifest' | 'integrityDescriptor' | 'integrityError'> {
    const files = this.readPluginPackage(packagePath)
    const manifestFile = files['plugin.json']
    if (!manifestFile) {
      throw new Error(`Plugin package is missing plugin.json: ${packagePath}`)
    }
    const manifest = this.hydrateManifestPlaceholders(
      JSON.parse(Buffer.from(manifestFile).toString('utf8')) as DeepChatPluginManifest
    )
    if (!manifest.id || !manifest.name || !manifest.version || !manifest.source) {
      throw new Error(`Invalid plugin package manifest: ${packagePath}`)
    }
    this.assertManifestLifecycleContract(manifest)
    const integrity = this.readPackagedRuntimeIntegrity(manifest, packagePath, files)
    return { manifest, ...integrity }
  }

  private readPackagedRuntimeIntegrity(
    manifest: DeepChatPluginManifest,
    packagePath: string,
    files: Record<string, Uint8Array>
  ): Pick<ResolvedOfficialPlugin, 'integrityDescriptor' | 'integrityError'> {
    const descriptorPath =
      manifest.runtime?.adapter === 'cua-embedded-v1'
        ? manifest.runtime.integrityDescriptor
        : undefined
    if (!descriptorPath) {
      return {}
    }
    try {
      const descriptorFile = files[descriptorPath]
      if (!descriptorFile) {
        throw new Error(`package is missing ${descriptorPath}`)
      }
      const descriptor = parseCuaRuntimeIntegrityDescriptor(
        JSON.parse(Buffer.from(descriptorFile).toString('utf8')) as unknown,
        `${packagePath}:${descriptorPath}`
      )
      return { integrityDescriptor: descriptor }
    } catch (error) {
      return {
        integrityError: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private readDirectoryRuntimeIntegrity(
    manifest: DeepChatPluginManifest,
    pluginRoot: string
  ): Pick<ResolvedOfficialPlugin, 'integrityDescriptor' | 'integrityError'> {
    const descriptorPath =
      manifest.runtime?.adapter === 'cua-embedded-v1'
        ? manifest.runtime.integrityDescriptor
        : undefined
    if (!descriptorPath) {
      return {}
    }
    try {
      const absolutePath = this.resolvePluginRelativePath(pluginRoot, descriptorPath)
      const descriptor = parseCuaRuntimeIntegrityDescriptor(
        JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as unknown,
        absolutePath
      )
      return { integrityDescriptor: descriptor }
    } catch (error) {
      return {
        integrityError: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private assertManifestLifecycleContract(manifest: DeepChatPluginManifest): void {
    if (manifest.id !== manifest.id.trim()) {
      throw new Error(`Plugin manifest id must not contain surrounding whitespace: ${manifest.id}`)
    }
    if (manifest.runtime?.adapter && manifest.runtime.adapter !== 'cua-embedded-v1') {
      throw new Error(
        `Plugin ${manifest.id} declares unsupported runtime adapter: ${manifest.runtime.adapter}`
      )
    }
    if (manifest.runtime?.adapterContract && !manifest.runtime.adapter) {
      throw new Error(
        `Plugin ${manifest.id} declares an adapter contract without a runtime adapter`
      )
    }
    if (manifest.runtime?.adapter === 'cua-embedded-v1') {
      if (manifest.id !== CUA_PLUGIN_ID) {
        throw new Error(`Runtime adapter cua-embedded-v1 is reserved for ${CUA_PLUGIN_ID}`)
      }
      const contract = manifest.runtime.adapterContract
      const contractFields = [
        'hostBundleId',
        'driverVersion',
        'contractVersion',
        'toolsListSchemaVersion',
        'capabilityVersion',
        'mcpProtocolVersion'
      ] as const
      if (
        !contract ||
        contractFields.some(
          (field) =>
            typeof contract[field] !== 'string' ||
            !contract[field].trim() ||
            contract[field] !== contract[field].trim()
        )
      ) {
        throw new Error(`Plugin ${manifest.id} has an invalid cua-embedded-v1 adapter contract`)
      }
      const adapterServers = manifest.mcpServers ?? []
      if (
        adapterServers.length !== 1 ||
        adapterServers[0].id !== manifest.runtime.id ||
        adapterServers[0].startMode !== 'onDemand' ||
        adapterServers[0].inheritEnv !== 'minimal'
      ) {
        throw new Error(
          `Plugin ${manifest.id} cua-embedded-v1 requires one matching on-demand MCP server with minimal environment inheritance`
        )
      }
      if (
        typeof manifest.runtime.integrityDescriptor !== 'string' ||
        !manifest.runtime.integrityDescriptor
      ) {
        throw new Error(`Plugin ${manifest.id} cua-embedded-v1 requires an integrity descriptor`)
      }
      this.assertSafeRelativePath(
        manifest.runtime.integrityDescriptor,
        'plugin runtime integrity descriptor path'
      )
    }

    if (manifest.mcpServers !== undefined && !Array.isArray(manifest.mcpServers)) {
      throw new Error(`Plugin ${manifest.id} has invalid mcpServers`)
    }

    const validSurfaces = new Set(['tools', 'prompts', 'resources'])
    const serverIds = new Set<string>()
    for (const server of manifest.mcpServers ?? []) {
      if (
        !server ||
        typeof server !== 'object' ||
        typeof server.id !== 'string' ||
        !server.id.trim() ||
        server.id !== server.id.trim()
      ) {
        throw new Error(`Plugin ${manifest.id} has an MCP server with an invalid id`)
      }
      if (serverIds.has(server.id)) {
        throw new Error(`Plugin ${manifest.id} declares duplicate MCP server id: ${server.id}`)
      }
      serverIds.add(server.id)

      const startMode = server.startMode ?? 'eager'
      if (startMode !== 'eager' && startMode !== 'onDemand') {
        throw new Error(
          `Plugin ${manifest.id} MCP server ${server.id} has invalid startMode: ${startMode}`
        )
      }
      if (server.inheritEnv && server.inheritEnv !== 'legacy' && server.inheritEnv !== 'minimal') {
        throw new Error(
          `Plugin ${manifest.id} MCP server ${server.id} has invalid inheritEnv: ${server.inheritEnv}`
        )
      }

      const surfaces = server.surfaces ?? ['tools', 'prompts', 'resources']
      if (
        !Array.isArray(surfaces) ||
        surfaces.length === 0 ||
        new Set(surfaces).size !== surfaces.length ||
        surfaces.some((surface) => typeof surface !== 'string' || !validSurfaces.has(surface))
      ) {
        throw new Error(`Plugin ${manifest.id} MCP server ${server.id} has invalid surfaces`)
      }
      if (server.toolCatalog !== undefined && typeof server.toolCatalog !== 'string') {
        throw new Error(`Plugin ${manifest.id} MCP server ${server.id} has invalid toolCatalog`)
      }
      if (server.toolCatalog) {
        this.assertSafeRelativePath(server.toolCatalog, 'plugin MCP tool catalog path')
      }
      if (
        startMode === 'onDemand' &&
        (surfaces.length !== 1 || surfaces[0] !== 'tools' || !server.toolCatalog)
      ) {
        throw new Error(
          `Plugin ${manifest.id} MCP server ${server.id} must declare surfaces ["tools"] and a toolCatalog for on-demand startup`
        )
      }
    }
  }

  private readPluginPackage(packagePath: string): Record<string, Uint8Array> {
    const files = unzipSync(new Uint8Array(fs.readFileSync(packagePath)))
    this.verifyPackageChecksums(packagePath, files)
    return files
  }

  private verifyPackageChecksums(packagePath: string, files: Record<string, Uint8Array>): void {
    const checksumFile = files['checksums.json']
    if (!checksumFile) {
      throw new Error(`Plugin package is missing checksums.json: ${packagePath}`)
    }

    const checksums = JSON.parse(Buffer.from(checksumFile).toString('utf8')) as Record<
      string,
      string
    >
    for (const [relativePath, expectedHash] of Object.entries(checksums)) {
      this.assertSafeRelativePath(relativePath, 'package checksum path')
      const content = files[relativePath]
      if (!content) {
        throw new Error(`Plugin package checksum references a missing file: ${relativePath}`)
      }
      const actualHash = createHash('sha256').update(Buffer.from(content)).digest('hex')
      if (actualHash !== expectedHash) {
        throw new Error(`Plugin package checksum mismatch: ${relativePath}`)
      }
    }

    for (const relativePath of Object.keys(files)) {
      if (relativePath === 'checksums.json' || relativePath.endsWith('/')) {
        continue
      }
      this.assertSafeRelativePath(relativePath, 'package file path')
      if (!checksums[relativePath]) {
        throw new Error(`Plugin package file is missing checksum: ${relativePath}`)
      }
    }
  }

  private assertTrustedOfficialPlugin(manifest: DeepChatPluginManifest): void {
    if (manifest.source.type !== OFFICIAL_PLUGIN_SOURCE) {
      throw new Error(`Plugin ${manifest.id} is not from the official source`)
    }
    if (
      !manifest.source.url.startsWith(GITHUB_RELEASE_DOWNLOAD_PREFIX) &&
      !manifest.source.url.startsWith('${github.release.download}/')
    ) {
      throw new Error(`Plugin ${manifest.id} has an untrusted source URL`)
    }
    if (manifest.source.publisher !== manifest.publisher) {
      throw new Error(`Plugin ${manifest.id} publisher does not match source metadata`)
    }
  }

  private ensureOfficialPluginInstallation(
    plugin: ResolvedOfficialPlugin
  ): PluginInstallationRecord {
    const pluginId = plugin.manifest.id
    const existing = this.getInstallation(pluginId)
    const existingManifestPath = existing?.path
      ? path.join(existing.path, 'plugin.json')
      : undefined
    if (existing && existingManifestPath && fs.existsSync(existingManifestPath)) {
      const existingManifest = this.readManifest(existingManifestPath)
      const shouldRefreshDirectoryInstallation =
        plugin.sourceType === 'directory' &&
        path.resolve(plugin.sourcePath) !== path.resolve(existing.path)
      if (
        !shouldRefreshDirectoryInstallation &&
        existingManifest.version === plugin.manifest.version &&
        this.arePluginManifestsEquivalent(existingManifest, plugin.manifest)
      ) {
        this.assertTrustedOfficialPlugin(existingManifest)
        this.assertPlatformSupported(existingManifest)
        this.applyDeclaredExecutablePermissions(existingManifest, existing.path)
        return existing
      }
    }

    const installRoot = this.installResolvedPlugin(plugin)
    const installedManifest = this.readManifest(path.join(installRoot, 'plugin.json'))
    this.assertTrustedOfficialPlugin(installedManifest)
    this.assertPlatformSupported(installedManifest)
    this.applyDeclaredExecutablePermissions(installedManifest, installRoot)

    const now = Date.now()
    const next: PluginInstallationRecord = {
      pluginId,
      version: installedManifest.version,
      path: installRoot,
      enabled: existing?.enabled ?? false,
      trusted: true,
      source: OFFICIAL_PLUGIN_SOURCE,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now
    }
    this.upsertInstallation(next)
    this.officialPlugins.set(pluginId, {
      manifest: installedManifest,
      root: installRoot,
      sourcePath: installRoot,
      sourceType: 'directory',
      integrityDescriptor: plugin.integrityDescriptor,
      integrityError: plugin.integrityError
    })
    return next
  }

  private assertPlatformSupported(manifest: DeepChatPluginManifest): void {
    if (!this.isPluginPlatformSupported(manifest)) {
      throw new Error(`Plugin ${manifest.id} does not support ${this.platform}/${this.arch}`)
    }
  }

  private isPluginPlatformSupported(manifest: DeepChatPluginManifest): boolean {
    const platforms = new Set(manifest.engines.platforms.map((platform) => platform.toLowerCase()))
    const aliases = this.platform === 'darwin' ? ['darwin', 'macos', 'mac'] : [this.platform]
    const targets = manifest.engines.targets?.map((target) => target.toLowerCase()) ?? []
    if (targets.length > 0) {
      return aliases.some((platform) => targets.includes(`${platform}/${this.arch}`))
    }
    return aliases.some((platform) => platforms.has(platform))
  }

  private installResolvedPlugin(plugin: ResolvedOfficialPlugin): string {
    const installRoot = this.getInstalledPluginRoot(plugin.manifest.id)
    if (plugin.sourceType === 'directory' && path.resolve(plugin.sourcePath) === installRoot) {
      return installRoot
    }

    const preservedConfig = this.readInstalledPluginConfig(installRoot)
    fs.rmSync(installRoot, { recursive: true, force: true })
    fs.mkdirSync(installRoot, { recursive: true })

    if (plugin.sourceType === 'package') {
      this.extractPluginPackage(plugin.sourcePath, installRoot)
    } else {
      this.copyPluginDirectory(plugin.sourcePath, installRoot)
    }

    this.writeInstalledPluginConfig(installRoot, preservedConfig)

    return installRoot
  }

  private arePluginManifestsEquivalent(
    left: DeepChatPluginManifest,
    right: DeepChatPluginManifest
  ): boolean {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  private readInstalledPluginConfig(installRoot: string): string | undefined {
    const configPath = path.join(installRoot, 'config.json')
    if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) {
      return undefined
    }
    return fs.readFileSync(configPath, 'utf8')
  }

  private writeInstalledPluginConfig(installRoot: string, config: string | undefined): void {
    if (config === undefined) {
      return
    }
    fs.writeFileSync(path.join(installRoot, 'config.json'), config, 'utf8')
  }

  private extractPluginPackage(packagePath: string, installRoot: string): void {
    const files = this.readPluginPackage(packagePath)
    for (const [relativePath, content] of Object.entries(files)) {
      if (relativePath.endsWith('/')) {
        continue
      }
      const outputPath = this.resolvePluginRelativePath(installRoot, relativePath)
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(outputPath, Buffer.from(content))
    }
  }

  private applyDeclaredExecutablePermissions(
    manifest: DeepChatPluginManifest,
    pluginRoot: string
  ): void {
    for (const candidate of manifest.runtime?.detect ?? []) {
      if (!candidate.startsWith('plugin:')) {
        continue
      }
      const executablePath = this.resolvePluginRelativePath(
        pluginRoot,
        candidate.slice('plugin:'.length)
      )
      if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
        continue
      }
      fs.chmodSync(executablePath, 0o755)
    }
  }

  private copyPluginDirectory(sourceRoot: string, installRoot: string): void {
    for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        entry.name === '.DS_Store' ||
        entry.name === 'vendor' ||
        entry.name === 'build' ||
        entry.name === 'node_modules' ||
        entry.name === '.build'
      ) {
        continue
      }

      const sourcePath = path.join(sourceRoot, entry.name)
      const targetPath = path.join(installRoot, entry.name)
      if (entry.isDirectory()) {
        fs.mkdirSync(targetPath, { recursive: true })
        this.copyPluginDirectory(sourcePath, targetPath)
        continue
      }
      if (entry.isFile()) {
        fs.copyFileSync(sourcePath, targetPath)
      }
    }
  }

  private getPluginInstallRoot(): string {
    return path.join(app.getPath('userData'), 'plugins')
  }

  private getInstalledPluginRoot(pluginId: string): string {
    return path.join(this.getPluginInstallRoot(), this.normalizePluginDirectoryName(pluginId))
  }

  private normalizePluginDirectoryName(pluginId: string): string {
    return pluginId.replace(/[^a-zA-Z0-9._-]/g, '-')
  }

  private async repairMissingPluginResources(): Promise<void> {
    const installedIds = new Set(
      this.getInstallations().map((installation) => installation.pluginId)
    )
    const resources = this.getResources()
    for (const resource of resources) {
      if (!installedIds.has(resource.pluginId)) {
        await this.disableByOwner(resource.pluginId)
      }
    }
  }

  private async buildPluginListItem(pluginId: string): Promise<PluginListItem> {
    const plugin = this.getOfficialPluginOrThrow(pluginId)
    const installation = this.getInstallation(pluginId)
    const runtimeRecord = this.getRuntimeRecord(pluginId, plugin.manifest.runtime?.id)
    const settings = this.getSettingsContribution(pluginId)
    const runtime = plugin.manifest.runtime
      ? {
          runtimeId: plugin.manifest.runtime.id,
          displayName: plugin.manifest.runtime.displayName,
          state: runtimeRecord?.state ?? 'missing',
          command: runtimeRecord?.command,
          helperAppPath: runtimeRecord?.helperAppPath,
          version: runtimeRecord?.version,
          lastError: runtimeRecord?.lastError,
          checkedAt: runtimeRecord?.checkedAt
        }
      : undefined

    return {
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      publisher: plugin.manifest.publisher,
      installed: true,
      enabled: Boolean(installation?.enabled),
      trusted: true,
      trustState: 'trusted',
      official: true,
      capabilities: plugin.manifest.capabilities,
      activationError: this.activationErrors.get(pluginId),
      runtime,
      mcpServers: await this.getPluginMcpRuntimeStatuses(plugin.manifest),
      settings
    }
  }

  private getOfficialPluginOrThrow(pluginId: string): ResolvedOfficialPlugin {
    const plugin = this.officialPlugins.get(pluginId)
    if (!plugin) {
      throw new Error(`Official plugin ${pluginId} is not available`)
    }
    return plugin
  }

  private getInstalledOrOfficialPluginOrThrow(pluginId: string): ResolvedOfficialPlugin {
    const official = this.officialPlugins.get(pluginId)
    if (official) {
      const installation = this.ensureOfficialPluginInstallation(official)
      const manifestPath = path.join(installation.path, 'plugin.json')
      if (fs.existsSync(manifestPath)) {
        return {
          manifest: this.readManifest(manifestPath),
          root: installation.path,
          sourcePath: installation.path,
          sourceType: 'directory',
          integrityDescriptor: official.integrityDescriptor,
          integrityError: official.integrityError
        }
      }
    }

    const installation = this.getInstallation(pluginId)
    if (installation?.path && fs.existsSync(path.join(installation.path, 'plugin.json'))) {
      return {
        manifest: this.readManifest(path.join(installation.path, 'plugin.json')),
        root: installation.path,
        sourcePath: installation.path,
        sourceType: 'directory'
      }
    }

    return this.getOfficialPluginOrThrow(pluginId)
  }

  private getInstallations(): PluginInstallationRecord[] {
    return this.store.get('installations') ?? []
  }

  private getRuntimeSentinelMap(): Record<string, unknown> {
    const sentinels = this.store.get('runtimeSentinels')
    if (sentinels === undefined) {
      return {}
    }
    if (!sentinels || typeof sentinels !== 'object' || Array.isArray(sentinels)) {
      throw new Error('Plugin runtime safety evidence store is corrupt; runtime start is blocked')
    }
    return sentinels
  }

  private copyRuntimeSentinel(sentinel: PluginRuntimeSentinel): PluginRuntimeSentinel {
    return {
      ...sentinel,
      fingerprint: { ...sentinel.fingerprint },
      ...(sentinel.launchContext ? { launchContext: { ...sentinel.launchContext } } : {})
    }
  }

  private getInstallation(pluginId: string): PluginInstallationRecord | undefined {
    return this.getInstallations().find((installation) => installation.pluginId === pluginId)
  }

  private removeInstallationRecord(pluginId: string): void {
    this.store.set(
      'installations',
      this.getInstallations().filter((installation) => installation.pluginId !== pluginId)
    )
  }

  private upsertInstallation(record: PluginInstallationRecord): void {
    this.store.set('installations', [
      ...this.getInstallations().filter((item) => item.pluginId !== record.pluginId),
      record
    ])
  }

  private getResources(): PluginResourceRecord[] {
    return this.store.get('resources') ?? []
  }

  private upsertResource(input: Omit<PluginResourceRecord, 'createdAt' | 'updatedAt'>): void {
    const now = Date.now()
    const existing = this.getResources().find(
      (resource) =>
        resource.pluginId === input.pluginId &&
        resource.kind === input.kind &&
        resource.key === input.key
    )
    const next: PluginResourceRecord = {
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    this.store.set('resources', [
      ...this.getResources().filter(
        (resource) =>
          !(
            resource.pluginId === input.pluginId &&
            resource.kind === input.kind &&
            resource.key === input.key
          )
      ),
      next
    ])
  }

  private removeResourceRecordsByOwner(pluginId: string): void {
    this.store.set(
      'resources',
      this.getResources().filter((resource) => resource.pluginId !== pluginId)
    )
  }

  private getRuntimeRecord(
    pluginId: string,
    runtimeId?: string
  ): RuntimeDependencyRecord | undefined {
    if (!runtimeId) {
      return undefined
    }
    return (this.store.get('runtimes') ?? []).find(
      (runtime) => runtime.pluginId === pluginId && runtime.runtimeId === runtimeId
    )
  }

  private removeRuntimeRecordsByOwner(pluginId: string): void {
    this.store.set(
      'runtimes',
      (this.store.get('runtimes') ?? []).filter((runtime) => runtime.pluginId !== pluginId)
    )
  }

  private upsertRuntimeRecord(record: RuntimeDependencyRecord): void {
    this.store.set('runtimes', [
      ...(this.store.get('runtimes') ?? []).filter(
        (runtime) =>
          !(runtime.pluginId === record.pluginId && runtime.runtimeId === record.runtimeId)
      ),
      record
    ])
  }

  private resolveManifestSettingsContribution(
    plugin: ResolvedOfficialPlugin,
    pluginRoot: string
  ): PluginSettingsContribution | undefined {
    const contribution = plugin.manifest.settingsContributions?.[0]
    if (!contribution) {
      return undefined
    }

    const entry = this.resolvePluginRelativePath(pluginRoot, contribution.entry)
    const preloadTypes = this.resolvePluginRelativePath(pluginRoot, contribution.preloadTypes)
    if (!fs.existsSync(entry) || !fs.existsSync(preloadTypes)) {
      return undefined
    }

    return {
      id: contribution.id,
      ownerPluginId: plugin.manifest.id,
      title: contribution.title,
      placement: contribution.placement,
      entry,
      preloadTypes
    }
  }

  private isSettingsContributionAvailable(settings?: PluginSettingsContribution): boolean {
    try {
      const entry = settings?.entry
      const preloadTypes = settings?.preloadTypes
      if (!entry || !preloadTypes) {
        return false
      }
      return fs.existsSync(entry) && fs.existsSync(preloadTypes)
    } catch {
      return false
    }
  }

  private getSettingsContribution(pluginId: string): PluginSettingsContribution | undefined {
    const record = this.getResources().find(
      (resource) =>
        resource.pluginId === pluginId && resource.kind === 'settings' && resource.enabled
    )
    const stored = record?.payload as unknown as PluginSettingsContribution | undefined
    if (this.isSettingsContributionAvailable(stored)) {
      return stored
    }

    const plugin = this.getOfficialPluginOrThrow(pluginId)
    const installation = this.getInstallation(pluginId)
    if (installation?.path) {
      const installedSettings = this.resolveManifestSettingsContribution(plugin, installation.path)
      if (installedSettings) {
        return installedSettings
      }
    }

    if (plugin.sourceType === 'package') {
      const ensuredInstallation = this.ensureOfficialPluginInstallation(plugin)
      return this.resolveManifestSettingsContribution(plugin, ensuredInstallation.path)
    }

    return this.resolveManifestSettingsContribution(plugin, plugin.root)
  }

  private resolvePluginTemplate(
    template: string,
    plugin: ResolvedOfficialPlugin,
    runtime?: PluginRuntimeStatus
  ): string {
    let result = template
      .replaceAll('${plugin.root}', plugin.root)
      .replaceAll('${plugin.id}', plugin.manifest.id)
    if (runtime) {
      result = result
        .replaceAll(`\${runtime.${runtime.runtimeId}.command}`, runtime.command ?? '')
        .replaceAll(`\${runtime.${runtime.runtimeId}.helperAppPath}`, runtime.helperAppPath ?? '')
    }
    return result
  }

  private resolveRuntimeCandidate(candidate: string, pluginRoot: string): string | null {
    candidate = candidate.replaceAll('${arch}', this.arch)
    if (candidate.startsWith('app-helper:')) {
      return this.resolveAppHelperRelativePath(candidate.slice('app-helper:'.length))
    }
    if (candidate.startsWith('plugin:')) {
      return this.resolvePluginRelativePath(pluginRoot, candidate.slice('plugin:'.length))
    }
    if (candidate.startsWith('PATH:')) {
      return candidate.slice('PATH:'.length)
    }
    if (candidate.startsWith('~/')) {
      return path.join(app.getPath('home'), candidate.slice(2))
    }
    return candidate
  }

  private resolveAppHelperRelativePath(relativePath: string): string | null {
    if (this.platform !== 'darwin' || !this.isPackaged || !this.resourcesPath) {
      return null
    }

    const normalized = this.assertSafeRelativePath(relativePath, 'app helper path')
    const helperRoot = path.resolve(path.dirname(this.resourcesPath), 'Helpers')
    const resolved = path.resolve(helperRoot, ...normalized.split('/').filter(Boolean))
    const relativeToHelperRoot = path.relative(helperRoot, resolved)
    if (relativeToHelperRoot.startsWith('..') || path.isAbsolute(relativeToHelperRoot)) {
      throw new Error(`App helper path escapes helper root: ${relativePath}`)
    }
    return resolved
  }

  private resolvePluginTemplateRecord(
    input: Record<string, string>,
    plugin: ResolvedOfficialPlugin,
    runtime?: PluginRuntimeStatus
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        this.resolvePluginTemplate(value, plugin, runtime)
      ])
    )
  }

  private resolveHelperAppPath(command: string): string | undefined {
    if (!path.isAbsolute(command)) {
      return undefined
    }

    let current = path.dirname(path.normalize(command))
    while (current && current !== path.dirname(current)) {
      if (current.endsWith('.app')) {
        return current
      }
      current = path.dirname(current)
    }
    return undefined
  }

  private async getPluginMcpRuntimeStatuses(
    manifest: DeepChatPluginManifest
  ): Promise<NonNullable<PluginListItem['mcpServers']>> {
    const pluginEnabled = Boolean(this.getInstallation(manifest.id)?.enabled)
    const statuses: NonNullable<PluginListItem['mcpServers']> = []
    for (const server of manifest.mcpServers ?? []) {
      const supervisorState = this.runtimeSupervisor.getState(server.id)
      statuses.push({
        serverId: server.id,
        enabled: pluginEnabled,
        running: await this.mcpService.isServerRunning(server.id),
        lifecycleState: supervisorState?.state,
        quarantinedAt: supervisorState?.quarantine?.recordedAt,
        integrityError: supervisorState?.integrityError,
        lastError: pluginEnabled
          ? (supervisorState?.lastError ?? this.mcpService.getServerLastError(server.id))
          : undefined
      })
    }
    return statuses
  }

  private hydrateManifestPlaceholders(manifest: DeepChatPluginManifest): DeepChatPluginManifest {
    return JSON.parse(
      JSON.stringify(manifest)
        .replaceAll('${app.version}', app.getVersion())
        .replaceAll('${arch}', this.arch)
        .replaceAll('${target.platform}', this.platform)
        .replaceAll(
          '${github.release.download}',
          `${GITHUB_RELEASE_DOWNLOAD_PREFIX}${this.getReleaseTag()}`
        )
    ) as DeepChatPluginManifest
  }

  private getReleaseTag(): string {
    const version = app.getVersion()
    return version.startsWith('v') ? version : `v${version}`
  }

  private assertSafeRelativePath(relativePath: string, label: string): string {
    const normalized = relativePath.replace(/\\/g, '/')
    if (
      !normalized ||
      normalized.startsWith('/') ||
      normalized.includes('..') ||
      /^[A-Za-z]:/.test(normalized)
    ) {
      throw new Error(`Unsafe ${label}: ${relativePath}`)
    }
    return normalized
  }

  private resolvePluginRelativePath(pluginRoot: string, relativePath: string): string {
    const normalized = this.assertSafeRelativePath(relativePath, 'plugin path')
    const resolved = path.resolve(pluginRoot, ...normalized.split('/').filter(Boolean))
    const relativeToRoot = path.relative(pluginRoot, resolved)
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      throw new Error(`Plugin path escapes package root: ${relativePath}`)
    }
    return resolved
  }

  private toJsonPayload(value: unknown): PluginResourceRecord['payload'] {
    return JSON.parse(JSON.stringify(value)) as PluginResourceRecord['payload']
  }

  private errorResult(error: unknown): PluginActionResult {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
